import { z } from "zod";
import type { DirectorAction } from "@/lib/state/schema";
import { DirectorActionSchema, SceneIdSchema } from "@/lib/state/schema";
import type { DirectorView } from "@/lib/state/selectors";
import { isMockMode, runStructured } from "./llm";

/**
 * Creative Director (design doc §7.1).
 * Decides "what to do next" from a bounded action space; the orchestrator
 * decides "how to do it reliably". The reason is a user-visible, auditable
 * business sentence — never hidden chain-of-thought.
 */

export const DirectorDecisionSchema = z.object({
  action: DirectorActionSchema,
  sceneId: SceneIdSchema.optional(),
  reason: z.string().min(1),
});
export type DirectorDecision = z.infer<typeof DirectorDecisionSchema>;

const SCENE_SCOPED: ReadonlySet<DirectorAction> = new Set([
  "RETRIEVE_ASSET",
  "PLAN_ASSETS",
  "GENERATE_VIDEO",
  "EVALUATE_SCENE",
  "REPAIR_SCENE",
]);

/** Canonical priority used by the deterministic policy (and as the safety
 *  net when a live LLM choice is invalid). */
const PRIORITY: DirectorAction[] = [
  "CREATE_STRATEGY",
  "RETRIEVE_ASSET",
  "PLAN_ASSETS",
  "GENERATE_VIDEO",
  "EVALUATE_SCENE",
  "REPAIR_SCENE",
  "GENERATE_VOICE",
  "COMPOSE_VIDEO",
  "FINISH",
];

function pickScene(view: DirectorView, action: DirectorAction): string | undefined {
  const byAction: Record<string, (s: DirectorView["scenes"][number]) => boolean> = {
    RETRIEVE_ASSET: (s) => s.status === "PLANNED",
    PLAN_ASSETS: (s) =>
      s.status === "SEARCHING" &&
      (!s.sourceStrategy ||
        (s.sourceStrategy === "GENERATED_VIDEO" && !s.hasVideo && !view.generationBudgetLeft)),
    GENERATE_VIDEO: (s) =>
      s.sourceStrategy === "GENERATED_VIDEO" && !s.hasVideo && (s.status === "SEARCHING" || s.status === "REPAIRING"),
    EVALUATE_SCENE: (s) => s.hasVideo && s.qaScore === undefined && s.status !== "READY",
    REPAIR_SCENE: (s) => s.qaDecision === "REPAIR" && s.status === "REPAIRING",
  };
  const matches = byAction[action];
  if (!matches) return undefined;
  return view.scenes.find(matches)?.id;
}

/** Deterministic policy — the mock Director, the fallback for invalid live
 *  decisions, and the reference implementation of legal behaviour. */
export function policyDecision(view: DirectorView): DirectorDecision {
  const action = PRIORITY.find((a) => view.allowedActions.includes(a)) ?? "FINISH";
  const sceneId = pickScene(view, action);
  const allReady = view.scenes.length > 0 && view.scenes.every((s) => s.status === "READY");
  const reason =
    action === "FINISH" && !allReady
      ? "No further action is available in the current state."
      : reasonFor(action, view);
  return DirectorDecisionSchema.parse({ action, sceneId, reason });
}

function reasonFor(action: DirectorAction, view: DirectorView): string {
  const product = view.brief.product;
  switch (action) {
    case "CREATE_STRATEGY":
      return `No creative strategy exists yet for ${product} in ${view.brief.market}.`;
    case "RETRIEVE_ASSET":
      return `Scene needs footage: searching the asset library before deciding to generate.`;
    case "PLAN_ASSETS":
      return view.generationBudgetLeft
        ? `Retrieved candidates for a scene with no source decision yet.`
        : `Generation budget is exhausted — re-planning a pending scene from the asset library.`;
    case "GENERATE_VIDEO":
      return `No retrieved asset sufficiently expresses the scene intent — generating dedicated footage.`;
    case "EVALUATE_SCENE":
      return `Generated footage must pass multimodal QA before it can be used.`;
    case "REPAIR_SCENE":
      return `Critic flagged issues on a scene; repairing only that scene.`;
    case "GENERATE_VOICE":
      return `All scenes are READY — generating localized voiceover tracks.`;
    case "COMPOSE_VIDEO":
      return `All scenes and voiceovers are ready — composing the final ad.`;
    case "FINISH":
      return `Final ad is ready — wrapping up the project.`;
  }
}

const SYSTEM = `You are the Creative Director of an agentic ad studio.
Given a compact project view, choose exactly ONE next action from "allowedActions".

Rules:
- sceneId (S1|S2|S3) is required for RETRIEVE_ASSET, PLAN_ASSETS, GENERATE_VIDEO, EVALUATE_SCENE, REPAIR_SCENE; otherwise omit it.
- "reason" must be one concise, user-visible business sentence explaining why this action is the right next step (e.g. "No retrieved asset sufficiently expresses the transformation scene."). Never expose hidden reasoning.
- Prefer reusing existing assets when they match; generate only when retrieval cannot express the scene.`;

export async function decideNextAction(view: DirectorView): Promise<DirectorDecision> {
  if (isMockMode()) return policyDecision(view);

  const decision = await runStructured({
    name: "Creative Director",
    system: SYSTEM,
    user: JSON.stringify(view, null, 2),
    schema: DirectorDecisionSchema,
  });

  if (
    view.allowedActions.includes(decision.action) &&
    (!SCENE_SCOPED.has(decision.action) || (decision.sceneId && decision.sceneId === pickScene(view, decision.action)))
  ) {
    return decision;
  }

  console.warn(
    `[director] invalid LLM decision (${decision.action}/${decision.sceneId}) — falling back to policy`,
  );
  return policyDecision(view);
}
