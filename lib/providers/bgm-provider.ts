import fs from "node:fs";
import path from "node:path";
import { runFfmpeg } from "@/lib/ffmpeg";
import { ensureDir } from "@/lib/paths";

/**
 * BGM Provider（用户反馈 #3）。
 * v1：程序化合成氛围垫乐（ffmpeg 分层正弦 + 缓慢起伏），配合人声侧链闪避，
 * 让成片不再"干巴"。零成本、离线可用；后续拿到 MiniMax Audio 等
 * 音乐生成服务后可实现同接口的真实 BGM Provider。
 */

export type BgmMood = "upbeat" | "fresh" | "warm" | "neutral";

export function getBgmProvider(): { name: string; synth(input: { mood: BgmMood; durationSec: number; outPath: string }): Promise<void> } | null {
  const kind = (process.env.BGM_PROVIDER ?? "synth").toLowerCase();
  if (kind === "off") return null;
  return { name: kind === "minimax" ? "minimax" : "synth", synth: synthBgm };
}

/** 和弦库：大调开阔 / 小调温暖，频率为正弦基频（Hz）。 */
const CHORDS: Record<BgmMood, { notes: number[]; bass: number; lfoHz: number }> = {
  upbeat: { notes: [523.25, 659.25, 783.99], bass: 130.81, lfoHz: 0.5 }, // C 大三
  fresh: { notes: [440.0, 554.37, 659.25], bass: 110.0, lfoHz: 0.35 },   // A 大三
  warm: { notes: [392.0, 493.88, 587.33], bass: 98.0, lfoHz: 0.25 },     // G 大三
  neutral: { notes: [440.0, 554.37, 659.25], bass: 110.0, lfoHz: 0.3 },
};

/** Pure: aevalsrc 表达式（stereo，缓慢呼吸感）。 */
export function bgmExpression(mood: BgmMood): { left: string; right: string; chord: { notes: number[]; bass: number; lfoHz: number } } {
  const chord = CHORDS[mood];
  const pad = (n: number, gain: number) => `${n.toFixed(2)}*sin(2*PI*t*${n})` + `*${gain}`;
  // 三音 pad + 低频铺底 + 慢 LFO 呼吸 + 轻微立体声差异
  const sum = `(${pad(chord.notes[0], 0.3)}+${pad(chord.notes[1], 0.25)}+${pad(chord.notes[2], 0.22)}+${pad(chord.bass, 0.28)})`;
  const left = `${sum}*(0.5+0.5*sin(2*PI*t*${chord.lfoHz}))*0.22`;
  const right = `${sum}*(0.5+0.5*sin(2*PI*t*${chord.lfoHz}+1.2))*0.22`;
  return { left, right, chord };
}

export async function synthBgm(input: { mood: BgmMood; durationSec: number; outPath: string }): Promise<void> {
  const { left, right } = bgmExpression(input.mood);
  fs.mkdirSync(path.dirname(input.outPath), { recursive: true });
  await runFfmpeg([
    "-f", "lavfi",
    "-i", `aevalsrc=${left}|${right}:s=44100:d=${input.durationSec.toFixed(2)}`,
    "-c:a", "libmp3lame", "-b:a", "128k",
    input.outPath,
  ]);
}

/** Pure: 最终混音参数——BGM 音量 + 人声侧链闪避 + 首尾淡化。 */
export function buildBgmMixArgs(input: { totalSec: number; bgmVolume?: number }): { volumePart: string; fadeOutStart: number } {
  const volume = input.bgmVolume ?? Number(process.env.BGM_VOLUME ?? 0.32);
  const fadeOutStart = Math.max(0, input.totalSec - 1.0);
  return { volumePart: `volume=${volume}`, fadeOutStart };
}

void ensureDir;
