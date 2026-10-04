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

const SYSTEM = `You are a strict multimodal QA critic for vertical video ads.
You will see the scene intent, the generation prompt, and keyframes of the generated clip.

Score each dimension 0–100:
- intentAlignment: does the footage express the visual intent?
- visualQuality: sharpness, stability, plausibility, absence of AI artifacts
- productVisibility: is the advertised game/product experience clearly on screen?
- localization: does it fit the target market's aesthetics?
- safetyAndText: no garbled text, no logos/UI, nothing policy-unsafe

"score" = your overall judgement (roughly the weighted mean, but lower it decisively when a dimension is broken).
List concrete issues with severity low/medium/high.
If the verdict should be REPAIR, also provide repair.promptDelta: one actionable sentence describing what to change in the generation prompt (add or emphasize, never remove safety exclusions).`;

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
        { type: "pacing", severity: "low", description: "Scene could breathe half a beat longer before the payoff." },
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
          description: "The gameplay payoff is not clearly readable; the product experience gets lost in the motion.",
        },
        {
          type: "pacing",
          severity: "medium",
          description: "Cascading action is too fast to register the core loop.",
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
