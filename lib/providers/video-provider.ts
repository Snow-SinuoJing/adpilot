import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { MiniMaxVideoProvider } from "./minimax-video-provider";
import { FakeVideoProvider } from "./fake-video-provider";

/**
 * VideoProvider abstraction (design doc §9) — the Agent layer never knows
 * which generation platform is behind it. v1 ships MiniMax + Fake;
 * adding Kling later is a pure increment.
 */

export interface VideoSubmitInput {
  prompt: string;
  durationSec: number;
  aspectRatio: "9:16" | "16:9";
}

export type VideoJobStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";

export interface VideoJobResult {
  status: VideoJobStatus;
  /** Remote download URL, or a `local:` prefixed absolute path (fake provider). */
  videoUrl?: string;
  error?: string;
  /** Extra provider metadata (e.g. native resolution of the generation). */
  meta?: Record<string, unknown>;
}

export interface VideoProvider {
  readonly name: string;
  readonly model: string;
  submit(input: VideoSubmitInput): Promise<{ jobId: string }>;
  getStatus(jobId: string): Promise<VideoJobResult>;
}

export function getVideoProvider(): VideoProvider | null {
  const kind = (process.env.VIDEO_PROVIDER ?? "fake").toLowerCase();
  if (kind === "none") return null;
  if (kind === "minimax") return new MiniMaxVideoProvider();
  return new FakeVideoProvider();
}

/** Fetch a remote video into dest; understands `local:` passthrough. */
export async function downloadVideo(videoUrl: string, dest: string): Promise<string> {
  const fs = await import("node:fs");
  if (videoUrl.startsWith("local:")) {
    const src = videoUrl.slice("local:".length);
    fs.copyFileSync(src, dest);
    return dest;
  }
  const response = await fetch(videoUrl);
  if (!response.ok || !response.body) {
    throw new Error(`download failed (${response.status}) for ${videoUrl.slice(0, 120)}`);
  }
  const { Readable } = await import("node:stream");
  const { pipeline } = await import("node:stream/promises");
  const nodeStream = Readable.fromWeb(response.body as WebReadableStream<Uint8Array>);
  await pipeline(nodeStream, fs.createWriteStream(dest));
  return dest;
}
