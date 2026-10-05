import { z } from "zod";
import { SourceStrategySchema, type AdBrief, type SceneState } from "@/lib/state/schema";
import type { AssetCandidate } from "@/lib/state/schema";
import { isMockMode, runStructured } from "./llm";

/**
 * Asset Planner Agent (design doc §7.3).
 * Decision order, enforced in code regardless of what the model says:
 *   1. high-match existing asset → EXISTING_ASSET
 *   2. no suitable asset          → GENERATED_VIDEO
 *   3. repair budget exhausted /
 *      generation unavailable     → FALLBACK
 */

export const AssetDecisionSchema = z.object({
  sceneId: z.string().min(1),
  strategy: SourceStrategySchema,
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
  selectedAssetId: z.string().optional(),
  generationPrompt: z.string().optional(),
});
export type AssetDecision = z.infer<typeof AssetDecisionSchema>;

import { MATCH_THRESHOLD } from "@/lib/tools/search-assets";

const SYSTEM = `你是广告工作室的素材规划师。针对单个场景，决定它的画面来源。你的默认倾向是【优先复用素材】：
- 真实素材的画面真实感远胜 AI 生成，且零成本、速度快；系统会自动按场景时长裁剪或补帧，所以【时长不是匹配门槛】——长片段会被精确剪辑，短一点会被补帧。
- 只要候选素材与场景意图语义相关（主体/动作/情绪对得上），就选 EXISTING_ASSET 并设置 selectedAssetId，哪怕描述不完全一致。
- 只有当所有候选都完全无法表达场景的核心信息（比如需要展示特定的产品玩法过程而素材里根本没有）时，才选 GENERATED_VIDEO，并编写 generationPrompt：一段自包含的写实风格英文提示词，遵循生产级约束：
  * 只描述动作/情绪/状态——绝不出现文字、字幕、Logo、UI、应用界面或可读屏幕；
  * 不做跨镜头引用——每次生成相互独立；
  * 包含光影逻辑、镜头语言、真实材质，只用物理道具——禁止粒子、全息、悬浮物体；
  * 【产品复刻禁令 + 智慧转译】generationPrompt 不必逐字复述画面意图——你的任务是把意图"转译"成视频模型擅长的高光画面：凡是模型做不好的内容（产品实体特写、拿着产品对镜头、精确包装、品牌 Logo、界面 UI），一律转化为意象、特效与艺术化表达，让 AI 生成反而比实拍更惊艳。例如：意图"女孩喝下气泡水闭眼享受"→ prompt"年轻女性仰头畅饮，晶莹水珠在逆光中飞溅成光环，气泡如星光环绕上升，表情陶醉，慢动作"；意图"产品 0 糖卖点"→ prompt"金色光线穿过清凉的气泡群，气泡升腾汇聚成轻盈的羽翼形态"；严禁出现具体产品实体或 Logo；
  * 以 "photorealistic, raw photo, cinematic lighting" 收尾。
- 【产品主体硬规则】候选素材的画面主体（或其描述）必须与广告产品本身一致——为饮料选素材时，游戏画面再"精彩"也视为不匹配，必须排除。
- reason：一句用户可见的简体中文说明。confidence 表示把握程度（0–1）。`;

/** Code-level guardrail applied to both mock and live answers. */
function sanitize(decision: AssetDecision, candidates: AssetCandidate[], canGenerate: boolean): AssetDecision {
  const top = [...candidates].sort((a, b) => b.score - a.score)[0];

  if (decision.strategy === "EXISTING_ASSET") {
    const selected = candidates.find((c) => c.id === decision.selectedAssetId);
    if (!selected || selected.score < MATCH_THRESHOLD) {
      return canGenerate
        ? { ...decision, strategy: "GENERATED_VIDEO", selectedAssetId: undefined }
        : { ...decision, strategy: "FALLBACK", selectedAssetId: top?.id };
    }
    return decision;
  }

  if (decision.strategy === "GENERATED_VIDEO" && !canGenerate) {
    return { ...decision, strategy: "FALLBACK", selectedAssetId: top?.id };
  }

  return decision;
}

