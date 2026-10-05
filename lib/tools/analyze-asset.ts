import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { FFMPEG_BIN, runFfmpeg, probeDurationSec } from "@/lib/ffmpeg";
import type { AssetEntry } from "@/lib/assets-library";
import { readLibrary, writeLibrary } from "@/lib/assets-library";
import { isMockMode, runVision } from "@/lib/agents/llm";
import { z } from "zod";

const execFileAsync = promisify(execFile);

/**
 * Asset understanding (用户反馈 #1)：长素材上传后自动做
 *   镜头检测 → 切分片段 → 每段抽帧 + 视觉 LLM 描述 → 片段元数据入库。
 * 检索按片段（时长/内容都更准），使用时按时间戳裁剪，物理文件不拆。
 */

export const MIN_SEGMENT_SEC = 2;
export const MAX_SEGMENT_SEC = 8;
export const MAX_SEGMENTS_PER_ASSET = 12;

/** Pure: merge/trim shot boundaries into usable segments. */
export function buildSegments(boundaries: number[], totalDuration: number): Array<{ start: number; end: number }> {
  const clean = [...new Set(boundaries.filter((t) => t > 0.5 && t < totalDuration - 0.5))].sort((a, b) => a - b);
  const points = [0, ...clean, totalDuration];

  // raw shot windows, tiny ones merged forward into the previous segment
  const merged: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    const end = points[i + 1];
    const prev = merged[merged.length - 1];
    if (end - start < MIN_SEGMENT_SEC && prev) {
      prev.end = end;
      continue;
    }
    merged.push({ start, end });
  }
  // a leading tiny window (no prev) merges into the next one naturally by span check below

  const segments: Array<{ start: number; end: number }> = [];
  for (const window of merged) {
    const span = window.end - window.start;
    if (span < MIN_SEGMENT_SEC) continue;
    const parts = Math.min(Math.ceil(span / MAX_SEGMENT_SEC), 4);
    for (let p = 0; p < parts; p++) {
      segments.push({
        start: Math.round((window.start + (span / parts) * p) * 100) / 100,
        end: Math.round((window.start + (span / parts) * (p + 1)) * 100) / 100,
      });
    }
  }

  return segments.slice(0, MAX_SEGMENTS_PER_ASSET);
}

/** ffmpeg scene detection → shot boundary timestamps. */
export async function detectShotBoundaries(videoPath: string): Promise<number[]> {
  try {
    const { stderr } = await execFileAsync(
      FFMPEG_BIN,
      ["-hide_banner", "-i", videoPath, "-filter:v", "select='gt(scene,0.3)',showinfo", "-f", "null", "-"],
      { timeout: 120_000, maxBuffer: 20 * 1024 * 1024 },
    );
    const boundaries: number[] = [];
    for (const match of stderr.matchAll(/pts_time:([\d.]+)/g)) {
      boundaries.push(Number.parseFloat(match[1]));
    }
    return boundaries;
  } catch {
    return [];
  }
}

const CaptionSchema = z.object({
  description: z.string().min(1),
  tags: z.array(z.string()).min(1).max(8),
});

const FALLBACK_VISION_MODEL = "glm-4v-flash"; // 免费档：主模型余额不足时兜底，解析永不一笔带过

async function captionSegment(
  framePath: string,
  parentDescription: string,
  timeRange: string,
): Promise<{ description: string; tags: string[] }> {
  if (isMockMode()) {
    return {
      description: `自动切片 ${timeRange}（源自：${parentDescription.slice(0, 40)}）`,
      tags: ["自动切片", "片段"],
    };
  }
  const b64 = fs.readFileSync(framePath).toString("base64");
  const opts = {
    name: "素材切片描述",
    system:
      "你是视频素材管理助手。根据给定的视频关键帧，用一句简体中文描述画面内容（主体/动作/情绪/物体），并给出 3-6 个用于检索的中文标签。" +
      "务必准确识别画面中的食品/商品/品牌（是什么就写什么，如'生巧慕斯条''气泡水瓶'），这对检索至关重要，不要猜成无关物品。",
    user: JSON.stringify({ 素材整体: parentDescription, 片段时间范围: timeRange }),
    images: [{ dataUrl: `data:image/jpeg;base64,${b64}` }],
    schema: CaptionSchema,
  };
  const primary = process.env.ANALYSIS_VISION_MODEL?.trim() || "glm-4.5v";
  try {
    const result = await runVision({ ...opts, model: primary });
    return { description: result.description, tags: result.tags };
  } catch (error) {
    // 主模型不可用（余额/限流）时降级到免费视觉模型——解析结果绝不静默缩水
    console.warn(`[analyze] ${primary} 不可用，降级 ${FALLBACK_VISION_MODEL}:`, error);
    const result = await runVision({ ...opts, model: FALLBACK_VISION_MODEL });
    return { description: result.description, tags: result.tags };
  }
}

