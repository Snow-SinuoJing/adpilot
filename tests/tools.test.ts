import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { TEST_DATA_DIR } from "./setup";

// ── pure builders & parsers ────────────────────────────────────────────────
import { cacheKey } from "@/lib/tools/generate-video";
import { parseMiniMaxQueryResponse, parseMiniMaxFileRetrieve, miniMaxSubmitBody } from "@/lib/providers/minimax-video-provider";
import { buildNormalizeArgs, buildConcatArgs } from "@/lib/tools/compose-video";
import { frameTimestamps } from "@/lib/tools/extract-frames";
import { estimateSpeechSec, silentTrackArgs } from "@/lib/providers/fake-tts-provider";
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

  it("splits one long take into equal parts", () => {
    const segments = buildSegments([], 40);
    expect(segments).toHaveLength(3);
    expect(segments[0].end - segments[0].start).toBeCloseTo(40 / 3, 1);
  });

  it("caps absurdly long takes at 4 parts", () => {
    expect(buildSegments([], 300)).toHaveLength(4);
  });

  it("never emits sub-minimum segments", () => {
    for (const segments of [buildSegments([1, 1.2, 1.5], 30), buildSegments([0.6], 8)]) {
      for (const s of segments) expect(s.end - s.start).toBeGreaterThanOrEqual(MIN_SEGMENT_SEC);
    }
    expect(MAX_SEGMENT_SEC).toBe(15);
    expect(MATCH_THRESHOLD).toBeLessThanOrEqual(0.25); // 匹配机制放宽（用户反馈 #2）
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
