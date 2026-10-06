import fs from "node:fs";
import type { ProjectState } from "@/lib/state/schema";
import { localPathForMedia, mediaFile, urlForMedia } from "@/lib/media";
import { runFfmpeg, probeDurationSec } from "@/lib/ffmpeg";
import { getBgmProvider, buildBgmMixArgs, type BgmMood } from "@/lib/providers/bgm-provider";

/**
 * compose_video（设计文档 §8.5，按用户反馈 #2/#3 重构）：
 *
 * 1. 时长再平衡（音频驱动）：场景实际时长 = max(计划时长, 配音+缓冲)，
 *    差额从有富余的场景扣回，总长精确等于简报时长——配音永远说得完。
 * 2. 慢放代替冻结：画面短于时长时先慢放补齐（≤1.45x 电影感），仍不够
 *    才克隆末帧；消除"停在最后一帧等音频"。
 * 3. BGM：程序化氛围垫乐 + 人声侧链闪避 + 首尾淡化。
 */

const TARGET_FPS = 30;
const MAX_SLOWMO = 1.45;

function targetDims(aspectRatio?: string): { w: number; h: number } {
  return aspectRatio === "16:9" ? { w: 1920, h: 1080 } : { w: 1080, h: 1920 };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Pure: 音频驱动的时长再分配（voiceDurs[i] 为 null 表示无配音）。 */
export function planSceneDurations(
  planned: number[],
  voiceDurs: Array<number | null>,
  total: number,
): number[] {
  const desired = planned.map((p, i) => {
    const v = voiceDurs[i];
    if (v == null) return p;
    // 配音需要更长画面：最多比计划多 3 秒
    return Math.max(p, Math.min(v + 0.5, p + 3));
  });

  const floor = desired.map((d, i) => {
    const v = voiceDurs[i];
    return Math.max(2, v != null ? v + 0.35 : 2);
  });

  const dur = desired.slice();
  let diff = round2(total - dur.reduce((a, b) => a + b, 0));

  // 需要压缩：从有富余（dur > floor）的场景按富余比例扣
  if (diff < 0) {
    for (let guard = 0; guard < 20 && diff < -0.01; guard++) {
      const slack = dur.map((d, i) => Math.max(0, round2(d - floor[i])));
      const totalSlack = slack.reduce((a, b) => a + b, 0);
      if (totalSlack <= 0) break; // 全部触底：接受总长略超（宁超勿切语音）
      const take = Math.min(-diff, totalSlack);
      for (let i = 0; i < dur.length; i++) {
        const cut = round2((slack[i] / totalSlack) * take);
        dur[i] = round2(Math.max(floor[i], dur[i] - cut));
      }
      diff = round2(total - dur.reduce((a, b) => a + b, 0));
    }

    // 全部触底仍超（配音过长）：按比例硬压缩到总时长，超出的语音由变速补偿
    const sum = round2(dur.reduce((a, b) => a + b, 0));
    if (sum > total) {
      const factor = total / sum;
      for (let i = 0; i < dur.length; i++) dur[i] = round2(Math.max(1.5, dur[i] * factor));
    }

    return dur;
  }

  // 有富余：按空间比例加回（每场景不超过计划 +3s）
  if (diff > 0) {
    for (let guard = 0; guard < 20 && diff > 0.01; guard++) {
      const room = dur.map((d, i) => Math.max(0, round2(planned[i] + 3 - d)));
      const totalRoom = room.reduce((a, b) => a + b, 0);
      if (totalRoom <= 0) break;
      const give = Math.min(diff, totalRoom);
      for (let i = 0; i < dur.length; i++) {
        const add = round2((room[i] / totalRoom) * give);
        dur[i] = round2(dur[i] + add);
      }
      diff = round2(total - dur.reduce((a, b) => a + b, 0));
    }
  }
  return dur;
}

/** Pure: 单场景标准化参数（慢放优先于冻结帧）。 */
export function buildNormalizeArgs(input: {
  videoPath: string;
  audioPath?: string;
  durationSec: number;
  outPath: string;
  aspectRatio?: "9:16" | "16:9";
  srcDur?: number;
  /** 配音变速系数（>1 加速）：配音过长时压缩语音以贴合总时长 */
  voiceTempo?: number;
}): string[] {
  const { w, h } = targetDims(input.aspectRatio);

  // 画面短于目标：先慢放（≤1.45x）补足；仍不够用倒放回接（ping-pong）
  // 循环补齐——画面持续运动，绝不用冻结末帧（用户反馈：停滞观感大打折扣）
  const target = input.durationSec;
  const normalize = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},fps=${TARGET_FPS}`;
  let videoGraph: string;

  if (input.srcDur != null && input.srcDur > 0.1 && input.srcDur < target) {
    const slow = Math.min(target / input.srcDur, MAX_SLOWMO);
    const slowedDur = input.srcDur * slow;
    const base = slow > 1.001 ? `${normalize},setpts=${slow.toFixed(4)}*PTS` : normalize;

    if (slowedDur >= target - 0.05) {
      videoGraph = `${base},trim=duration=${target.toFixed(2)},setpts=PTS-STARTPTS`;
    } else {
      // 需要几段正放/倒放拼接（每段长度 = slowedDur）
      const parts = Math.max(2, Math.ceil(target / slowedDur - 0.001));
      const pads = Array.from({ length: parts }, (_, i) => `[pp${i}]`);
      const chain =
        `${base}[base];` +
        `[base]split=${parts}${pads.join("")};` +
        pads
          .map((p, i) => (i % 2 === 1 ? `${p}reverse[rv${i}];` : ""))
          .filter(Boolean)
          .join("") +
        pads.map((_, i) => (i % 2 === 1 ? `[rv${i}]` : `[pp${i}]`)).join("") +
        `concat=n=${parts}:v=1:a=0[cat];` +
        `[cat]trim=duration=${target.toFixed(2)},setpts=PTS-STARTPTS`;
      videoGraph = chain;
    }
  } else {
    videoGraph = `${normalize},trim=duration=${target.toFixed(2)},setpts=PTS-STARTPTS`;
  }
  videoGraph += ",format=yuv420p";

  const args: string[] = ["-i", input.videoPath];
  if (input.audioPath) args.push("-i", input.audioPath);

  args.push(
    "-filter_complex",
    `[0:v]${videoGraph}[v]` +
      (input.audioPath
        ? `;[1:a]${input.voiceTempo && input.voiceTempo > 1.001 ? `atempo=${input.voiceTempo.toFixed(3)},` : ""}aresample=44100,apad,atrim=duration=${input.durationSec.toFixed(2)}[a]`
        : `;anullsrc=r=44100:cl=mono,atrim=duration=${input.durationSec.toFixed(2)}[a]`),
    "-map", "[v]",
    "-map", "[a]",
    "-t", input.durationSec.toFixed(2),
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

/** Pure: BGM 混音（人声侧链闪避 + 首尾淡化）。 */
export function buildBgmDubArgs(input: { videoNoBgm: string; bgmPath: string; outPath: string; totalSec: number }): string[] {
  const { volumePart, fadeOutStart } = buildBgmMixArgs({ totalSec: input.totalSec });
  return [
    "-i", input.videoNoBgm,
    "-i", input.bgmPath,
    "-filter_complex",
    `[1:a]${volumePart},atrim=duration=${input.totalSec.toFixed(2)},afade=t=in:d=0.6,afade=t=out:st=${fadeOutStart.toFixed(2)}:d=1.0[bgm];` +
      `[bgm][0:a]sidechaincompress=threshold=0.02:ratio=12:attack=8:release=350:makeup=1[duck];` +
      `[0:a][duck]amix=inputs=2:duration=first:normalize=0[a]`,
    "-map", "0:v",
    "-map", "[a]",
    "-c:v", "copy",
    "-c:a", "aac",
    "-b:a", "160k",
    "-movflags", "+faststart",
    input.outPath,
  ];
}

function moodOf(state: ProjectState): BgmMood {
  const emotion = state.strategy?.targetEmotion ?? "";
  if (/活力|兴奋|节奏|energetic|upbeat/i.test(emotion)) return "upbeat";
  if (/清爽|清新|fresh|夏/.test(emotion)) return "fresh";
  if (/温暖|治愈|放松|warm|cozy/.test(emotion)) return "warm";
  return "neutral";
}

export async function composeFinalVideo(
  projectId: string,
  state: ProjectState,
  onStage?: (message: string) => void,
): Promise<string> {
  const ordered = [...state.scenes].sort((a, b) => a.order - b.order);
  if (ordered.some((s) => !s.videoUrl)) {
    throw new Error("cannot compose: a scene has no video");
  }

  // 探测每段画面与配音的真实时长 → 音频驱动的时长分配
  const srcDurs = await Promise.all(ordered.map((s) => probeDurationSec(localPathForMedia(s.videoUrl!))));
  const voiceDurs = await Promise.all(
    ordered.map((s) =>
      s.audioUrl
        ? probeDurationSec(localPathForMedia(s.audioUrl)).catch(() => null)
        : Promise.resolve(null),
    ),
  );
  const durations = planSceneDurations(
    ordered.map((s) => s.durationSec),
    voiceDurs,
    state.brief.durationSec,
  );

  const segments: string[] = [];
  for (const [i, scene] of ordered.entries()) {
    const source = localPathForMedia(scene.videoUrl!);
    const segment = mediaFile(projectId, `seg-${scene.id}.mp4`);
    const audio = scene.audioUrl ? localPathForMedia(scene.audioUrl) : undefined;
    await runFfmpeg(
      buildNormalizeArgs({
        videoPath: source,
        audioPath: audio,
        durationSec: durations[i],
        outPath: segment,
        aspectRatio: state.brief.aspectRatio,
        srcDur: srcDurs[i],
        voiceTempo:
          voiceDurs[i] && durations[i] > 0.5
            ? Math.min(1.45, Math.max(1, (voiceDurs[i] as number) / (durations[i] - 0.15)))
            : 1,
      }),
    );
    segments.push(segment);
  }

  const videoNoBgm = mediaFile(projectId, "final-nobgm.mp4");
  const { args } = buildConcatArgs(segments, videoNoBgm);
  await runFfmpeg(args);

  // BGM：氛围垫乐 + 侧链闪避混音（失败则保留纯人声版，不阻塞交付）
  const final = mediaFile(projectId, "final.mp4");
  let finalFile = videoNoBgm;
  const bgm = getBgmProvider();
  if (bgm) {
    const totalSec = durations.reduce((a, b) => a + b, 0);
    const bgmPath = mediaFile(projectId, "bgm.mp3");
    try {
      onStage?.("正在生成背景音乐（真实音乐生成约 1-3 分钟）…");
      await bgm.synth({ mood: moodOf(state), durationSec: totalSec + 1, outPath: bgmPath });
      onStage?.("背景音乐就绪，混音中…");
      await runFfmpeg(buildBgmDubArgs({ videoNoBgm, bgmPath, outPath: final, totalSec: totalSec + 1 }));
      finalFile = final;
    } catch (error) {
      // 真音乐生成失败：保留纯人声版本，绝不用合成音兜底
      console.warn("[bgm] 音乐生成/混音失败，本片无 BGM:", error);
    }
  }
  if (finalFile !== final) {
    fs.copyFileSync(videoNoBgm, final);
  }

  // 校验：最终成片必须接近简报总时长
  const finalDuration = await probeDurationSec(final);
  const expected = state.brief.durationSec;
  if (Math.abs(finalDuration - expected) > 1.5) {
    throw new Error(`composed duration ${finalDuration.toFixed(1)}s deviates from brief ${expected}s`);
  }

  return urlForMedia(final);
}
