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
  const result = await runVision({
    name: "素材切片描述",
    system:
      "你是视频素材管理助手。根据给定的视频关键帧，用一句简体中文描述画面内容（主体/动作/情绪/物体），并给出 3-6 个用于检索的中文标签。" +
      "务必准确识别画面中的食品/商品/品牌（是什么就写什么，如'生巧慕斯条''气泡水瓶'），这对检索至关重要，不要猜成无关物品。",
    user: JSON.stringify({ 素材整体: parentDescription, 片段时间范围: timeRange }),
    images: [{ dataUrl: `data:image/jpeg;base64,${b64}` }],
    schema: CaptionSchema,
    model: process.env.ANALYSIS_VISION_MODEL?.trim() || "glm-4.5v",
  });
  return { description: result.description, tags: result.tags };
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
  const children: SegmentEntry[] = [];
  for (const [i, segment] of segments.entries()) {
    const mid = (segment.start + segment.end) / 2;
    const framePath = path.join(tmpDir, `frame-${i}.jpg`);
    try {
      await runFfmpeg(["-ss", String(mid), "-i", videoPath, "-frames:v", "1", "-q:v", "4", framePath]);
      const timeRange = formatRange(segment.start, segment.end);
      const caption = await captionSegment(framePath, parent.description, timeRange);
      children.push({
        id: `${parent.id}_seg${i + 1}`,
        file: parent.file,
        description: `${caption.description}（${timeRange}）`,
        tags: caption.tags,
        durationSec: Math.round((segment.end - segment.start) * 10) / 10,
        origin: "segment",
        parentFile: parent.file,
        startTime: segment.start,
        endTime: segment.end,
      });
    } catch {
      // caption failure must not block the whole analysis
      children.push({
        id: `${parent.id}_seg${i + 1}`,
        file: parent.file,
        description: `自动切片 ${formatRange(segment.start, segment.end)}（源自：${parent.description.slice(0, 40)}）`,
        tags: [...parent.tags.slice(0, 4), "自动切片"],
        durationSec: Math.round((segment.end - segment.start) * 10) / 10,
        origin: "segment",
        parentFile: parent.file,
        startTime: segment.start,
        endTime: segment.end,
      });
    }
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });

  writeLibrary([...kept, ...children]);
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

