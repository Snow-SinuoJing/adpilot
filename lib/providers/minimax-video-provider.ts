import type {
  VideoJobResult,
  VideoProvider,
  VideoSubmitInput,
} from "./video-provider";

/**
 * MiniMax video generation (the real Provider for v1).
 * API shape (open platform, video_generation):
 *   POST {base}/v1/video_generation          → { task_id, base_resp }
 *   GET  {base}/v1/query/video_generation?task_id=… → { status, file.download_url }
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
  readonly model = env("MINIMAX_VIDEO_MODEL", "MiniMax-Hailuo-02");
  private readonly baseUrl = env("MINIMAX_BASE_URL", "https://api.minimaxi.com");
  private readonly apiKey = process.env.MINIMAX_API_KEY?.trim() ?? "";

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  async submit(input: VideoSubmitInput): Promise<{ jobId: string }> {
    const response = await fetch(`${this.baseUrl}/v1/video_generation`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        model: this.model,
        prompt: input.prompt,
        prompt_optimizer: true,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = (await response.json()) as {
      task_id?: string;
      base_resp?: MiniMaxBaseResp;
    };
    const base = body.base_resp;
    if (!response.ok || base?.status_code !== 0 || !body.task_id) {
      throw new Error(
        `minimax submit failed: HTTP ${response.status} ${base?.status_msg ?? "unknown error"}`,
      );
    }
    return { jobId: body.task_id };
  }

  async getStatus(jobId: string): Promise<VideoJobResult> {
    const response = await fetch(
      `${this.baseUrl}/v1/query/video_generation?task_id=${encodeURIComponent(jobId)}`,
      { headers: this.headers(), signal: AbortSignal.timeout(20_000) },
    );
    const body = (await response.json()) as {
      status?: string;
      base_resp?: MiniMaxBaseResp;
      file?: { download_url?: string };
    };
    const base = body.base_resp;
    if (!response.ok || (base?.status_code !== undefined && base.status_code !== 0)) {
      return { status: "FAILED", error: base?.status_msg ?? `HTTP ${response.status}` };
    }
    switch (body.status) {
      case "Success":
        if (!body.file?.download_url) return { status: "FAILED", error: "success without download_url" };
        return { status: "COMPLETED", videoUrl: body.file.download_url };
      case "Fail":
        return { status: "FAILED", error: base?.status_msg ?? "generation failed" };
      case "Processing":
        return { status: "RUNNING" };
      default: // Preparing / Queueing
        return { status: "PENDING" };
    }
  }
}

// Pure helpers exported for unit tests (no network).
export function parseMiniMaxQueryResponse(raw: unknown): VideoJobResult {
  const body = raw as {
    status?: string;
    base_resp?: MiniMaxBaseResp;
    file?: { download_url?: string };
  };
  const code = body.base_resp?.status_code;
  if (code !== undefined && code !== 0) {
    return { status: "FAILED", error: body.base_resp?.status_msg ?? `code ${code}` };
  }
  if (body.status === "Success" && body.file?.download_url) {
    return { status: "COMPLETED", videoUrl: body.file.download_url };
  }
  if (body.status === "Fail") return { status: "FAILED", error: "generation failed" };
  if (body.status === "Processing") return { status: "RUNNING" };
  return { status: "PENDING" };
}

export function miniMaxSubmitBody(input: VideoSubmitInput, model: string): Record<string, unknown> {
  return { model, prompt: input.prompt, prompt_optimizer: true };
}
