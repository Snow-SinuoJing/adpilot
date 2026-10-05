import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Full offline integration (design doc §20.3): brief → strategy → asset
 * decision → fake generation → critic → repair → PASS → TTS → compose.
 * Zero API cost; exercises the real orchestrator, reducer, store and
 * project-local ffmpeg.
 */

import { TEST_DATA_DIR } from "./setup";
const TMP_DATA = TEST_DATA_DIR;
process.env.DEMO_MODE = "live"; // bypass cache so we test the real fake-provider flow

// demo asset library into the isolated data dir
import { LIBRARY } from "../scripts/generate-demo-assets";
fs.mkdirSync(path.join(TMP_DATA, "assets"), { recursive: true });
fs.writeFileSync(
  path.join(TMP_DATA, "assets", "assets.json"),
  JSON.stringify(LIBRARY.map(({ id, file, description, tags, durationSec }) => ({ id, file, description, tags, durationSec }))),
);
// search only reads metadata; attach the real rendered files so composition works
import { ASSETS_DIR } from "@/lib/paths";
fs.cpSync(path.join(process.cwd(), "data", "assets"), ASSETS_DIR, { recursive: true });

const { getStore } = await import("@/lib/state/store");
const { runProject } = await import("@/lib/runtime/orchestrator");
const { DEMO_BRIEF } = await import("@/lib/demo/demo-brief");

describe("e2e offline demo run", () => {
  let projectId: string;

  beforeAll(async () => {
    const store = getStore();
    const state = store.create(DEMO_BRIEF);
    projectId = state.projectId;
    await runProject(projectId);
  });

  it("completes the project with a final video", () => {
    const state = getStore().get(projectId)!;
    expect(state.status).toBe("COMPLETED");
    expect(state.finalVideoUrl).toMatch(/final\.mp4$/);
    const finalFile = path.join(TMP_DATA, "media", projectId, "final.mp4");
    expect(fs.existsSync(finalFile)).toBe(true);
    expect(fs.statSync(finalFile).size).toBeGreaterThan(50_000);
  });

  it("plans exactly 3 scenes summing to the brief duration", () => {
    const state = getStore().get(projectId)!;
    expect(state.scenes).toHaveLength(3);
    expect(state.scenes.reduce((acc, s) => acc + s.durationSec, 0)).toBe(state.brief.durationSec);
  });

  it("shows the retrieval/generation split (doc §15): S1/S3 existing, S2 generated", () => {
    const state = getStore().get(projectId)!;
    const byId = Object.fromEntries(state.scenes.map((s) => [s.id, s]));
    expect(byId.S1.sourceStrategy).toBe("EXISTING_ASSET");
    expect(byId.S3.sourceStrategy).toBe("EXISTING_ASSET");
    expect(byId.S2.sourceStrategy).toBe("GENERATED_VIDEO");
    expect(byId.S1.sourceReason).toMatch(/素材库片段/);
    expect(byId.S2.sourceReason).toMatch(/AI 生成/);
  });

  it("runs the repair arc on S2 only: 64 REPAIR → regenerate → 88 PASS", () => {
    const state = getStore().get(projectId)!;
    const s2 = state.scenes.find((s) => s.id === "S2")!;
    expect(s2.repairHistory).toHaveLength(1);
    expect(s2.repairHistory[0].previousScore).toBe(64);
    expect(s2.repairHistory[0].newScore).toBe(88);
    expect(s2.repairHistory[0].outcome).toBe("IMPROVED");
    // 版本对比数据：保留第一版视频与打回原因（用户反馈 #3）
    expect(s2.repairHistory[0].previousVideoUrl).toMatch(/S2-gen1\.mp4$/);
    expect((s2.repairHistory[0].issues ?? []).length).toBeGreaterThan(0);
    expect(s2.qa?.score).toBe(88);
    expect(s2.qa?.decision).toBe("PASS");
    expect(s2.generationPrompt).toContain("[repair 1]");

    // S1/S3 untouched by repair
    for (const id of ["S1", "S3"] as const) {
      const scene = state.scenes.find((s) => s.id === id)!;
      expect(scene.repairHistory).toHaveLength(0);
      expect(scene.qa).toBeUndefined();
    }

    // both generations exist on disk
    const mediaDir = path.join(TMP_DATA, "media", projectId);
    expect(fs.existsSync(path.join(mediaDir, "S2-gen1.mp4"))).toBe(true);
    expect(fs.existsSync(path.join(mediaDir, "S2-gen2.mp4"))).toBe(true);
  });

  it("stays inside every hard cap", () => {
    const state = getStore().get(projectId)!;
    expect(state.runtime.totalVideoGenerations).toBeLessThanOrEqual(4);
    expect(state.runtime.totalRepairs).toBeLessThanOrEqual(3);
    expect(state.runtime.directorSteps).toBeLessThanOrEqual(20);
    for (const scene of state.scenes) {
      expect(scene.repairHistory.length).toBeLessThanOrEqual(1);
    }
  });

  it("produced voiceovers and audit events", () => {
    const state = getStore().get(projectId)!;
    for (const scene of state.scenes) {
      expect(scene.audioUrl).toMatch(/voice\.mp3$/);
      expect(fs.existsSync(path.join(TMP_DATA, "media", projectId, `${scene.id}-voice.mp3`))).toBe(true);
    }
    const types = state.events.map((e) => e.type);
    for (const expected of ["PROJECT_STARTED", "DECISION_MADE", "CRITIC_COMPLETED", "REPAIR_STARTED", "PROJECT_COMPLETED"]) {
      expect(types).toContain(expected);
    }
    const criticEvents = state.events.filter((e) => e.type === "CRITIC_COMPLETED");
    expect(criticEvents.map((e) => e.title)).toEqual(
      expect.arrayContaining(["S2 得分 64 — 需修复", "S2 得分 88 — 通过"]),
    );
  });

  it("no hidden chain-of-thought in user-visible events (P6)", () => {
    const state = getStore().get(projectId)!;
    for (const event of state.events) {
      expect(event.title).toBeTruthy();
      expect(event.detail ?? "").not.toMatch(/<thought>|thinking|chain[- ]of[- ]thought/i);
    }
  });
});
