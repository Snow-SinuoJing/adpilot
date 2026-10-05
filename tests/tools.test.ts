import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { TEST_DATA_DIR } from "./setup";

// ── pure builders & parsers ────────────────────────────────────────────────
import { cacheKey } from "@/lib/tools/generate-video";
import { parseMiniMaxQueryResponse, parseMiniMaxFileRetrieve, miniMaxSubmitBody, parseMiniMaxV2QueryResponse, miniMaxV2SubmitBody } from "@/lib/providers/minimax-video-provider";
import { buildNormalizeArgs, buildConcatArgs, planSceneDurations, buildBgmDubArgs } from "@/lib/tools/compose-video";
import { clampWindow } from "@/lib/tools/segment-refine";
import { buildFakeVideoArgs as buildFakeArgsAspect } from "@/lib/providers/fake-video-provider";
import { frameTimestamps } from "@/lib/tools/extract-frames";
import { estimateSpeechSec, silentTrackArgs } from "@/lib/providers/fake-tts-provider";
import { voiceForLocale } from "@/lib/providers/minimax-tts-provider";
import { buildFakeVideoArgs } from "@/lib/providers/fake-video-provider";
import { enforceVerdict } from "@/lib/agents/critic";
import { CriticResultSchema, type CriticResult } from "@/lib/state/schema";

// search-assets reads the library at call time → write metadata into tmp dir
import { searchAssets, MATCH_THRESHOLD } from "@/lib/tools/search-assets";
import { buildSegments, MIN_SEGMENT_SEC, MAX_SEGMENT_SEC } from "@/lib/tools/analyze-asset";
import { buildSegmentCutArgs } from "@/lib/runtime/orchestrator";

beforeAll(() => {
  fs.mkdirSync(path.join(TEST_DATA_DIR, "assets"), { recursive: true });
  fs.writeFileSync(
    path.join(TEST_DATA_DIR, "assets", "assets.json"),
    JSON.stringify([
      { id: "asset_001", file: "a.mp4", description: "young woman face lights up playing mobile game on phone", tags: ["reaction", "face", "mobile", "purpose:hook"], durationSec: 5 },
      { id: "asset_002", file: "b.mp4", description: "player celebrates winning level fist pump", tags: ["celebration", "winning", "purpose:cta"], durationSec: 5 },
      { id: "asset_003", file: "c.mp4", description: "city timelapse night traffic", tags: ["city", "night"], durationSec: 6 },
    ]),
  );
});

describe("asset understanding: long-clip segmentation", () => {
  it("merges tiny shots into the previous segment", () => {
    const segments = buildSegments([3.2, 3.8, 10], 12);
    expect(segments).toEqual([
      { start: 0, end: 3.8 },
      { start: 3.8, end: 10 },
      { start: 10, end: 12 },
    ]);
  });

  it("splits one long take into equal parts (capped at 4)", () => {
    const segments = buildSegments([], 40);
    expect(segments).toHaveLength(4);
    expect(segments[0].end - segments[0].start).toBeCloseTo(10, 1);
  });

  it("caps absurdly long takes at 4 parts", () => {
    expect(buildSegments([], 300)).toHaveLength(4);
  });

  it("never emits sub-minimum segments", () => {
    for (const segments of [buildSegments([1, 1.2, 1.5], 30), buildSegments([0.6], 8)]) {
      for (const s of segments) expect(s.end - s.start).toBeGreaterThanOrEqual(MIN_SEGMENT_SEC);
    }
    expect(MAX_SEGMENT_SEC).toBe(8); // 8s 粒度让"喝饮料"级别的动作更容易整段落入单个切片
    expect(MATCH_THRESHOLD).toBeLessThanOrEqual(0.25); // 匹配机制放宽（用户反馈 #2）
  });
});

describe("audio-driven duration rebalancing (用户反馈 #2)", () => {
  it("extends a scene for a longer voiceover and reclaims time from others", () => {
    // 计划 [4,6,5]，S2 配音 8.2s → S2 需要 8.2+0.5=8.7 但封顶 6+3=9；其余扣回，总和仍 15
    const dur = planSceneDurations([4, 6, 5], [2.0, 8.2, 2.5], 15);
    const sum = dur.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(15, 1);
    expect(dur[1]).toBeGreaterThanOrEqual(8.2); // 配音永远说得完
    expect(dur[1]).toBeLessThanOrEqual(9);
  });

  it("keeps everything when voices fit inside planned durations", () => {
    expect(planSceneDurations([4, 6, 5], [3, 4, 4], 15).reduce((a, b) => a + b, 0)).toBeCloseTo(15, 1);
  });

  it("never shrinks below a scene's voice floor", () => {
    const dur = planSceneDurations([3, 6, 6], [7.5, 7.5, 7.5], 15);
    // 总需求 24 远超 15：全触底时宁超勿切语音
    for (const d of dur) expect(d).toBeGreaterThanOrEqual(7.5);
  });
});

