import { describe, expect, it } from "vitest";
import { allowedActions, directorView, type Capabilities } from "@/lib/state/selectors";
import { policyDecision } from "@/lib/agents/director";
import { mockStrategy } from "@/lib/agents/strategy";
import { ProjectStateSchema, type AdBrief, type ProjectState } from "@/lib/state/schema";
import { MAX_TOTAL_VIDEO_GENERATIONS, MAX_DIRECTOR_STEPS } from "@/lib/runtime/limits";

const BRIEF: AdBrief = {
  productName: "Tile Blitz",
  productDescription: "hyper-casual tile matcher",
  market: "Brazil",
  audience: "casual players",
  platform: "TikTok",
  durationSec: 15,
};

const FULL_CAPS: Capabilities = { video: true, critic: true, tts: true, compose: true };
const NO_CAPS: Capabilities = { video: false, critic: false, tts: false, compose: false };

function stateWith(mutate: (s: ProjectState) => void): ProjectState {
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
  mutate(state);
  return ProjectStateSchema.parse(state);
}

function completeScenes(state: ProjectState): void {
  for (const scene of state.scenes) {
    if (scene.id === "S2") continue;
    scene.status = "READY";
    scene.videoUrl = `/api/media/prj_test/${scene.id}-existing.mp4`;
    scene.selectedAsset = {
      id: "asset_001",
      path: "/tmp/asset_001.mp4",
      description: "reaction clip",
      tags: ["reaction"],
      durationSec: 5,
      score: 0.6,
    };
    scene.audioUrl = `/api/media/prj_test/${scene.id}-voice.mp3`;
  }
}

describe("bounded action space (P1)", () => {
  it("only CREATE_STRATEGY is legal before strategy exists", () => {
    const state = stateWith((s) => {
      s.strategy = undefined;
      s.scenes = [];
    });
    expect(allowedActions(state, FULL_CAPS)).toEqual(["CREATE_STRATEGY"]);
    expect(policyDecision(directorView(state, FULL_CAPS)).action).toBe("CREATE_STRATEGY");
  });

  it("retrieval comes before planning; planning before generation", () => {
    const state = stateWith(() => {});
    expect(allowedActions(state, FULL_CAPS)).toContain("RETRIEVE_ASSET");
    expect(allowedActions(state, FULL_CAPS)).not.toContain("GENERATE_VIDEO");
  });

  it("generated scene awaiting QA allows EVALUATE_SCENE but not REPAIR_SCENE", () => {
    const state = stateWith((s) => {
      const s2 = s.scenes[1];
      s2.status = "EVALUATING";
      s2.sourceStrategy = "GENERATED_VIDEO";
      s2.generationPrompt = "photorealistic gameplay cascade";
      s2.videoUrl = "/api/media/prj_test/S2-gen1.mp4";
    });
    const actions = allowedActions(state, FULL_CAPS);
    expect(actions).toContain("EVALUATE_SCENE");
    expect(actions).not.toContain("REPAIR_SCENE");
  });

  it("REPAIR_SCENE becomes legal exactly when critic said REPAIR", () => {
    const state = stateWith((s) => {
      completeScenes(s);
      const s2 = s.scenes[1];
      s2.status = "REPAIRING";
      s2.sourceStrategy = "GENERATED_VIDEO";
      s2.videoUrl = "/api/media/prj_test/S2-gen1.mp4";
      s2.qa = {
        score: 64,
        decision: "REPAIR",
        dimensions: { intentAlignment: 72, visualQuality: 81, productVisibility: 48, localization: 70, safetyAndText: 85 },
        issues: [{ type: "product-visibility", severity: "high", description: "lost in motion" }],
        repair: { strategy: "REGENERATE", promptDelta: "make product central" },
      };
    });
    const decision = policyDecision(directorView(state, FULL_CAPS));
    expect(decision.action).toBe("REPAIR_SCENE");
    expect(decision.sceneId).toBe("S2");
    expect(decision.reason).toMatch(/\./);
  });

  it("caps: generation blocked at the total limit; steps bounded", () => {
    expect(MAX_TOTAL_VIDEO_GENERATIONS).toBe(4);
    expect(MAX_DIRECTOR_STEPS).toBe(20);
    const state = stateWith((s) => {
      s.runtime.totalVideoGenerations = MAX_TOTAL_VIDEO_GENERATIONS;
      const s2 = s.scenes[1];
      s2.status = "SEARCHING";
      s2.sourceStrategy = "GENERATED_VIDEO";
      s2.generationPrompt = "photorealistic";
    });
    expect(allowedActions(state, FULL_CAPS)).not.toContain("GENERATE_VIDEO");
  });

  it("graceful degradation: without video capability no GENERATE_VIDEO is offered", () => {
    const state = stateWith((s) => {
      completeScenes(s);
      const s2 = s.scenes[1];
      s2.status = "SEARCHING";
      s2.assetCandidates = [];
    });
    expect(allowedActions(state, NO_CAPS)).not.toContain("GENERATE_VIDEO");
    expect(allowedActions(state, NO_CAPS)).toContain("PLAN_ASSETS");
  });

  it("a scene stranded by an exhausted generation budget becomes re-plannable", () => {
    const state = stateWith((s) => {
      completeScenes(s);
      // complete S2 the same way, then strand S3 mid-generation
      const s2 = s.scenes[1];
      s2.status = "READY";
      s2.videoUrl = "/api/media/prj_test/S2-existing.mp4";
      s2.selectedAsset = s.scenes[0].selectedAsset;
      s2.audioUrl = "/api/media/prj_test/S2-voice.mp3";

      s.runtime.totalVideoGenerations = MAX_TOTAL_VIDEO_GENERATIONS;
      const s3 = s.scenes[2];
      s3.status = "SEARCHING";
      s3.videoUrl = undefined;
      s3.audioUrl = undefined;
      s3.selectedAsset = undefined;
      s3.sourceStrategy = "GENERATED_VIDEO";
      s3.generationPrompt = "photorealistic celebration";
      s3.assetCandidates = [
        { id: "asset_004", path: "/tmp/a.mp4", description: "player celebrates winning", tags: ["celebration"], durationSec: 5, score: 0.53 },
      ];
    });
    const actions = allowedActions(state, FULL_CAPS);
    expect(actions).not.toContain("GENERATE_VIDEO");
    expect(actions).toContain("PLAN_ASSETS");
    const decision = policyDecision(directorView(state, FULL_CAPS));
    expect(decision.action).toBe("PLAN_ASSETS");
    expect(decision.sceneId).toBe("S3");
    expect(decision.reason).toMatch(/re-planning|budget/i);
  });

  it("all-ready + composed → FINISH only", () => {
    const state = stateWith((s) => {
      for (const scene of s.scenes) {
        scene.status = "READY";
        scene.videoUrl = `/api/media/prj_test/${scene.id}-existing.mp4`;
        scene.selectedAsset = {
          id: "asset_001",
          path: "/tmp/asset_001.mp4",
          description: "reaction clip",
          tags: ["reaction"],
          durationSec: 5,
          score: 0.6,
        };
        scene.audioUrl = `/api/media/prj_test/${scene.id}-voice.mp3`;
      }
      s.finalVideoUrl = "/api/media/prj_test/final.mp4";
    });
    expect(allowedActions(state, FULL_CAPS)).toEqual(["FINISH"]);
  });
});