export function mockAssetDecision(
  scene: SceneState,
  candidates: AssetCandidate[],
  canGenerate: boolean,
  brief: AdBrief,
): AssetDecision {
  const top = [...candidates].sort((a, b) => b.score - a.score)[0];

  if (top && top.score >= MATCH_THRESHOLD) {
    return AssetDecisionSchema.parse({
      sceneId: scene.id,
      strategy: "EXISTING_ASSET",
      confidence: Math.min(0.95, 0.5 + top.score / 2),
      reason: `素材库片段「${top.id}」匹配：${top.description}`,
      selectedAssetId: top.id,
    });
  }

  if (canGenerate) {
    return AssetDecisionSchema.parse({
      sceneId: scene.id,
      strategy: "GENERATED_VIDEO",
      confidence: 0.8,
      reason: `素材库中没有能表达${scene.purpose === "HOOK" ? "钩子" : scene.purpose === "PROOF" ? "证明" : "行动号召"}场景的片段——改为 AI 生成专属画面。`,
      generationPrompt: buildGenerationPrompt(scene, brief),
    });
  }

  return AssetDecisionSchema.parse({
    sceneId: scene.id,
    strategy: "FALLBACK",
    confidence: 0.4,
    reason: `视频生成暂不可用且素材库无强匹配——使用最接近的素材降级兜底。`,
    selectedAssetId: top?.id,
  });
}

/** Shared photorealistic prompt builder — carries the 2025 prompt-debug
 *  agent's production lessons into every generation request. */
export function buildGenerationPrompt(scene: SceneState, brief: AdBrief): string {
  const styleByPurpose: Record<SceneState["purpose"], string> = {
    HOOK: "energetic close-up, quick rhythm, expressive face",
    PROOF: "kinetic screen-first gameplay energy, satisfying cascading motion",
    CTA: "warm celebratory moment, natural gesture toward the phone",
  };
  return [
    `${brief.aspectRatio === "16:9" ? "Horizontal 16:9" : "Vertical 9:16"} ad scene for ${brief.productName} (${brief.market} market). The advertised product MUST be the visual subject.`,
    `Subject: ${scene.visualIntent}`,
    `Product policy: do NOT attempt to render the literal product, its packaging or any logo (video models cannot reproduce them). Express the value symbolically — light, atmosphere, motion metaphors, abstract effects.`,
    `Direction: ${styleByPurpose[scene.purpose]}. Independent self-contained shot.`,
    `Light & texture: natural practical light, realistic skin and fabric texture, physically plausible props only.`,
    `Exclusions: no on-screen text, no captions, no logos, no UI elements, no readable screens, no particles or holograms.`,
    `Quality: photorealistic, raw photo, cinematic lighting.`,
  ].join(" ");
}

export async function planAsset(
  scene: SceneState,
  candidates: AssetCandidate[],
  canGenerate: boolean,
  brief: AdBrief,
): Promise<AssetDecision> {
  const base = isMockMode()
    ? mockAssetDecision(scene, candidates, canGenerate, brief)
    : await runStructured({
        name: "Asset Planner",
        system: SYSTEM,
        user: JSON.stringify(
          {
            brief: {
              productName: brief.productName,
              productDescription: brief.productDescription,
              market: brief.market,
              audience: brief.audience,
            },
            scene: {
              id: scene.id,
              purpose: scene.purpose,
              durationSec: scene.durationSec,
              visualIntent: scene.visualIntent,
              voiceover: scene.voiceover,
            },
            candidates: candidates.map((c) => ({
              id: c.id,
              description: c.description,
              tags: c.tags,
              durationSec: c.durationSec,
              matchScore: c.score,
            })),
            videoGenerationAvailable: canGenerate,
          },
          null,
          2,
        ),
        schema: AssetDecisionSchema,
      });

  let decision = sanitize(base, candidates, canGenerate);
  if (decision.strategy === "GENERATED_VIDEO" && !decision.generationPrompt) {
    decision = { ...decision, generationPrompt: buildGenerationPrompt(scene, brief) };
  }
  return AssetDecisionSchema.parse({ ...decision, sceneId: scene.id });
}
