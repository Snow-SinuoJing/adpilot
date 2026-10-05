import { randomUUID } from "node:crypto";
import path from "node:path";
import os from "node:os";
import type { VideoProvider, VideoSubmitInput, VideoJobResult } from "./video-provider";
import { runFfmpeg } from "@/lib/ffmpeg";
import { ensureDir } from "@/lib/paths";

/**
 * FakeVideoProvider — offline safety net. It produces REAL playable mp4
 * files via project-local ffmpeg, so the entire pipeline (preview, frame
 * extraction, critic, composition) runs with zero API cost and zero network.
 * Used for: development, tests, contract runs and live-demo fallback.
 */

const TMP_ROOT = path.join(os.tmpdir(), "adpilot-fake-video");

function hashOf(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/** Pure command builder (unit-tested): animated gradient + scene label. */
export function buildFakeVideoArgs(input: {
  dest: string;
  durationSec: number;
  labelLines: string[];
  seedText: string;
  aspectRatio?: "9:16" | "16:9";
}): string[] {
  const seed = hashOf(input.seedText) % 360;
  const size = input.aspectRatio === "16:9" ? "1920x1080" : "1080x1920";
  const drawtext = input.labelLines
    .map((line, i) =>
      line.replace(/([':\\])/g, "\\$1").replace(/%/g, "\\%"),
    )
    .map(
      (escaped, i) =>
        `drawtext=text='${escaped}':fontcolor=white:fontsize=54:x=(w-text_w)/2:y=h*${0.42 + i * 0.09}:borderw=4:bordercolor=black@0.85`,
    )
    .join(",");

  return [
    "-f", "lavfi",
    "-i", `gradients=size=${size}:duration=${input.durationSec}:speed=0.08:c0=0x1e2a4a:c1=0x8e44ad:c2=0x27ae60:seed=${seed}`,
    "-vf",
    `format=yuv420p,${drawtext}`,
    "-r", "30",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    input.dest,
  ];
}

export class FakeVideoProvider implements VideoProvider {
  readonly name = "fake";
  readonly model = "fake-ffmpeg-procedural";
  private jobs = new Map<string, { result: VideoJobResult; polledOnce: boolean }>();

  async submit(input: VideoSubmitInput): Promise<{ jobId: string }> {
    const jobId = `fake_${randomUUID().slice(0, 8)}`;
    const dest = path.join(ensureDir(TMP_ROOT), `${jobId}.mp4`);
    const firstWords = input.prompt.split(/\s+/).slice(0, 6).join(" ");

    await runFfmpeg(
      buildFakeVideoArgs({
        dest,
        durationSec: Math.min(Math.max(input.durationSec, 3), 10),
        labelLines: ["AI GENERATED (fake provider)", firstWords],
        seedText: input.prompt,
        aspectRatio: input.aspectRatio,
      }),
    );

    this.jobs.set(jobId, {
      result: { status: "COMPLETED", videoUrl: `local:${dest}` },
      polledOnce: false,
    });
    return { jobId };
  }

  async getStatus(jobId: string): Promise<VideoJobResult> {
    const job = this.jobs.get(jobId);
    if (!job) return { status: "FAILED", error: `unknown fake job ${jobId}` };
    // first probe reports RUNNING once so the polling loop is exercised
    if (!job.polledOnce) {
      job.polledOnce = true;
      return { status: "RUNNING" };
    }
    return job.result;
  }
}
