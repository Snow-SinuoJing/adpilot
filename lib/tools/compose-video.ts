import fs from "node:fs";
import type { ProjectState } from "@/lib/state/schema";
import { localPathForMedia, mediaFile, urlForMedia } from "@/lib/media";
import { runFfmpeg, probeDurationSec } from "@/lib/ffmpeg";

/**
 * compose_video (design doc §8.5):
 * normalize every scene to 1080×1920 / 30fps / h264+aac, cut or hold each
 * scene to its planned duration, mix the voiceover, concat, faststart.
 * Command builders are exported pure for unit tests.
 */

const TARGET_W = 1080;
const TARGET_H = 1920;
const TARGET_FPS = 30;

/** Normalize one scene to a uniform, concat-safe segment. Pure arg builder. */
export function buildNormalizeArgs(input: {
  videoPath: string;
  audioPath?: string;
  durationSec: number;
  outPath: string;
}): string[] {
  const scale = `scale=${TARGET_W}:${TARGET_H}:force_original_aspect_ratio=increase,crop=${TARGET_W}:${TARGET_H},fps=${TARGET_FPS},format=yuv420p`;
  // hold the last frame if the source is shorter than planned
  const videoFilters = `tpad=stop_mode=clone:stop_duration=${input.durationSec}`;

  const args: string[] = ["-i", input.videoPath];
  if (input.audioPath) args.push("-i", input.audioPath);

  args.push(
    "-filter_complex",
    `[0:v]${scale},${videoFilters}[v]` +
      (input.audioPath
        ? `;[1:a]aresample=44100,apad,atrim=duration=${input.durationSec}[a]`
        : `;anullsrc=r=44100:cl=mono,atrim=duration=${input.durationSec}[a]`),
    "-map", "[v]",
    "-map", "[a]",
    "-t", String(input.durationSec),
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-c:a", "aac",
    "-b:a", "128k",
    "-ar", "44100",
    "-pix_fmt", "yuv420p",
    input.outPath,
  );
  return args;
}

export function buildConcatArgs(segmentPaths: string[], outPath: string): { args: string[]; listFile: string } {
  const listFile = `${outPath}.concat.txt`;
  const lines = segmentPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`);
  fs.writeFileSync(listFile, `${lines.join("\n")}\n`);
  return {
    args: ["-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", "-movflags", "+faststart", outPath],
    listFile,
  };
}

export async function composeFinalVideo(projectId: string, state: ProjectState): Promise<string> {
  const ordered = [...state.scenes].sort((a, b) => a.order - b.order);
  if (ordered.some((s) => !s.videoUrl)) {
    throw new Error("cannot compose: a scene has no video");
  }

  const segments: string[] = [];
  for (const scene of ordered) {
    const source = localPathForMedia(scene.videoUrl!);
    const segment = mediaFile(projectId, `seg-${scene.id}.mp4`);
    const audio = scene.audioUrl ? localPathForMedia(scene.audioUrl) : undefined;
    await runFfmpeg(buildNormalizeArgs({
      videoPath: source,
      audioPath: audio,
      durationSec: scene.durationSec,
      outPath: segment,
    }));
    segments.push(segment);
  }

  const final = mediaFile(projectId, "final.mp4");
  const { args } = buildConcatArgs(segments, final);
  await runFfmpeg(args);

  // sanity: the final ad must be close to the brief duration
  const finalDuration = await probeDurationSec(final);
  const expected = state.brief.durationSec;
  if (Math.abs(finalDuration - expected) > 1.5) {
    throw new Error(
      `composed duration ${finalDuration.toFixed(1)}s deviates from brief ${expected}s`,
    );
  }

  return urlForMedia(final);
}
