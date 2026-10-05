import fs from "node:fs";
import { CriticResultSchema, type CriticResult } from "@/lib/state/schema";
import { isMockMode, runVision } from "./llm";
import type { criticView } from "@/lib/state/selectors";

type CriticView = ReturnType<typeof criticView>;

/**
 * Multimodal Critic (design doc §7.4 / §13).
 * Judges the OBSERVED result (keyframes), not the API status code.
 * Verdict rule is enforced in code: score ≥ 75 AND no high-severity issue.
 */

const PASS_THRESHOLD = 75;

/** 生成类场景：严格标准（抓 AI 幻觉、伪影、产品体验表达）。 */
const SYSTEM_GENERATED = `你是竖版信息流广告的严格多模态质检评审。
你会看到场景意图、生成提示词，以及 AI 生成视频的关键帧。

对每个维度打 0–100 分：
- intentAlignment 意图一致性：画面是否表达了场景意图
- visualQuality 画面质量：清晰度、稳定性、真实感、无 AI 伪影
- productVisibility 产品体验可见度：注意——视频模型无法复刻具体产品外观/包装/Logo，这一维度衡量的是【产品体验/卖点是否被画面有效表达】（清爽感、玩法、使用场景等），绝不因"没有精确还原产品包装"扣分
- localization 本地化：是否符合目标市场审美
- safetyAndText 安全与文字：无乱码文字、无 Logo/UI、无违规内容

"score" 是综合判断（约为加权均值，某个维度崩了要果断压低总分）。
issues 列出具体问题，severity 为 low/medium/high，description 用简体中文。
如果判定需要 REPAIR，同时给出 repair.promptDelta：一句可执行的修改建议（可以英文，供视频模型使用），只修真正的问题，不要要求复刻产品细节。`;

/** 用户真实素材：宽容标准（用户反馈 #3）——只看主体对不对，不抠细节。 */
const SYSTEM_EXISTING = `你是广告成片的素材审核员。你现在评审的画面来自【用户上传的真实拍摄素材】（已被自动切片并选中挂载），不是 AI 生成的。

因此评审标准刻意宽容，只回答两个问题：
1. 画面主体是否是广告产品本身（或其使用场景）？如果画面主体是与产品无关的另一种东西（比如给饮料广告配了游戏画面），打低分并列 high 级问题——这是唯一需要打回的情形。
2. 画面内容与场景意图是否【大致】匹配？只要主体/动作/情绪对得上就算匹配（比如脚本写"女孩喝饮料闭眼享受"，画面里有女孩在喝、神情愉悦就通过）。不要因为细节差异打回（没有"特写"、没有"冰镇倾倒"、光线构图不同等都不构成打回理由）。

明确禁止的评价：AI 生成伪影、画质瑕疵、塑料感、镜头细节与脚本逐字不符——真实素材不存在这些问题，也不要求逐字还原脚本。
没问题就大方给高分（75+）。issues 一般为空或仅 low。`;

/** Code-enforced verdict (§7.4) — the model advises, the rule decides.
 *  lenient = 用户真实素材模式：只有严重主体错配或极低分才打回。 */
export function enforceVerdict(result: CriticResult, opts: { lenient?: boolean } = {}): CriticResult {
  const hasHigh = result.issues.some((i) => i.severity === "high");
  const threshold = opts.lenient ? 40 : PASS_THRESHOLD;
  const decision = result.score >= threshold && !hasHigh ? "PASS" : "REPAIR";
  if (decision === "REPAIR" && !result.repair) {
    const top = result.issues.find((i) => i.severity === "high") ?? result.issues[0];
    result.repair = {
      strategy: "REGENERATE",
      promptDelta: top
        ? `Fix: ${top.description}. Make the product experience central, clearly visible and instantly readable.`
        : "Fix: make the product experience central and clearly visible.",
    };
  }
  return { ...result, decision };
}

/** Deterministic critic for mock mode — scripts the demo's repair arc:
 *  first evaluation of a generated PROOF scene scores 64 (REPAIR), the
 *  post-repair evaluation scores 88 (PASS). Existing-asset scenes pass. */
export function mockCriticResult(view: CriticView, repairCount: number): CriticResult {
  if (repairCount >= 1) {
    return CriticResultSchema.parse({
      score: 88,
      decision: "PASS",
      dimensions: {
        intentAlignment: 90,
        visualQuality: 88,
        productVisibility: 86,
        localization: 87,
        safetyAndText: 89,
      },
      issues: [
        { type: "pacing", severity: "low", description: "高潮前可以再留半拍呼吸感。" },
      ],
    });
  }

  if (view.scene.purpose === "PROOF") {
    return CriticResultSchema.parse({
      score: 64,
      decision: "REPAIR",
      dimensions: {
        intentAlignment: 72,
        visualQuality: 81,
        productVisibility: 48,
        localization: 70,
        safetyAndText: 85,
      },
      issues: [
        {
          type: "product-visibility",
          severity: "high",
          description: "玩法爽点不清晰可读，产品体验淹没在运动之中。",
        },
        {
          type: "pacing",
          severity: "medium",
          description: "连锁消除节奏太快，核心玩法来不及被感知。",
        },
      ],
      repair: {
        strategy: "REGENERATE",
        promptDelta:
          "Make the gameplay payoff the clear focal point, held steady in center frame for a beat; slightly slow the cascade so the core loop reads instantly; keep photorealistic quality.",
      },
    });
  }

  return CriticResultSchema.parse({
    score: 82,
    decision: "PASS",
    dimensions: {
      intentAlignment: 84,
      visualQuality: 83,
      productVisibility: 80,
      localization: 79,
      safetyAndText: 84,
    },
    issues: [],
  });
}

export async function evaluateSceneFrames(
  view: CriticView,
  framePaths: string[],
): Promise<CriticResult> {
  const repairCount = view.scene.repairHistory.length;

  const fromUserAsset = view.scene.sourceStrategy !== "GENERATED_VIDEO";

  if (isMockMode()) {
    return enforceVerdict(mockCriticResult(view, repairCount), { lenient: fromUserAsset });
  }

  const images = framePaths.map((p) => ({
    dataUrl: `data:image/jpeg;base64,${fs.readFileSync(p).toString("base64")}`,
  }));

  const result = await runVision({
    name: "Multimodal Critic",
    system: fromUserAsset ? SYSTEM_EXISTING : SYSTEM_GENERATED,
    user: JSON.stringify({
      market: view.market,
      product: view.product,
      scene: view.scene,
      画面来源: fromUserAsset ? "用户真实素材（宽容评审）" : "AI 生成（严格评审）",
    }),
    images,
    schema: CriticResultSchema,
  });

  return enforceVerdict(result, { lenient: fromUserAsset });
}

// re-export for tests of the verdict rule
export { PASS_THRESHOLD };
export const CriticOutputForTest = CriticResultSchema;
