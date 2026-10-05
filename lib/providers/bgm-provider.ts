import fs from "node:fs";
import path from "node:path";
import { runFfmpeg } from "@/lib/ffmpeg";

/**
 * BGM Provider（用户反馈 #3 v2：真实音乐生成）。
 * 端点：TokenHub 代理的 MiniMax 音乐生成（minimax-music-v3.0）。
 * 生成失败时宁可不加 BGM，也绝不回退到程序化合成音（实测不可接受）。
 */

export type BgmMood = "upbeat" | "fresh" | "warm" | "neutral";

/** 情绪 → 音乐风格 prompt（一律器乐、无人声，广告配乐定位）。 */
export const MOOD_PROMPTS: Record<BgmMood, string> = {
  upbeat: "Energetic upbeat pop, catchy rhythm, instrumental background music for a commercial, no vocals",
  fresh: "Light refreshing summer pop, sparkling and airy, instrumental background music for a beverage commercial, no vocals",
  warm: "Warm acoustic feel-good track, gentle and cozy, instrumental background music for a commercial, no vocals",
  neutral: "Light uplifting corporate pop, clean and modern, instrumental background music, no vocals",
};

export interface BgmProvider {
  readonly name: string;
  /** 生成一段 BGM 并落盘（mp3）。 */
  synth(input: { mood: BgmMood; durationSec: number; outPath: string }): Promise<void>;
}

export function getBgmProvider(): BgmProvider | null {
  const kind = (process.env.BGM_PROVIDER ?? "minimax").toLowerCase();
  if (kind === "off") return null;
  if (kind === "minimax") return new MiniMaxMusicBgmProvider();
  return null; // synth 方案已下线
}

interface MusicTaskResponse {
  /** 实测：TokenHub 同步返回 data.audio = 直接下载 URL（也可能是 hex 音频） */
  data?: { audio?: string; task_id?: string; status?: string | number; audio_url?: string; download_url?: string };
  task_id?: string;
  base_resp?: { status_code?: number; status_msg?: string };
  error?: { message?: string };
}

/** TokenHub / MiniMax 音乐生成。 */
export class MiniMaxMusicBgmProvider implements BgmProvider {
  readonly name = "minimax-music";
  private readonly baseUrl = process.env.MUSIC_API_URL?.trim() ||
    "https://tokenhub.tencentmaas.com/v1/wand/minimax-music/generation";
  private readonly apiKey = process.env.MUSIC_API_KEY?.trim() ?? "";

  async synth(input: { mood: BgmMood; durationSec: number; outPath: string }): Promise<void> {
    if (!this.apiKey) throw new Error("MUSIC_API_KEY 未配置（TokenHub 音乐生成）");

    const body = {
      model: process.env.MUSIC_API_MODEL?.trim() || "minimax-music-v3.0",
      prompt: MOOD_PROMPTS[input.mood],
      lyrics_optimizer: false,
    };
    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });
    const parsed = (await response.json()) as MusicTaskResponse;
    if (!response.ok || parsed.error) {
      throw new Error(`音乐生成失败: ${parsed.error?.message ?? `HTTP ${response.status}`}`);
    }

    let audio: Buffer | undefined;
    let remoteUrl: string | undefined;

    // 形态一：同步返回——data.audio 可能是下载 URL，也可能是 hex 编码音频
    const inlineAudio = parsed.data?.audio;
    if (inlineAudio && /^https?:\/\//i.test(inlineAudio)) {
      remoteUrl = inlineAudio;
    } else if (inlineAudio && /^[0-9a-f]+$/i.test(inlineAudio) && inlineAudio.length > 1000) {
      audio = Buffer.from(inlineAudio, "hex");
    } else if (parsed.data?.audio_url || parsed.data?.download_url) {
      remoteUrl = parsed.data.audio_url ?? parsed.data.download_url;
    } else if (parsed.data?.task_id || parsed.task_id) {
      // 形态二：异步任务 → 轮询
      const taskId = parsed.data?.task_id ?? parsed.task_id!;
      remoteUrl = await this.pollForAudioUrl(taskId);
    }
    if (!audio && remoteUrl) {
      const download = await fetch(remoteUrl, { signal: AbortSignal.timeout(120_000) });
      if (!download.ok) throw new Error(`BGM 下载失败 HTTP ${download.status}`);
      audio = Buffer.from(await download.arrayBuffer());
    }
    if (!audio || audio.length < 1000) throw new Error("音乐生成返回了空音频");

    // 保存完整曲目，再按成片时长裁剪（保留淡入淡出给混音阶段处理）
    fs.mkdirSync(path.dirname(input.outPath), { recursive: true });
    const full = `${input.outPath}.full.mp3`;
    fs.writeFileSync(full, audio);
    await runFfmpeg([
      "-i", full,
      "-t", input.durationSec.toFixed(2),
      "-c:a", "libmp3lame", "-b:a", "128k",
      input.outPath,
    ]);
    fs.rmSync(full, { force: true });
  }

  private async pollForAudioUrl(taskId: string): Promise<string> {
    const deadline = Date.now() + 240_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5000));
      const query = `${this.baseUrl}?task_id=${encodeURIComponent(taskId)}`;
      const response = await fetch(query, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(30_000),
      });
      const parsed = (await response.json()) as MusicTaskResponse;
      const url = parsed.data?.audio_url ?? parsed.data?.download_url;
      if (url) return url;
      if (parsed.data?.audio) {
        throw new Error("poll returned inline audio — unsupported shape");
      }
      const status = parsed.data?.status;
      if (status === "failed" || status === "Fail") {
        throw new Error(parsed.base_resp?.status_msg ?? "音乐生成任务失败");
      }
    }
    throw new Error("音乐生成任务超时");
  }
}

/** Pure: 最终混音参数——BGM 音量 + 人声侧链闪避 + 首尾淡化。 */
export function buildBgmMixArgs(input: { totalSec: number; bgmVolume?: number }): { volumePart: string; fadeOutStart: number } {
  const volume = input.bgmVolume ?? Number(process.env.BGM_VOLUME ?? 0.35);
  const fadeOutStart = Math.max(0, input.totalSec - 1.0);
  return { volumePart: `volume=${volume}`, fadeOutStart };
}
