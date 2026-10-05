import type {
  CriticResult,
  DirectorAction,
  ProjectState,
  SceneState,
} from "./schema";
import { canGenerateVideo, canRepairScene } from "@/lib/runtime/limits";

/**
 * Context Projection (design doc P3 / §2): every agent gets a selector that
 * exposes only the slice of state it needs — never the raw ProjectState.
 */

// ─── What the Director is allowed to do next, computed in code (P1) ─────────

export interface Capabilities {
  video: boolean;
  critic: boolean;
  tts: boolean;
  compose: boolean;
}

/** The bounded action space for the current state. The Director LLM picks
 *  from this list; anything outside it is rejected by the runtime. */
export function allowedActions(state: ProjectState, caps: Capabilities): DirectorAction[] {
  const actions: DirectorAction[] = [];
  const scenes = state.scenes;

  if (!state.strategy) {
    actions.push("CREATE_STRATEGY");
    return actions;
  }

  const pendingPlan = scenes.find((s) => s.status === "PLANNED");
  if (pendingPlan) actions.push("RETRIEVE_ASSET");

  const pendingDecision = scenes.find((s) => s.status === "SEARCHING" && s.assetCandidates && !s.sourceStrategy);
  // Constraints changed mid-run: a scene planned for generation whose global
  // budget is gone must be re-plannable from the library (P5: degrade locally).
  const needsReplan = !canGenerateVideo(state)
    ? scenes.find(
        (s) =>
          s.sourceStrategy === "GENERATED_VIDEO" &&
          !s.videoUrl &&
          (s.status === "SEARCHING" || s.status === "REPAIRING") &&
          s.assetCandidates,
      )
    : undefined;
  if (pendingDecision || needsReplan) actions.push("PLAN_ASSETS");

  const needsGeneration = scenes.find(
    (s) =>
      s.sourceStrategy === "GENERATED_VIDEO" &&
      !s.videoUrl &&
      (s.status === "SEARCHING" || s.status === "REPAIRING") &&
      s.generationPrompt,
  );
  if (needsGeneration && caps.video && canGenerateVideo(state)) actions.push("GENERATE_VIDEO");

  const needsEvaluation = scenes.find((s) => s.videoUrl && !s.qa && s.status !== "READY");
  if (needsEvaluation && caps.critic) actions.push("EVALUATE_SCENE");

  const needsRepair = scenes.find(
    (s) => s.qa?.decision === "REPAIR" && s.status === "REPAIRING",
  );
  if (needsRepair) actions.push("REPAIR_SCENE");

  const allReady = scenes.length > 0 && scenes.every((s) => s.status === "READY");
  const missingVoice = scenes.some((s) => s.voiceover && !s.audioUrl);
  if (allReady && caps.tts && missingVoice) actions.push("GENERATE_VOICE");

  if (allReady && !missingVoice && caps.compose && !state.finalVideoUrl) {
    actions.push("COMPOSE_VIDEO");
  }

  if (state.finalVideoUrl && state.status !== "COMPLETED") actions.push("FINISH");
  if (actions.length === 0) actions.push("FINISH");

  return actions;
}

/** Compact global view handed to the Director LLM (§2 P3). */
export interface DirectorView {
  status: ProjectState["status"];
  brief: { product: string; market: string; platform: string; durationSec: number };
  strategyConcept?: string;
  generationBudgetLeft: boolean;
  scenes: Array<{
    id: string;
    status: SceneState["status"];
    purpose: string;
    sourceStrategy?: string;
    hasVideo: boolean;
    hasAudio: boolean;
    qaScore?: number;
    qaDecision?: CriticResult["decision"];
    repairs: number;
  }>;
  runtime: ProjectState["runtime"];
  allowedActions: DirectorAction[];
}

export function directorView(state: ProjectState, caps: Capabilities): DirectorView {
  return {
    status: state.status,
    brief: {
      product: state.brief.productName,
      market: state.brief.market,
      platform: state.brief.platform,
      durationSec: state.brief.durationSec,
    },
    strategyConcept: state.strategy?.concept,
    generationBudgetLeft: canGenerateVideo(state),
    scenes: state.scenes.map((s) => ({
      id: s.id,
      status: s.status,
      purpose: s.purpose,
      sourceStrategy: s.sourceStrategy,
      hasVideo: Boolean(s.videoUrl),
      hasAudio: Boolean(s.audioUrl),
      qaScore: s.qa?.score,
      qaDecision: s.qa?.decision,
      repairs: s.repairHistory.length,
    })),
    runtime: state.runtime,
    allowedActions: allowedActions(state, caps),
  };
}

/** Minimal scene context for the Asset Planner (§7.3). */
export function plannerView(state: ProjectState, sceneId: string) {
  const scene = state.scenes.find((s) => s.id === sceneId);
  if (!scene) throw new Error(`scene not found: ${sceneId}`);
  return {
    brief: {
      productName: state.brief.productName,
      market: state.brief.market,
      audience: state.brief.audience,
      platform: state.brief.platform,
    },
    concept: state.strategy?.concept,
    scene: {
      id: scene.id,
      purpose: scene.purpose,
      durationSec: scene.durationSec,
      visualIntent: scene.visualIntent,
      voiceover: scene.voiceover,
      candidates: scene.assetCandidates ?? [],
    },
  };
}

/** Minimal scene context for the Multimodal Critic (§7.4). */
export function criticView(state: ProjectState, sceneId: string) {
  const scene = state.scenes.find((s) => s.id === sceneId);
  if (!scene) throw new Error(`scene not found: ${sceneId}`);
  return {
    market: state.brief.market,
    product: {
      name: state.brief.productName,
      description: state.brief.productDescription,
    },
    scene: {
      id: scene.id,
      purpose: scene.purpose,
      durationSec: scene.durationSec,
      visualIntent: scene.visualIntent,
      generationPrompt: scene.generationPrompt ?? "",
      repairHistory: scene.repairHistory,
    },
  };
}
