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

const SYSTEM = `你是竖版信息流广告的严格多模态质检评审。
你会看到场景意图、生成提示词，以及生成视频的关键帧。

对每个维度打 0–100 分：
- intentAlignment 意图一致性：画面是否表达了场景意图
- visualQuality 画面质量：清晰度、稳定性、真实感、无 AI 伪影
- productVisibility 产品可见度：被推广的游戏/产品体验是否清晰可见
- localization 本地化：是否符合目标市场审美
- safetyAndText 安全与文字：无乱码文字、无 Logo/UI、无违规内容

"score" 是综合判断（约为加权均值，某个维度崩了要果断压低总分）。
issues 列出具体问题，severity 为 low/medium/high，description 用简体中文。
如果判定需要 REPAIR，同时给出 repair.promptDelta：一句可执行的修改建议，说明生成提示词要调整什么（可以英文，供视频模型使用）。`;

/** Code-enforced verdict (§7.4) — the model advises, the rule decides. */
export function enforceVerdict(result: CriticResult): CriticResult {
  const hasHigh = result.issues.some((i) => i.severity === "high");
  const decision = result.score >= PASS_THRESHOLD && !hasHigh ? "PASS" : "REPAIR";
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

  if (isMockMode()) {
    return enforceVerdict(mockCriticResult(view, repairCount));
  }

  const images = framePaths.map((p) => ({
    dataUrl: `data:image/jpeg;base64,${fs.readFileSync(p).toString("base64")}`,
  }));

  const result = await runVision({
    name: "Multimodal Critic",
    system: SYSTEM,
    user: JSON.stringify({
      market: view.market,
      product: view.product,
      scene: view.scene,
    }),
    images,
    schema: CriticResultSchema,
  });

  return enforceVerdict(result);
}

// re-export for tests of the verdict rule
export { PASS_THRESHOLD };
export const CriticOutputForTest = CriticResultSchema;
