import path from "node:path";
import { runFfmpeg, probeDurationSec } from "@/lib/ffmpeg";
import { ensureDir } from "@/lib/paths";
import { urlForMedia } from "@/lib/media";

/**
 * extract_frames (design doc §8.4): 5 keyframes at 10/30/50/70/90% of the
 * clip — just enough visual evidence for the Multimodal Critic.
 */

export const FRAME_POSITIONS = [0.1, 0.3, 0.5, 0.7, 0.9] as const;

export function frameTimestamps(durationSec: number): number[] {
  return FRAME_POSITIONS.map((p) => Math.round(durationSec * p * 100) / 100);
}

export async function extractFrames(input: {
  videoPath: string;
  projectId: string;
  sceneId: string;
  generationIndex: number;
}): Promise<{ framePaths: string[]; frameUrls: string[] }> {
  const duration = await probeDurationSec(input.videoPath);
  const dir = ensureDir(
    path.join(path.dirname(input.videoPath), `frames-${input.sceneId}-gen${input.generationIndex}`),
  );

  const framePaths: string[] = [];
  for (const [i, at] of frameTimestamps(duration).entries()) {
    const dest = path.join(dir, `frame-${i + 1}.jpg`);
    await runFfmpeg([
      "-ss", String(at),
      "-i", input.videoPath,
      "-frames:v", "1",
      "-q:v", "3",
      dest,
    ]);
    framePaths.push(dest);
  }

  return { framePaths, frameUrls: framePaths.map(urlForMedia) };
}
