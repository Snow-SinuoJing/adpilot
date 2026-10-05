import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import ffmpegStatic from "ffmpeg-static";
import type {
  VideoJobResult,
  VideoProvider,
  VideoSubmitInput,
} from "./video-provider";

const execFileAsync = promisify(execFile);

/**
 * MiniMax video generation (the real Provider for v1).
 * 2026 API flow (verified against the live endpoint):
 *   POST {base}/v1/video_generation              → { task_id, base_resp }
 *   GET  {base}/v1/query/video_generation?task_id=… → { status, file_id, video_width/height }
 *   GET  {base}/v1/files/retrieve?file_id=…&purpose=video-generation → { file.download_url }
 * Model name and base URL are env-driven so endpoint changes never touch
 * the Agent layer.
 */

interface MiniMaxBaseResp {
  status_code?: number;
  status_msg?: string;
}

function env(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

export class MiniMaxVideoProvider implements VideoProvider {
  readonly name = "minimax";
  readonly model = env("MINIMAX_VIDEO_MODEL", "MiniMax-H3-Max");
  private readonly baseUrl = env("MINIMAX_BASE_URL", "https://api.minimaxi.com");
  private readonly apiKey = process.env.MINIMAX_API_KEY?.trim() ?? "";

  /** H3 系列走新一代 /v2 接口（content 消息体 + resolution/duration），其余走 /v1。 */
  private isV2(): boolean {
    return /H3|h3/i.test(this.model) || process.env.MINIMAX_VIDEO_API === "v2";
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  async submit(input: VideoSubmitInput): Promise<{ jobId: string }> {
    // 平台不支持 aspect 参数：用与目标画幅一致的首帧锚定方向（实测可靠）
    const firstFrame = await verticalFirstFrameDataUrl(input.prompt, input.aspectRatio ?? "9:16");

    if (this.isV2()) {
      const body = miniMaxV2SubmitBody(input, this.model, firstFrame);
      const response = await fetch(`${this.baseUrl}/v2/video_generation`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
      const parsed = (await response.json()) as { task_id?: string; error?: { message?: string } };
      if (!response.ok || !parsed.task_id) {
        throw new Error(
          `minimax v2 submit failed: HTTP ${response.status} ${parsed.error?.message ?? "unknown error"}`,
        );
      }
      return { jobId: parsed.task_id };
    }

    const body: Record<string, unknown> = {
      model: this.model,
      prompt: input.prompt,
      prompt_optimizer: true,
    };
    if (process.env.MINIMAX_VERTICAL_FIRST_FRAME !== "0") {
      body.first_frame_image = firstFrame;
    }
    const response = await fetch(`${this.baseUrl}/v1/video_generation`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const parsed = (await response.json()) as {
      task_id?: string;
      base_resp?: MiniMaxBaseResp;
    };
    const base = parsed.base_resp;
    if (!response.ok || base?.status_code !== 0 || !parsed.task_id) {
      throw new Error(
        `minimax submit failed: HTTP ${response.status} ${base?.status_msg ?? "unknown error"}`,
      );
    }
    return { jobId: parsed.task_id };
  }

  async getStatus(jobId: string): Promise<VideoJobResult> {
    if (this.isV2()) {
      const response = await fetch(
        `${this.baseUrl}/v2/query/video_generation?task_id=${encodeURIComponent(jobId)}`,
        { headers: this.headers(), signal: AbortSignal.timeout(20_000) },
      );
      return parseMiniMaxV2QueryResponse(await response.json());
    }

    const response = await fetch(
      `${this.baseUrl}/v1/query/video_generation?task_id=${encodeURIComponent(jobId)}`,
      { headers: this.headers(), signal: AbortSignal.timeout(20_000) },
    );
    const parsed = parseMiniMaxQueryResponse(await response.json());
    if (parsed.status !== "COMPLETED") return parsed;

    // Success only carries a file_id — resolve it to a download URL
    if (!parsed.fileId) return { status: "FAILED", error: "success without file_id" };
    try {
      const videoUrl = await this.retrieveDownloadUrl(parsed.fileId);
      return { status: "COMPLETED", videoUrl, meta: { width: parsed.width, height: parsed.height } };
    } catch (error) {
      return { status: "FAILED", error: `file retrieve failed: ${String(error)}` };
    }
  }

  private async retrieveDownloadUrl(fileId: string): Promise<string> {
    const response = await fetch(
      `${this.baseUrl}/v1/files/retrieve?file_id=${encodeURIComponent(fileId)}&purpose=video-generation`,
      { headers: this.headers(), signal: AbortSignal.timeout(20_000) },
    );
    const parsed = parseMiniMaxFileRetrieve(await response.json());
    return parsed;
  }
}

/** Pure: /v2 submit body（content 消息体，duration 限 5–10 秒，分辨率 480P/768P）。 */
export function miniMaxV2SubmitBody(
  input: VideoSubmitInput,
  model: string,
  firstFrameDataUrl: string,
): Record<string, unknown> {
  const duration = Math.min(Math.max(Math.round(input.durationSec), 5), 10);
  return {
    model,
    duration,
    resolution: process.env.MINIMAX_VIDEO_RESOLUTION?.trim() || "768p",
    content: [
      { type: "text", text: input.prompt },
      { type: "image_url", image_url: { url: firstFrameDataUrl } },
    ],
  };
}

/** Pure: /v2 query 响应解析（items[0].status + content.url）。 */
export function parseMiniMaxV2QueryResponse(raw: unknown): VideoJobResult {
  const body = raw as {
    items?: Array<{ status?: string; content?: { url?: string }; error?: { message?: string } }>;
  };
  const item = body.items?.[0];
  if (!item) return { status: "FAILED", error: "v2 query returned no items" };
  if (item.status === "succeeded" || item.status === "Success") {
    const url = item.content?.url;
    if (!url) return { status: "FAILED", error: "v2 succeeded without content.url" };
    return { status: "COMPLETED", videoUrl: url };
  }
  if (item.status === "failed" || item.status === "Fail") {
    return { status: "FAILED", error: item.error?.message ?? "generation failed" };
  }
  if (item.status === "running" || item.status === "Processing") return { status: "RUNNING" };
  return { status: "PENDING" };
}

// Pure helpers exported for unit tests (no network).

export function parseMiniMaxQueryResponse(
  raw: unknown,
): VideoJobResult & { fileId?: string; width?: number; height?: number } {
  const body = raw as {
    status?: string;
    file_id?: string | number;
    video_width?: number;
    video_height?: number;
    base_resp?: MiniMaxBaseResp;
  };
  const code = body.base_resp?.status_code;
  if (code !== undefined && code !== 0) {
    return { status: "FAILED", error: body.base_resp?.status_msg ?? `code ${code}` };
  }
  const fileId = body.file_id !== undefined ? String(body.file_id) : undefined;
  if (body.status === "Success") {
    return { status: "COMPLETED", fileId, width: body.video_width, height: body.video_height };
  }
  if (body.status === "Fail") return { status: "FAILED", error: "generation failed" };
  if (body.status === "Processing") return { status: "RUNNING" };
  return { status: "PENDING" };
}

export function parseMiniMaxFileRetrieve(raw: unknown): string {
  const body = raw as { file?: { download_url?: string }; base_resp?: MiniMaxBaseResp };
  const code = body.base_resp?.status_code;
  if (code !== undefined && code !== 0) {
    throw new Error(body.base_resp?.status_msg ?? `file retrieve code ${code}`);
  }
  const url = body.file?.download_url;
  if (!url) throw new Error("file retrieve returned no download_url");
  return url;
}

export function miniMaxSubmitBody(input: VideoSubmitInput, model: string): Record<string, unknown> {
  return { model, prompt: input.prompt, prompt_optimizer: true };
}

/** Deterministic 9:16 anchor frame (gradient seeded by the prompt) that
 *  steers the platform into vertical output. */
const FIRST_FRAME_PALETTE: Array<[string, string]> = [
  ["0x312e81", "0xec4899"],
  ["0x0f766e", "0xfacc15"],
  ["0x7c2d12", "0xfb923c"],
  ["0x1e3a8a", "0x22d3ee"],
  ["0x4c1d95", "0xf472b6"],
  ["0x14532d", "0xa3e635"],
];

export function firstFrameArgs(dest: string, seedText: string, aspectRatio: "9:16" | "16:9" = "9:16"): string[] {
  let hash = 0;
  for (let i = 0; i < seedText.length; i++) hash = (hash * 31 + seedText.charCodeAt(i)) | 0;
  const index = Math.abs(hash) % FIRST_FRAME_PALETTE.length;
  const seed = Math.abs(hash) % 360;
  const [c0, c1] = FIRST_FRAME_PALETTE[index];
  const size = aspectRatio === "16:9" ? "1920x1080" : "1080x1920";
  return [
    "-f", "lavfi",
    "-i", `gradients=size=${size}:duration=1:speed=0.05:seed=${seed}:c0=${c0}:c1=${c1}`,
    "-frames:v", "1",
    "-q:v", "3",
    "-update", "1",
    dest,
  ];
}

async function verticalFirstFrameDataUrl(seedText: string, aspectRatio: "9:16" | "16:9"): Promise<string> {
  const fs = await import("node:fs");
  const dest = path.join(os.tmpdir(), `adpilot-firstframe-${randomUUID().slice(0, 8)}.jpg`);
  const bin = ffmpegStatic ?? "ffmpeg";
  await execFileAsync(bin, ["-y", "-hide_banner", "-loglevel", "error", ...firstFrameArgs(dest, seedText, aspectRatio)]);
  const b64 = fs.readFileSync(dest).toString("base64");
  fs.rmSync(dest, { force: true });
  return `data:image/jpeg;base64,${b64}`;
}
