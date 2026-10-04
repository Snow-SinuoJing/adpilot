import type { ProjectState, SceneState } from "@/lib/state/schema";

/** Hard caps from design doc §10.1 — the safety net that keeps Agent loops,
 *  cost and live-demo wall time bounded. */
export const MAX_SCENES = 3;
export const MAX_REPAIR_PER_SCENE = 1;
export const MAX_TOTAL_VIDEO_GENERATIONS = 4;
export const MAX_DIRECTOR_STEPS = 20;

export function canRepairScene(scene: SceneState): boolean {
  return scene.repairHistory.length < MAX_REPAIR_PER_SCENE;
}

export function canGenerateVideo(state: ProjectState): boolean {
  return state.runtime.totalVideoGenerations < MAX_TOTAL_VIDEO_GENERATIONS;
}

export function canTakeDirectorStep(state: ProjectState): boolean {
  return state.runtime.directorSteps < MAX_DIRECTOR_STEPS;
}
