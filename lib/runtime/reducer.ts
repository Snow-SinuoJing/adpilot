import type { ProjectState, SceneStatus, SceneState } from "@/lib/state/schema";
import { MAX_REPAIR_PER_SCENE, MAX_SCENES, MAX_TOTAL_VIDEO_GENERATIONS } from "./limits";

/**
 * Scene state machine (design doc §12) + project invariants.
 * Illegal transitions throw — the Agent layer can never write around this.
 */

const LEGAL_TRANSITIONS: Record<SceneStatus, SceneStatus[]> = {
  PLANNED: ["SEARCHING", "FAILED"],
  SEARCHING: ["READY", "GENERATING", "FAILED"],
  GENERATING: ["EVALUATING", "FAILED"],
  EVALUATING: ["READY", "REPAIRING", "FAILED"],
  REPAIRING: ["GENERATING", "READY", "FAILED"],
  READY: [],
  FAILED: [],
};

export class StateTransitionError extends Error {
  constructor(sceneId: string, from: SceneStatus, to: SceneStatus) {
    super(`illegal scene transition ${sceneId}: ${from} → ${to}`);
    this.name = "StateTransitionError";
  }
}

export function assertSceneTransition(scene: SceneState, to: SceneStatus): void {
  if (!LEGAL_TRANSITIONS[scene.status].includes(to)) {
    throw new StateTransitionError(scene.id, scene.status, to);
  }
}

/** Mutates the draft scene after asserting the transition is legal. */
export function transitionScene(state: ProjectState, sceneId: string, to: SceneStatus): void {
  const scene = state.scenes.find((s) => s.id === sceneId);
  if (!scene) throw new Error(`scene not found: ${sceneId}`);
  assertSceneTransition(scene, to);
  scene.status = to;
}

/** Project invariants checked after every orchestrator step (§10). */
export function validateInvariants(state: ProjectState): void {
  if (state.scenes.length > MAX_SCENES) {
    throw new Error(`invariant: more than ${MAX_SCENES} scenes`);
  }
  if (state.strategy) {
    const sum = state.scenes.reduce((acc, s) => acc + s.durationSec, 0);
    if (sum !== state.brief.durationSec) {
      throw new Error(`invariant: scene durations (${sum}s) != brief duration (${state.brief.durationSec}s)`);
    }
  }
  if (state.runtime.totalVideoGenerations > MAX_TOTAL_VIDEO_GENERATIONS) {
    throw new Error(`invariant: video generation cap exceeded`);
  }
  for (const scene of state.scenes) {
    if (scene.repairHistory.length > MAX_REPAIR_PER_SCENE) {
      throw new Error(`invariant: repair cap exceeded on ${scene.id}`);
    }
    if (scene.status === "READY" && !scene.videoUrl && !scene.selectedAsset) {
      throw new Error(`invariant: ${scene.id} READY without footage`);
    }
    if (scene.status === "EVALUATING" && !scene.videoUrl) {
      throw new Error(`invariant: ${scene.id} EVALUATING without video`);
    }
  }
}
