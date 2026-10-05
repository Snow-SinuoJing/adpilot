import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { FFMPEG_BIN, runFfmpeg, probeDurationSec } from "@/lib/ffmpeg";
import type { AssetEntry } from "@/lib/assets-library";
import { readLibrary, writeLibrary } from "@/lib/assets-library";
import { isMockMode, runStructured, runVision } from "@/lib/agents/llm";
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
  clipPath: string | null,
  parentDescription: string,
  timeRange: string,
): Promise<{ description: string; tags: string[] }> {
  if (isMockMode()) {
    return {
      description: `自动切片 ${timeRange}（源自：${parentDescription.slice(0, 40)}）`,
      tags: ["自动切片", "片段"],
    };
  }
  const opts = {
    name: "素材切片描述",
    system:
      "你是视频素材管理助手。根据给定的视频片段（或关键帧），用一句简体中文描述画面内容（主体/动作/情绪/物体），并给出 3-6 个用于检索的中文标签。" +
      "务必准确识别画面中的食品/商品/品牌（是什么就写什么，如'生巧慕斯条''气泡水瓶'），这对检索至关重要，不要猜成无关物品。" +
      "重点描述动作与运动过程，检索时按动作匹配。一律用简体中文回答。",
    user: JSON.stringify({ 素材整体: parentDescription, 片段时间范围: timeRange }),
    schema: CaptionSchema,
  };
  const primary = process.env.ANALYSIS_VISION_MODEL?.trim() || "glm-4.5v";
  const videoOn = clipPath !== null && process.env.ANALYSIS_VIDEO_INPUT !== "0";
  // 视觉模型降级链：全部落在已购资源包/免费档内
  const MODEL_CHAIN = Array.from(
    new Set([primary, "glm-4.6v-flashx", FALLBACK_VISION_MODEL]),
  );

  const call = async (model: string, payload: object) => {
    const result = await runVision({ ...opts, ...payload, model });
    return { description: result.description, tags: result.tags };
  };

  // 1) 整段视频直读：模型看到动作与运动过程，描述对"按动作检索"最有价值
  if (videoOn) {
    const b64 = fs.readFileSync(clipPath).toString("base64");
    for (const model of MODEL_CHAIN) {
      try {
        return await call(model, { videos: [{ dataUrl: `data:video/mp4;base64,${b64}` }] });
      } catch (error) {
        console.warn(`[analyze] 视频直读失败（${model}），降级:`, error);
      }
    }
    console.warn("[analyze] 视频直读全链失败，退回关键帧模式");
  }
  // 2) 关键帧单图（同一条降级链）
  const b64 = fs.readFileSync(framePath).toString("base64");
  for (const model of MODEL_CHAIN) {
    try {
      return await call(model, { images: [{ dataUrl: `data:image/jpeg;base64,${b64}` }] });
    } catch (error) {
      console.warn(`[analyze] 关键帧描述失败（${model}），降级:`, error);
    }
  }
  throw new Error(`视觉描述全链失败`);
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

  // 先抽全部关键帧 + 各段小视频（本地 ffmpeg，快；360p 控制 token）
  const framePaths: string[] = [];
  const clipPaths: Array<string | null> = [];
  for (const [i, segment] of segments.entries()) {
    const mid = (segment.start + segment.end) / 2;
    const framePath = path.join(tmpDir, `frame-${i}.jpg`);
    await runFfmpeg(["-ss", String(mid), "-i", videoPath, "-frames:v", "1", "-q:v", "4", framePath]);
    framePaths.push(framePath);
    const clipPath = path.join(tmpDir, `clip-${i}.mp4`);
    try {
      await runFfmpeg([
        "-ss", String(segment.start), "-i", videoPath,
        "-t", (segment.end - segment.start).toFixed(2),
        "-vf", "scale=360:-2", "-an",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "30",
        clipPath,
      ]);
      clipPaths.push(clipPath);
    } catch {
      clipPaths.push(null); // 片段抽取失败时退回关键帧模式
    }
  }

  // 视觉描述并发执行（原为串行逐段等待，一条素材动辄几分钟——并发 4 缩短到 1/3 左右）
  const CONCURRENCY = clipPaths.some(Boolean) ? 3 : 4;
  const children: SegmentEntry[] = new Array(segments.length);
  let cursor = 0;
  const captionOne = async (i: number) => {
    const segment = segments[i];
    const timeRange = formatRange(segment.start, segment.end);
    try {
      const caption = await captionSegment(framePaths[i], clipPaths[i], parent.description, timeRange);
      children[i] = {
        id: `${parent.id}_seg${i + 1}`,
        file: parent.file,
        description: withTimeRange(caption.description, `（${timeRange}）`),
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

  // 场记归一化：识别商品本体、全部归成简体中文、统一标签（修"雪茄造型甜品被当成烟草"这类误判）
  await normalizeCaptions(parent, children);

  // 写入前重读最新库：若父素材已被删除则放弃（删除竞态防护，用户反馈 #1）
  const latest = readLibrary();
  if (!latest.some((a) => a.id === assetId)) return [];
  const merged = latest
    .filter((a) => !("parentFile" in a && a.parentFile === parent.file) && a.id !== assetId)
    .concat([{ ...parent, hasSegments: true, analysis: "done" }], children);
  writeLibrary(merged);
  return children;
}

/** 剥离描述尾部所有时间范围括号，统一只保留一份（防模型自带 + 代码追加导致双份）。 */
function withTimeRange(desc: string, range: string): string {
  const stripped = desc.replace(/(?:（[^）]*\d{1,2}:\d{2}[^）]*）\s*)+$/g, "");
  return stripped + range;
}

const NormalizeSchema = z.object({
  productName: z.string().min(1),
  segments: z.array(
    z.object({
      index: z.number().int().min(0),
      description: z.string().min(1),
      tags: z.array(z.string()).min(1).max(8),
    }),
  ),
});

/**
 * 场记归一化：切片描述来自视觉模型的直读，可能夹英文、可能把"雪茄造型的巧克力
 * 甜品"误判成真雪茄。用一次廉价的文本调用统一：识别商品本体 → 全中文 → 标签对齐。
 */
async function normalizeCaptions(parent: AssetEntry, children: SegmentEntry[]): Promise<void> {
  if (isMockMode() || children.length === 0) return;
  try {
    const result = await runStructured({
      name: "场记归一化",
      system:
        "你是广告片场的道具档案员。下面是一支素材视频各切片的原始场记（可能夹英文、可能认错物品）。任务：" +
        "1) 判断画面中反复出现的商品/食品本体是什么——特别注意：外形像雪茄/烟卷但质地是巧克力的，是雪茄造型的巧克力甜品（常见名：生巧慕斯条、巧克力慕斯条），绝不能写成烟草制品；" +
        "2) 把每条场记重写成一句简体中文描述，以识别出的商品为准；" +
        "3) 给每条配 3-6 个简体中文检索标签（含商品名）；" +
        "4) productName 填识别出的商品名（实在没有就写'无'）。description 一律简体中文。",
      user: JSON.stringify({
        素材整体: parent.description,
        原始场记: children.map((c, index) => ({ index, description: c.description, tags: c.tags })),
      }),
      schema: NormalizeSchema,
    });

    for (const seg of result.segments) {
      const target = children[seg.index];
      if (!target) continue;
      const range = target.description.match(/（[^）]*\d{1,2}:\d{2}[^）]*）$/); // 原始时间范围后缀
      target.description = range ? withTimeRange(seg.description, range[0]) : seg.description;
      target.tags = Array.from(new Set([...seg.tags, ...parent.tags.slice(0, 2)])).slice(0, 8);
    }

    // 识别出商品名时回写父素材描述（替换纯文件名描述），检索的父词元继承随之受益
    if (result.productName && result.productName !== "无" && /\.mp4|\.mov|\.webm|^\d+/.test(parent.description)) {
      const parentHint = parent.description.match(/（([^）]*)）$/)?.[1] ?? "用户上传";
      parent.description = `${result.productName}（${parentHint}）`;
    }
  } catch (error) {
    // 归一化失败不影响原始场记入库
    console.warn("[analyze] 场记归一化失败，保留原始描述:", error);
  }
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

