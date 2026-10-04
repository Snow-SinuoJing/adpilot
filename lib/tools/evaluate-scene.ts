import type { CriticResult, ProjectState } from "@/lib/state/schema";
import { criticView } from "@/lib/state/selectors";
import { localPathForMedia } from "@/lib/media";
import { extractFrames } from "./extract-frames";
import { evaluateSceneFrames } from "@/lib/agents/critic";

/**
 * EVALUATE_SCENE tool: observe the real generated footage (keyframes),
 * then let the Multimodal Critic judge it against the scene intent.
 * A tool call succeeding is NOT the same as the task succeeding.
 */

function generationIndex(videoUrl: string): number {
  const match = videoUrl.match(/-gen(\d+)\.mp4$/);
  return match ? Number(match[1]) : 1;
}

export async function evaluateScene(
  state: ProjectState,
  sceneId: string,
): Promise<{ result: CriticResult; frameUrls: string[] }> {
  const view = criticView(state, sceneId);
  const scene = state.scenes.find((s) => s.id === sceneId)!;
  if (!scene.videoUrl) throw new Error(`scene ${sceneId} has no video to evaluate`);

  const { framePaths, frameUrls } = await extractFrames({
    videoPath: localPathForMedia(scene.videoUrl),
    projectId: state.projectId,
    sceneId,
    generationIndex: generationIndex(scene.videoUrl),
  });

  const result = await evaluateSceneFrames(view, framePaths);
  return { result, frameUrls };
}