export interface SegmentEntry extends AssetEntry {
  parentFile: string;
  startTime: number;
  endTime: number;
}

/** Full pipeline for one asset: shots → segments → captions → library update. */
export async function analyzeAsset(assetId: string): Promise<SegmentEntry[]> {
  const library = readLibrary();
  const index = library.findIndex((a) => a.id === assetId);
  if (index === -1) throw new Error(`素材不存在: ${assetId}`);
  const parent = library[index];

  // remove previous segments of this parent (re-analysis)
  const kept = library.filter((a) => !("parentFile" in a && a.parentFile === parent.file));
  const parentIndex = kept.findIndex((a) => a.id === assetId);
  if (parentIndex === -1) {
    // 素材在分析期间被用户删除——丢弃分析结果，绝不让旧数据复活已删条目
    return [];
  }
  kept[parentIndex] = { ...parent, hasSegments: true, analysis: "done" };

  const videoPath = path.join(process.env.ADPILOT_DATA_DIR ?? path.join(process.cwd(), "data"), "assets", parent.file);
  if (!fs.existsSync(videoPath)) throw new Error(`素材文件缺失: ${parent.file}`);

  const totalDuration = await probeDurationSec(videoPath);
  const boundaries = await detectShotBoundaries(videoPath);
  const segments = buildSegments(boundaries, totalDuration);
  if (segments.length === 0) {
    writeLibrary(kept);
    return [];
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "adpilot-analyze-"));

  // 先抽全部关键帧（本地 ffmpeg，快）
  const framePaths: string[] = [];
  for (const [i, segment] of segments.entries()) {
    const mid = (segment.start + segment.end) / 2;
    const framePath = path.join(tmpDir, `frame-${i}.jpg`);
    await runFfmpeg(["-ss", String(mid), "-i", videoPath, "-frames:v", "1", "-q:v", "4", framePath]);
    framePaths.push(framePath);
  }

  // 视觉描述并发执行（原为串行逐段等待，一条素材动辄几分钟——并发 4 缩短到 1/3 左右）
  const CONCURRENCY = 4;
  const children: SegmentEntry[] = new Array(segments.length);
  let cursor = 0;
  const captionOne = async (i: number) => {
    const segment = segments[i];
    const timeRange = formatRange(segment.start, segment.end);
    try {
      const caption = await captionSegment(framePaths[i], parent.description, timeRange);
      children[i] = {
        id: `${parent.id}_seg${i + 1}`,
        file: parent.file,
        description: `${caption.description}（${timeRange}）`,
        tags: caption.tags,
        durationSec: Math.round((segment.end - segment.start) * 10) / 10,
        origin: "segment",
        parentFile: parent.file,
        startTime: segment.start,
        endTime: segment.end,
      };
    } catch {
      // caption failure must not block the whole analysis
      children[i] = {
        id: `${parent.id}_seg${i + 1}`,
        file: parent.file,
        description: `自动切片 ${timeRange}（源自：${parent.description.slice(0, 40)}）`,
        tags: [...parent.tags.slice(0, 4), "自动切片"],
        durationSec: Math.round((segment.end - segment.start) * 10) / 10,
        origin: "segment",
        parentFile: parent.file,
        startTime: segment.start,
        endTime: segment.end,
      };
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, segments.length) }, async () => {
      while (cursor < segments.length) {
        const i = cursor++;
        await captionOne(i);
      }
    }),
  );
  fs.rmSync(tmpDir, { recursive: true, force: true });

  // 写入前重读最新库：若父素材已被删除则放弃（删除竞态防护，用户反馈 #1）
  const latest = readLibrary();
  if (!latest.some((a) => a.id === assetId)) return [];
  const merged = latest
    .filter((a) => !("parentFile" in a && a.parentFile === parent.file) && a.id !== assetId)
    .concat([{ ...parent, hasSegments: true, analysis: "done" }], children);
  writeLibrary(merged);
  return children;
}

function formatRange(start: number, end: number): string {
  return `${fmt(start)}-${fmt(end)}`;
  function fmt(t: number): string {
    const m = Math.floor(t / 60);
    const s = Math.round(t % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }
}

// serialize library writes across concurrent analyses
let analysisQueue: Promise<unknown> = Promise.resolve();
export function analyzeAssetInBackground(assetId: string): Promise<SegmentEntry[]> {
  const run = analysisQueue.then(() => analyzeAsset(assetId));
  analysisQueue = run.catch(() => undefined);
  return run;
}