describe("bgm duck-mix args (用户反馈 #3)", () => {
  it("mixes bgm under voice with sidechain ducking and fades", () => {
    const args = buildBgmDubArgs({ videoNoBgm: "v.mp4", bgmPath: "b.mp3", outPath: "o.mp4", totalSec: 15 });
    const joined = args.join(" ");
    expect(joined).toContain("sidechaincompress");
    expect(joined).toContain("afade=t=in");
    expect(joined).toContain("amix=inputs=2");
    expect(joined).toContain("volume=0.35");
  });
});

describe("segment attach: frame-accurate cut args", () => {
  it("cuts by start/end with re-encode for accuracy", () => {
    const args = buildSegmentCutArgs({ source: "a.mp4", startTime: 12.5, endTime: 18, dest: "out.mp4" });
    const joined = args.join(" ");
    expect(args[args.indexOf("-ss") + 1]).toBe("12.5");
    expect(args[args.indexOf("-to") + 1]).toBe("18");
    expect(joined).toContain("-c:v libx264");
    expect(joined).toContain("+faststart");
  });
});

describe("search_assets ranking (doc §15 demo design)", () => {
  it("matches HOOK intent to the reaction clip", () => {
    const results = searchAssets({ query: "close-up face lights up playing phone colorful game", purpose: "HOOK" });
    expect(results[0]?.id).toBe("asset_001");
    expect(results[0]?.score).toBeGreaterThan(0.35);
  });

  it("matches CTA intent to the celebration clip", () => {
    const results = searchAssets({ query: "player celebrates winning level taps download", purpose: "CTA" });
    expect(results[0]?.id).toBe("asset_002");
  });

  it("finds no match for the transformation scene → triggers generation", () => {
    const results = searchAssets({ query: "seamless level progression cascade of tiles clearing combos chaining", purpose: "PROOF" });
    expect(results[0]?.score ?? 0).toBeLessThan(0.35);
  });

  it("boosts assets uploaded with this brief (priorityIds)", () => {
    const base = searchAssets({ query: "player celebrates winning level taps download", purpose: "CTA", topK: 1 });
    const boosted = searchAssets({
      query: "player celebrates winning level taps download",
      purpose: "CTA",
      topK: 1,
      priorityIds: [base[0].id],
    });
    expect(boosted[0].id).toBe(base[0].id);
    expect(boosted[0].score).toBeGreaterThan(base[0].score);
  });

  it("caps results at topK", () => {
    const results = searchAssets({ query: "face phone game reaction", purpose: "HOOK", topK: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });
});

describe("video cache key (doc §17 Mode B)", () => {
  it("is deterministic and prompt-sensitive", () => {
    const base = { provider: "minimax", model: "hailuo", durationSec: 5, aspectRatio: "9:16" };
    const a = cacheKey({ ...base, prompt: "photorealistic cascade" });
    const b = cacheKey({ ...base, prompt: "photorealistic cascade" });
    const c = cacheKey({ ...base, prompt: "photorealistic cascade, slower" });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toHaveLength(32);
  });
});

describe("MiniMax provider adapters", () => {
  it("maps query statuses correctly (2026 file_id flow)", () => {
    expect(parseMiniMaxQueryResponse({ status: "Queueing" }).status).toBe("PENDING");
    expect(parseMiniMaxQueryResponse({ status: "Processing" }).status).toBe("RUNNING");
    const success = parseMiniMaxQueryResponse({ status: "Success", file_id: 12345, video_width: 1080, video_height: 1920 });
    expect(success.status).toBe("COMPLETED");
    expect(success.fileId).toBe("12345");
    expect(success.width).toBe(1080);
    expect(parseMiniMaxQueryResponse({ status: "Fail" }).status).toBe("FAILED");
    expect(parseMiniMaxQueryResponse({ base_resp: { status_code: 1004, status_msg: "rate limited" } }).status).toBe("FAILED");
  });

  it("resolves download urls via files/retrieve", () => {
    expect(parseMiniMaxFileRetrieve({ file: { download_url: "https://cdn/v.mp4" } })).toBe("https://cdn/v.mp4");
    expect(() => parseMiniMaxFileRetrieve({ base_resp: { status_code: 1004, status_msg: "expired" } })).toThrow(/expired/);
    expect(() => parseMiniMaxFileRetrieve({ file: {} })).toThrow(/no download_url/);
  });

  it("maps v2 (H3) query responses correctly", () => {
    expect(parseMiniMaxV2QueryResponse({ items: [{ status: "succeeded", content: { url: "https://cdn/v.mp4" } }] })).toEqual({
      status: "COMPLETED",
      videoUrl: "https://cdn/v.mp4",
    });
    expect(parseMiniMaxV2QueryResponse({ items: [{ status: "running" }] }).status).toBe("RUNNING");
    expect(parseMiniMaxV2QueryResponse({ items: [{ status: "queued" }] }).status).toBe("PENDING");
    expect(parseMiniMaxV2QueryResponse({ items: [{ status: "failed", error: { message: "boom" } }] }).error).toBe("boom");
    expect(parseMiniMaxV2QueryResponse({ items: [] }).status).toBe("FAILED");
  });

  it("v2 submit body uses content messages and clamps duration to 5-10s", () => {
    const body = miniMaxV2SubmitBody(
      { prompt: "p", durationSec: 4, aspectRatio: "16:9" },
      "MiniMax-H3-Max",
      "data:image/jpeg;base64,xx",
    );
    expect(body.duration).toBe(5);
    expect(body.resolution).toBe("768p");
    expect(body.first_frame_image).toBe("data:image/jpeg;base64,xx");
    const content = body.content as Array<{ type: string }>;
    expect(content).toHaveLength(1); // 无参考图时 content 只有文本
    expect(content[0].type).toBe("text");
  });

  it("v2 submit body carries the product reference image in content", () => {
    const body = miniMaxV2SubmitBody(
      { prompt: "p", durationSec: 6, aspectRatio: "9:16" },
      "MiniMax-H3-Max",
      "data:image/jpeg;base64,frame",
      "data:image/jpeg;base64,ref",
    );
    const content = body.content as Array<{ type: string; image_url?: { url: string } }>;
    expect(content[1].type).toBe("image_url");
    expect(content[1].image_url?.url).toBe("data:image/jpeg;base64,ref");
    expect(body.first_frame_image).toBe("data:image/jpeg;base64,frame");
  });

  it("submit body carries model + prompt optimizer", () => {
    const body = miniMaxSubmitBody({ prompt: "p", durationSec: 5, aspectRatio: "9:16" }, "MiniMax-Hailuo-02");
    expect(body).toEqual({ model: "MiniMax-Hailuo-02", prompt: "p", prompt_optimizer: true });
  });
});

describe("ffmpeg command builders", () => {
  it("normalize targets 1080x1920@30 with audio padding", () => {
    const args = buildNormalizeArgs({ videoPath: "in.mp4", audioPath: "vo.mp3", durationSec: 5, outPath: "out.mp4" });
    expect(args.join(" ")).toContain("1080:1920");
    expect(args.join(" ")).toContain("fps=30");
    expect(args.join(" ")).toContain("atrim=duration=5");
    expect(args.join(" ")).toContain("-c:v libx264");
    expect(args.join(" ")).toContain("-c:a aac");
  });

  it("prefers slow-motion over frozen frames when footage is short", () => {
    // 目标 5.5s、素材 4s：慢放 1.375x 恰好补齐，无需额外段
    const exact = buildNormalizeArgs({ videoPath: "in.mp4", durationSec: 5.5, outPath: "o.mp4", srcDur: 4 });
    expect(exact.join(" ")).toContain("setpts=1.3750*PTS");
    expect(exact.join(" ")).not.toContain("tpad");
    // 差距过大（4s→6s）：慢放 1.45x 后用倒放回接补足——画面持续运动，不再冻结末帧
    const capped = buildNormalizeArgs({ videoPath: "in.mp4", durationSec: 6, outPath: "o.mp4", srcDur: 4 });
    expect(capped.join(" ")).toContain("setpts=1.4500*PTS");
    expect(capped.join(" ")).toContain("reverse");
    expect(capped.join(" ")).toContain("concat=n=2");
    expect(capped.join(" ")).not.toContain("tpad");
    // 差距更大（3s→10s）：慢放 1.45x 后 4.35s/段，需要三段（正-倒-正）
    const triple = buildNormalizeArgs({ videoPath: "in.mp4", durationSec: 10, outPath: "o.mp4", srcDur: 3 });
    expect(triple.join(" ")).toContain("concat=n=3");
    expect(triple.join(" ")).not.toContain("tpad");
    // 素材够长：直接修剪，不慢放不回接（setpts 仅重置时间戳，无慢放系数）
    const trim = buildNormalizeArgs({ videoPath: "in.mp4", durationSec: 5, outPath: "o.mp4", srcDur: 9 });
    expect(trim.join(" ")).toContain("trim=duration=5.00");
    expect(trim.join(" ")).not.toContain("*PTS");
    expect(trim.join(" ")).not.toContain("tpad");
  });

  it("normalize targets 16:9 when the brief asks for landscape (用户反馈 #2)", () => {
    const args = buildNormalizeArgs({ videoPath: "in.mp4", durationSec: 5, outPath: "out.mp4", aspectRatio: "16:9" });
    expect(args.join(" ")).toContain("1920:1080");
    const portrait = buildNormalizeArgs({ videoPath: "in.mp4", durationSec: 5, outPath: "out.mp4" });
    expect(portrait.join(" ")).toContain("1080:1920");
  });

  it("fake provider renders landscape when requested", () => {
    const landscape = buildFakeArgsAspect({ dest: "f.mp4", durationSec: 5, labelLines: ["x"], seedText: "s", aspectRatio: "16:9" });
    expect(landscape.join(" ")).toContain("1920x1080");
  });

  it("refined windows are clamped inside the segment (用户反馈 #3)", () => {
    const segment = { start: 10, end: 20 };
    expect(clampWindow({ start: 5, end: 30 }, segment)).toEqual({ start: 10, end: 20 });
    expect(clampWindow({ start: 12, end: 13 }, segment)).toEqual({ start: 12, end: 14 });
    expect(clampWindow({ start: 18, end: 25 }, segment)).toEqual({ start: 18, end: 20 });
  });

  it("normalize without voiceover synthesizes silence", () => {
    const args = buildNormalizeArgs({ videoPath: "in.mp4", durationSec: 4, outPath: "out.mp4" });
    expect(args.join(" ")).toContain("anullsrc");
  });

  it("concat list preserves scene order", () => {
    const { args, listFile } = buildConcatArgs(["seg-S1.mp4", "seg-S2.mp4", "seg-S3.mp4"], "final.mp4");
    const list = fs.readFileSync(listFile, "utf8");
    expect(list.indexOf("seg-S1")).toBeLessThan(list.indexOf("seg-S2"));
    expect(list.indexOf("seg-S2")).toBeLessThan(list.indexOf("seg-S3"));
    expect(args.join(" ")).toContain("+faststart");
  });

  it("frame timestamps land on 10–90%", () => {
    expect(frameTimestamps(10)).toEqual([1, 3, 5, 7, 9]);
  });

  it("fake video args are valid-shaped for drawtext", () => {
    const args = buildFakeVideoArgs({ dest: "f.mp4", durationSec: 5, labelLines: ["AI GENERATED (fake provider)", "photorealistic cascade"], seedText: "s" });
    expect(args.join(" ")).toContain("gradients=size=1080x1920");
    expect(args.join(" ")).not.toContain("' unclosed");
  });
});

describe("tts voice per language (用户反馈 #4)", () => {
  it("maps locales to voices with env override priority", () => {
    expect(voiceForLocale("zh")).toBe("male-qn-qingse");
    expect(voiceForLocale("en")).toBe("Friendly_Person");
    expect(voiceForLocale("pt")).toBe("Friendly_Person");
    process.env.MINIMAX_TTS_VOICE_yue = "Cantonese_Voice";
    expect(voiceForLocale("yue")).toBe("Cantonese_Voice");
    delete process.env.MINIMAX_TTS_VOICE_yue;
  });
});

describe("fake TTS duration model", () => {
  it("estimates speech length for the silent fallback", () => {
    expect(estimateSpeechSec("one two three four")).toBeGreaterThan(1);
    expect(silentTrackArgs(3.5, "out.mp3").join(" ")).toContain("anullsrc");
  });
});

describe("critic verdict rule (doc §7.4, code-enforced)", () => {
  const dims = { intentAlignment: 80, visualQuality: 80, productVisibility: 80, localization: 80, safetyAndText: 80 };

  it("score ≥ 75 without high issues passes", () => {
    const result = enforceVerdict(CriticResultSchema.parse({ score: 82, decision: "REPAIR", dimensions: dims, issues: [] }));
    expect(result.decision).toBe("PASS");
  });

  it("high-severity issue forces REPAIR even above threshold", () => {
    const result = enforceVerdict(CriticResultSchema.parse({
      score: 80,
      decision: "PASS",
      dimensions: dims,
      issues: [{ type: "text", severity: "high", description: "garbled caption" }],
    }));
    expect(result.decision).toBe("REPAIR");
    expect(result.repair?.promptDelta).toBeTruthy();
  });

  it("synthesizes a promptDelta when the model forgot one", (): CriticResult => {
    const result = enforceVerdict(CriticResultSchema.parse({
      score: 60,
      decision: "REPAIR",
      dimensions: dims,
      issues: [{ type: "product-visibility", severity: "high", description: "product lost" }],
    }));
    expect(result.repair?.promptDelta).toMatch(/^Fix:/);
    return result;
  });
});
