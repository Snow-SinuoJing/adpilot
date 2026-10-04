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

const MATCH_THRESHOLD = 0.35;

const SYSTEM = `You are an asset planner for an ad studio. For one scene, decide where its footage comes from:
- EXISTING_ASSET: a retrieved candidate genuinely expresses the scene intent (content match AND usable duration). Set selectedAssetId.
- GENERATED_VIDEO: no candidate is a real match. Write generationPrompt: a self-contained photorealistic video-generation prompt following these rules (hard-won constraints from production TTV models):
  * describe action / emotion / state only — never text, captions, logos, UI, app screens or readable interfaces;
  * no cross-shot references ("same as scene 1") — each generation is independent;
  * include light logic (e.g. golden hour, soft window light), lens language (close-up, over-the-shoulder), real texture and physical props only — no particles, holograms, floating objects;
  * end with quality keywords like "photorealistic, raw photo, cinematic lighting".
- reason: one user-visible sentence (e.g. "No retrieved asset sufficiently expresses the transformation scene").
Confidence reflects how sure you are (0–1).`;

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
      reason: `Library clip "${top.id}" matches: ${top.description}`,
      selectedAssetId: top.id,
    });
  }

  if (canGenerate) {
    return AssetDecisionSchema.parse({
      sceneId: scene.id,
      strategy: "GENERATED_VIDEO",
      confidence: 0.8,
      reason: `No retrieved asset sufficiently expresses the ${scene.purpose.toLowerCase()} scene — generating dedicated footage.`,
      generationPrompt: buildGenerationPrompt(scene, brief),
    });
  }

  return AssetDecisionSchema.parse({
    sceneId: scene.id,
    strategy: "FALLBACK",
    confidence: 0.4,
    reason: `Video generation unavailable and no strong library match — using best available clip as fallback.`,
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
    `Vertical 9:16 casual-game ad scene for ${brief.productName} (${brief.market} market).`,
    `Subject: ${scene.visualIntent}`,
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
            brief: { productName: brief.productName, market: brief.market, audience: brief.audience },
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
