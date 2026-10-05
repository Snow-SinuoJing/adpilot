import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { runFfmpeg } from "@/lib/ffmpeg";
import { isMockMode, runVision } from "@/lib/agents/llm";

/**
 * 切片精确定位（用户反馈 #3）：自动切片最长达 8-15 秒，而场景动作往往只占
 * 其中一个子窗口。挂载前抽 6 帧让视觉模型选出真正匹配意图的连续时间窗，
 * 再按子窗口裁剪。失败/离线时回退整段切片。
 */

const RefinedWindowSchema = z.object({
  startSec: z.number().min(0),
  endSec: z.number().min(0),
});

export const REFINE_FRAMES = 6;
export const MIN_REFINED_SEC = 2;

/** Pure: clamp a model-proposed window inside the segment. */
export function clampWindow(
  proposed: { start: number; end: number },
  segment: { start: number; end: number },
  minSec = MIN_REFINED_SEC,
): { start: number; end: number } {
  const start = Math.min(Math.max(proposed.start, segment.start), segment.end - minSec);
  const end = Math.min(Math.max(proposed.end, start + minSec), segment.end);
  return {
    start: Math.round(Math.max(start, segment.start) * 100) / 100,
    end: Math.round(end * 100) / 100,
  };
}

export async function refineSegmentWindow(input: {
  videoPath: string;
  startTime: number;
  endTime: number;
  intent: string;
  product: string;
}): Promise<{ start: number; end: number } | null> {
  if (isMockMode()) return null;

  const span = input.endTime - input.startTime;
  if (span <= MIN_REFINED_SEC + 0.5) return null; // nothing to refine

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "adpilot-refine-"));
  const images: Array<{ dataUrl: string; at: number }> = [];
  try {
    for (let i = 0; i < REFINE_FRAMES; i++) {
      const at = Math.round((input.startTime + (span / (REFINE_FRAMES - 1)) * i) * 100) / 100;
      const framePath = path.join(tmpDir, `f-${i}.jpg`);
      await runFfmpeg(["-ss", String(at), "-i", input.videoPath, "-frames:v", "1", "-q:v", "4", framePath]);
      images.push({
        at,
        dataUrl: `data:image/jpeg;base64,${fs.readFileSync(framePath).toString("base64")}`,
      });
    }

    const result = await runVision({
      name: "切片精确定位",
      system:
        "你是视频剪辑助手。给定一个素材切片中按时间顺序抽取的 6 帧及各自时间戳，" +
        "选出与目标场景意图【真正匹配】的连续时间窗（从某一帧的时间到之后某帧的时间）。" +
        "注意画面主体的动作必须对得上意图描述，不要选动作发生前后的过渡画面。",
      user: JSON.stringify({
        产品: input.product,
        目标场景意图: input.intent,
        帧时间戳: images.map((f) => f.at),
      }),
      images,
      schema: RefinedWindowSchema,
    });

    return clampWindow({ start: result.startSec, end: result.endSec }, { start: input.startTime, end: input.endTime });
  } catch {
    return null; // 精确定位失败不影响主流程，回退整段切片
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
