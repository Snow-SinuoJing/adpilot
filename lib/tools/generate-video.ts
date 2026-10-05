import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CACHE_DIR, ensureDir } from "@/lib/paths";
import { mediaFile, urlForMedia } from "@/lib/media";
import { getVideoProvider, downloadVideo } from "@/lib/providers/video-provider";

/**
 * generate_video + get_video_status (design doc §8.2 / §8.3).
 * The LLM never sleeps, retries or parses HTTP — this runtime tool owns
 * submit → poll → timeout → cache → download, with idempotent cache keys.
 */

export type ProgressFn = (message: string, extra?: Record<string, unknown>) => void;

export interface SceneVideoRequest {
  projectId: string;
  sceneId: string;
  prompt: string;
  durationSec: number;
  generationIndex: number;
  aspectRatio?: "9:16" | "16:9";
  onProgress?: ProgressFn;
}

export interface SceneVideoResult {
  videoUrl: string;
  localPath: string;
  fromCache: boolean;
  provider: string;
  model: string;
  jobId?: string;
}

// ─── cache (§17 Mode B) ──────────────────────────────────────────────────────

export function cacheKey(input: {
  provider: string;
  model: string;
  prompt: string;
  durationSec: number;
  aspectRatio: string;
}): string {
  return createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex")
    .slice(0, 32);
}

interface CacheEntry {
  key: string;
  provider: string;
  model: string;
  promptHash: string;
  createdAt: string;
  file: string;
}

function cacheFileFor(key: string): string {
  return path.join(ensureDir(CACHE_DIR), `${key}.json`);
}

export function readVideoCache(key: string): CacheEntry | null {
  const file = cacheFileFor(key);
  if (!fs.existsSync(file)) return null;
  try {
    const entry = JSON.parse(fs.readFileSync(file, "utf8")) as CacheEntry;
    return fs.existsSync(entry.file) ? entry : null;
  } catch {
    return null;
  }
}

export function writeVideoCache(entry: CacheEntry): void {
  fs.writeFileSync(cacheFileFor(entry.key), JSON.stringify(entry, null, 2));
}

function demoMode(): "live" | "cache" | "replay" {
  const mode = process.env.DEMO_MODE?.trim().toLowerCase();
  return mode === "live" || mode === "replay" ? mode : "cache";
}

// ─── polling (§8.3) ──────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class VideoJobTimeoutError extends Error {
  constructor(jobId: string, waitedMs: number) {
    super(`video job ${jobId} timed out after ${Math.round(waitedMs / 1000)}s`);
    this.name = "VideoJobTimeoutError";
  }
}

/** Runtime-owned polling loop with exponential submit retry (§18.2). */
export async function pollVideoJob(
  provider: { name: string; getStatus(jobId: string): Promise<{ status: string; videoUrl?: string; error?: string }> },
  jobId: string,
  opts: { intervalMs: number; timeoutMs: number; onProgress?: ProgressFn },
): Promise<string> {
  const startedAt = Date.now();
  let lastReport = 0;
  while (Date.now() - startedAt < opts.timeoutMs) {
    const result = await provider.getStatus(jobId);
    if (result.status === "COMPLETED" && result.videoUrl) return result.videoUrl;
    if (result.status === "FAILED") {
      throw new Error(`video provider failed: ${result.error ?? "unknown"}`);
    }
    if (opts.onProgress && Date.now() - lastReport > 15_000) {
      lastReport = Date.now();
      opts.onProgress(`视频任务 ${jobId}：${result.status === "RUNNING" ? "生成中" : "排队中"}`, { status: result.status });
    }
    await sleep(opts.intervalMs);
  }
  throw new VideoJobTimeoutError(jobId, Date.now() - startedAt);
}

/** Submit with exponential retry for transient 5xx-class failures. */
async function submitWithRetry(
  provider: { submit(input: { prompt: string; durationSec: number; aspectRatio: "9:16" | "16:9" }): Promise<{ jobId: string }> },
  input: { prompt: string; durationSec: number; aspectRatio: "9:16" | "16:9" },
  onProgress?: ProgressFn,
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { jobId } = await provider.submit({ ...input, aspectRatio: "9:16" });
      return jobId;
    } catch (error) {
      lastError = error;
      if (attempt < 2) {
        const backoff = 2_000 * 2 ** attempt;
        onProgress?.(`提交失败（第 ${attempt + 1} 次），${backoff / 1000} 秒后重试`);
        await sleep(backoff);
      }
    }
  }
  throw new Error(`video submit failed after retries: ${String(lastError)}`);
}

// ─── entry point ─────────────────────────────────────────────────────────────

function pollSettings(providerName: string): { intervalMs: number; timeoutMs: number } {
  const isFake = providerName === "fake";
  return {
    intervalMs: isFake ? 50 : Number(process.env.VIDEO_POLL_INTERVAL_MS ?? 5000),
    timeoutMs: isFake ? 60_000 : Number(process.env.VIDEO_POLL_TIMEOUT_MS ?? 300_000),
  };
}

export async function generateSceneVideo(request: SceneVideoRequest): Promise<SceneVideoResult> {
  const provider = getVideoProvider();
  if (!provider) throw new Error("no video provider configured");

  const aspect = request.aspectRatio ?? "9:16";
  const key = cacheKey({
    provider: provider.name,
    model: provider.model,
    prompt: request.prompt,
    durationSec: request.durationSec,
    aspectRatio: aspect,
  });

  // Cache-aware live mode (§17 Mode B): reuse a real generation for an
  // identical request instead of burning another paid call.
  if (demoMode() !== "live") {
    const hit = readVideoCache(key);
    if (hit) {
      request.onProgress?.(`命中缓存：完全相同的生成请求直接复用真实结果`, { cacheKey: key });
      const dest = mediaFile(request.projectId, `${request.sceneId}-gen${request.generationIndex}.mp4`);
      fs.copyFileSync(hit.file, dest);
      return {
        videoUrl: urlForMedia(dest),
        localPath: dest,
        fromCache: true,
        provider: hit.provider,
        model: hit.model,
      };
    }
  }

  request.onProgress?.(
    `提交到 ${provider.name}（${provider.model}）`,
    { provider: provider.name, model: provider.model },
  );
  const jobId = await submitWithRetry(provider, {
    prompt: request.prompt,
    durationSec: request.durationSec,
    aspectRatio: aspect,
  }, request.onProgress);
  request.onProgress?.(`任务已受理：${jobId}`, { jobId });

  const { intervalMs, timeoutMs } = pollSettings(provider.name);
  const videoUrl = await pollVideoJob(provider, jobId, {
    intervalMs,
    timeoutMs,
    onProgress: request.onProgress,
  });

  const dest = mediaFile(request.projectId, `${request.sceneId}-gen${request.generationIndex}.mp4`);
  await downloadVideo(videoUrl, dest);

  writeVideoCache({
    key,
    provider: provider.name,
    model: provider.model,
    promptHash: createHash("sha256").update(request.prompt).digest("hex").slice(0, 16),
    createdAt: new Date().toISOString(),
    file: dest,
  });

  return {
    videoUrl: urlForMedia(dest),
    localPath: dest,
    fromCache: false,
    provider: provider.name,
    model: provider.model,
    jobId,
  };
}
