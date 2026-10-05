import { describe, expect, it } from "vitest";
import {
  AdBriefSchema,
  ProjectStateSchema,
  type AdBrief,
  type ProjectState,
} from "@/lib/state/schema";
import { assertSceneTransition, transitionScene, validateInvariants, StateTransitionError } from "@/lib/runtime/reducer";
import { mockStrategy } from "@/lib/agents/strategy";
import { MAX_REPAIR_PER_SCENE, MAX_SCENES, MAX_DIRECTOR_STEPS } from "@/lib/runtime/limits";

const BRIEF: AdBrief = AdBriefSchema.parse({
  productName: "Tile Blitz",
  productDescription: "hyper-casual tile matcher",
  market: "Brazil",
  audience: "casual players",
  platform: "TikTok",
  durationSec: 15,
});

function baseState(): ProjectState {
  const strategy = mockStrategy(BRIEF);
  const state = ProjectStateSchema.parse({
    projectId: "prj_test",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    brief: BRIEF,
    strategy,
    scenes: strategy.scenes.map((scene, index) => ({
      id: scene.id,
      order: index + 1,
      purpose: scene.purpose,
      durationSec: scene.durationSec,
      visualIntent: scene.visualIntent,
      voiceover: scene.voiceover,
      repairHistory: [],
      retryCount: 0,
      status: "PLANNED" as const,
    })),
    status: "PLANNING",
    decisions: [],
    events: [],
    runtime: { totalVideoGenerations: 0, totalRepairs: 0, directorSteps: 0 },
  });
  return state;
}

describe("schema", () => {
  it("accepts a valid brief and rejects bad duration", () => {
    expect(() => AdBriefSchema.parse({ ...BRIEF, durationSec: 12 })).toThrow();
    expect(() => AdBriefSchema.parse({ ...BRIEF, platform: "TV" })).toThrow();
  });

  it("strategy produces exactly 3 scenes summing to the brief duration", () => {
    for (const duration of [15, 20] as const) {
      const strategy = mockStrategy({ ...BRIEF, durationSec: duration });
      expect(strategy.scenes).toHaveLength(3);
      expect(strategy.scenes.map((s) => s.id)).toEqual(["S1", "S2", "S3"]);
      expect(strategy.scenes.map((s) => s.purpose)).toEqual(["HOOK", "PROOF", "CTA"]);
      expect(strategy.scenes.reduce((acc, s) => acc + s.durationSec, 0)).toBe(duration);
    }
  });
});

describe("scene state machine (doc §12)", () => {
  it("walks the happy path PLANNED → READY via existing asset", () => {
    const state = baseState();
    transitionScene(state, "S1", "SEARCHING");
    transitionScene(state, "S1", "READY");
    expect(state.scenes[0].status).toBe("READY");
  });

  it("walks the generation path including repair", () => {
    const state = baseState();
    transitionScene(state, "S2", "SEARCHING");
    transitionScene(state, "S2", "GENERATING");
    transitionScene(state, "S2", "EVALUATING");
    transitionScene(state, "S2", "REPAIRING");
    transitionScene(state, "S2", "GENERATING");
    transitionScene(state, "S2", "EVALUATING");
    transitionScene(state, "S2", "READY");
  });

  it("routes existing-asset scenes through evaluation (SEARCHING/REPAIRING → EVALUATING)", () => {
    const state = baseState();
    transitionScene(state, "S1", "SEARCHING");
    transitionScene(state, "S1", "EVALUATING");
    transitionScene(state, "S1", "REPAIRING");
    transitionScene(state, "S1", "EVALUATING");
    transitionScene(state, "S1", "READY");
  });

  it("rejects illegal transitions", () => {
    const state = baseState();
    expect(() => transitionScene(state, "S1", "READY")).toThrow(StateTransitionError);
    transitionScene(state, "S1", "SEARCHING");
    expect(() => transitionScene(state, "S1", "REPAIRING")).toThrow(StateTransitionError);
    transitionScene(state, "S1", "EVALUATING");
    transitionScene(state, "S1", "READY");
    expect(() => transitionScene(state, "S1", "SEARCHING")).toThrow(StateTransitionError);
  });

  it("assertSceneTransition does not mutate", () => {
    const state = baseState();
    expect(() => assertSceneTransition(state.scenes[0], "READY")).toThrow();
    expect(state.scenes[0].status).toBe("PLANNED");
  });
});

describe("invariants", () => {
  it("rejects duration drift", () => {
    const state = baseState();
    state.scenes[0].durationSec += 1;
    expect(() => validateInvariants(state)).toThrow(/durations/);
  });

  it("rejects READY without footage", () => {
    const state = baseState();
    transitionScene(state, "S1", "SEARCHING");
    transitionScene(state, "S1", "READY");
    expect(() => validateInvariants(state)).toThrow(/READY without footage/);
  });

  it("enforces caps", () => {
    expect(MAX_SCENES).toBe(3);
    expect(MAX_REPAIR_PER_SCENE).toBe(1);
    expect(MAX_DIRECTOR_STEPS).toBeGreaterThanOrEqual(25); // bounded, but fits live repair + re-plan paths
    const state = baseState();
    state.runtime.totalVideoGenerations = 5;
    expect(() => validateInvariants(state)).toThrow(/generation cap/);
  });
});
