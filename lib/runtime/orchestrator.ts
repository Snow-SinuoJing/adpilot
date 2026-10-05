import fs from "node:fs";
import type { DirectorAction, ErrorCategory, ProjectState } from "@/lib/state/schema";
import { getStore } from "@/lib/state/store";
import { directorView, type Capabilities } from "@/lib/state/selectors";
import { makeEvent } from "./events";
import { transitionScene, validateInvariants } from "./reducer";
import { canGenerateVideo, canRepairScene, canTakeDirectorStep } from "./limits";
import { decideNextAction, policyDecision } from "@/lib/agents/director";
import { createStrategy } from "@/lib/agents/strategy";
import { planAsset } from "@/lib/agents/asset-planner";
import { searchAssets } from "@/lib/tools/search-assets";
import { generateSceneVideo } from "@/lib/tools/generate-video";
import { evaluateScene } from "@/lib/tools/evaluate-scene";
import { generateSceneVoice } from "@/lib/tools/generate-voice";
import { composeFinalVideo } from "@/lib/tools/compose-video";
import { getVideoProvider } from "@/lib/providers/video-provider";
import { getTtsProvider } from "@/lib/providers/tts-provider";
import { mediaFile, urlForMedia } from "@/lib/media";
import { llmConfig } from "@/lib/agents/llm";

/**
 * Orchestrator main loop (design doc §10).
 * The Director decides what to do; this loop decides how to do it reliably:
 * every step validates state, persists it, and emits auditable events.
 */

const runningProjects = new Set<string>();

export interface OrchestratorDeps {
  capabilities: Capabilities;
}

export function defaultDeps(): OrchestratorDeps {
  return {
    capabilities: {
      video: getVideoProvider() !== null,
      critic: true, // mock critic works offline; live critic needs an LLM key
      tts: getTtsProvider() !== null,
      compose: true, // project-local ffmpeg
    },
  };
}

function emit(projectId: string, event: Parameters<typeof makeEvent>[0]) {
  getStore().appendEvent(projectId, makeEvent(event));
}

function sceneOf(state: ProjectState, sceneId?: string) {
  const scene = state.scenes.find((s) => s.id === sceneId);
  if (!scene) throw new Error(`scene not found: ${sceneId}`);
  return scene;
}

function isTerminal(state: ProjectState): boolean {
  return state.status === "COMPLETED" || state.status === "FAILED";
}

const STATUS_BY_ACTION: Partial<Record<DirectorAction, ProjectState["status"]>> = {
  CREATE_STRATEGY: "PLANNING",
  RETRIEVE_ASSET: "PLANNING",
  PLAN_ASSETS: "PLANNING",
  GENERATE_VIDEO: "EXECUTING",
  EVALUATE_SCENE: "EVALUATING",
  REPAIR_SCENE: "REPAIRING",
  GENERATE_VOICE: "EXECUTING",
  COMPOSE_VIDEO: "COMPOSING",
};

function demoMode(): "live" | "cache" | "replay" {
  const mode = process.env.DEMO_MODE?.trim().toLowerCase();
  return mode === "live" || mode === "replay" ? mode : "cache";
}

export async function runProject(projectId: string, deps: OrchestratorDeps = defaultDeps()): Promise<void> {
  const store = getStore();
  const initial = store.get(projectId);
  if (!initial) throw new Error(`project not found: ${projectId}`);
  if (isTerminal(initial)) throw new Error(`project already ${initial.status.toLowerCase()}`);
  if (runningProjects.has(projectId)) throw new Error("project run already in progress");
  runningProjects.add(projectId);

  try {
    store.update(projectId, (s) => {
      s.runtime.startedAt = new Date().toISOString();
      s.runtime.demoMode = demoMode();
    });
    emit(projectId, {
      type: "PROJECT_STARTED",
      actor: "SYSTEM",
      title: `Agent run started (${demoMode()} mode)`,
      detail: `LLM: ${llmConfig().mode}${deps.capabilities.video ? ` · video: ${getVideoProvider()?.name}` : ""}`,
    });

    while (true) {
      const state = store.get(projectId)!;
      if (isTerminal(state)) break;

      if (!canTakeDirectorStep(state)) {
        failProject(projectId, "STATE", "Director step limit reached (MAX_DIRECTOR_STEPS)");
        break;
      }

      const view = directorView(state, deps.capabilities);
      // The Director LLM is a decision *advisor*; the deterministic policy
      // is the floor. A transient model failure must never kill a run.
      let decision;
      try {
        decision = await decideNextAction(view);
      } catch (error) {
        console.warn("[director] LLM decision failed — continuing with policy:", error);
        decision = policyDecision(view);
      }

      store.update(projectId, (s) => {
        s.decisions.push({
          at: new Date().toISOString(),
          action: decision.action,
          sceneId: decision.sceneId,
          reason: decision.reason,
        });
        s.runtime.directorSteps += 1;
        s.currentAction = decision.action;
        if (STATUS_BY_ACTION[decision.action]) s.status = STATUS_BY_ACTION[decision.action]!;
      });
      emit(projectId, {
        type: "DECISION_MADE",
        actor: "DIRECTOR",
        sceneId: decision.sceneId,
        title: `${decision.action}${decision.sceneId ? ` ${decision.sceneId}` : ""}`,
        detail: decision.reason,
        data: { action: decision.action, sceneId: decision.sceneId, reason: decision.reason },
      });

      try {
        await executeAction(projectId, decision.action, decision.sceneId, deps);
        validateInvariants(store.get(projectId)!);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        emit(projectId, {
          type: "ERROR",
          actor: "SYSTEM",
          sceneId: decision.sceneId,
          title: `${decision.action} failed`,
          detail: message,
        });
        failProject(projectId, categorize(error), message);
        break;
      }
    }
  } finally {
    runningProjects.delete(projectId);
  }
}

function categorize(error: unknown): ErrorCategory {
  const name = (error as { name?: string })?.name ?? "";
  if (name === "VideoJobTimeoutError") return "TIMEOUT";
  if (name === "StateTransitionError") return "STATE";
  const text = String((error as Error)?.message ?? error);
  if (/ffmpeg|ffprobe|compose/i.test(text)) return "MEDIA_PROCESSING";
  if (/minimax|provider|submit|video job|download/i.test(text)) return "VIDEO_PROVIDER";
  if (/model|llm|json|schema/i.test(text)) return "MODEL";
  return "UNKNOWN";
}

function failProject(projectId: string, category: ErrorCategory, message: string) {
  getStore().update(projectId, (s) => {
    s.status = "FAILED";
    s.error = { category, message };
  });
  emit(projectId, { type: "ERROR", actor: "SYSTEM", title: "Project failed", detail: message });
}

// ─── action handlers ─────────────────────────────────────────────────────────

async function executeAction(
  projectId: string,
  action: DirectorAction,
  sceneId: string | undefined,
  deps: OrchestratorDeps,
): Promise<void> {
  switch (action) {
    case "CREATE_STRATEGY": return runCreateStrategy(projectId);
    case "RETRIEVE_ASSET": return runRetrieveAsset(projectId, sceneId!);
    case "PLAN_ASSETS": return runPlanAssets(projectId, sceneId!, deps);
    case "GENERATE_VIDEO": return runGenerateVideo(projectId, sceneId!);
    case "EVALUATE_SCENE": return runEvaluateScene(projectId, sceneId!);
    case "REPAIR_SCENE": return runRepairScene(projectId, sceneId!);
    case "GENERATE_VOICE": return runGenerateVoices(projectId);
    case "COMPOSE_VIDEO": return runComposeVideo(projectId);
    case "FINISH": return runFinish(projectId);
  }
}

async function runCreateStrategy(projectId: string): Promise<void> {
  const store = getStore();
  emit(projectId, { type: "AGENT_STARTED", actor: "STRATEGY", title: "Creating 3-scene narrative" });

  const state = store.get(projectId)!;
  const strategy = await createStrategy(state.brief);

  store.update(projectId, (s) => {
    s.strategy = strategy;
    s.scenes = strategy.scenes.map((scene, index) => ({
      id: scene.id,
      order: index + 1,
      purpose: scene.purpose,
      durationSec: scene.durationSec,
      visualIntent: scene.visualIntent,
      voiceover: scene.voiceover,
      repairHistory: [],
      retryCount: 0,
      status: "PLANNED" as const,
    }));
  });

  emit(projectId, {
    type: "AGENT_COMPLETED",
    actor: "STRATEGY",
    title: `Strategy ready: ${strategy.scenes.map((s) => `${s.id} ${s.purpose} ${s.durationSec}s`).join(" · ")}`,
    detail: strategy.concept,
  });
}

async function runRetrieveAsset(projectId: string, sceneId: string): Promise<void> {
  const store = getStore();
  store.update(projectId, (s) => transitionScene(s, sceneId, "SEARCHING"));
  emitScene(projectId, sceneId, "Searching asset library");
  emit(projectId, { type: "TOOL_STARTED", actor: "TOOL", sceneId, title: "search_assets" });

  const state = store.get(projectId)!;
  const scene = sceneOf(state, sceneId);
  const candidates = searchAssets({ query: scene.visualIntent, purpose: scene.purpose, topK: 3 });

  store.update(projectId, (s) => {
    sceneOf(s, sceneId).assetCandidates = candidates;
  });
  emit(projectId, {
    type: "TOOL_COMPLETED",
    actor: "TOOL",
    sceneId,
    title: `search_assets → ${candidates.length} candidate${candidates.length === 1 ? "" : "s"}`,
    detail:
      candidates.map((c) => `${c.id} (${c.score.toFixed(2)}) ${c.description}`).join(" | ") ||
      "no candidates",
  });
}

async function runPlanAssets(projectId: string, sceneId: string, deps: OrchestratorDeps): Promise<void> {
  const store = getStore();
  emit(projectId, { type: "AGENT_STARTED", actor: "ASSET", sceneId, title: "Deciding footage source" });

  const state = store.get(projectId)!;
  const scene = sceneOf(state, sceneId);
  const canGenerate = deps.capabilities.video && canGenerateVideo(state);
  const decision = await planAsset(scene, scene.assetCandidates ?? [], canGenerate, state.brief);

  store.update(projectId, (s) => {
    const target = sceneOf(s, sceneId);
    target.sourceStrategy = decision.strategy;
    target.sourceReason = decision.reason;
    if (decision.selectedAssetId) {
      target.selectedAsset = target.assetCandidates?.find((c) => c.id === decision.selectedAssetId);
    }
    if (decision.generationPrompt) {
      target.generationPrompt = decision.generationPrompt;
    }
  });

  emit(projectId, {
    type: "AGENT_COMPLETED",
    actor: "ASSET",
    sceneId,
    title: `${sceneId} → ${decision.strategy}`,
    detail: decision.reason,
    data: { strategy: decision.strategy, confidence: decision.confidence },
  });

  if (decision.selectedAssetId && (decision.strategy === "EXISTING_ASSET" || decision.strategy === "FALLBACK")) {
    await attachExistingAsset(projectId, sceneId);
  } else if (decision.strategy === "FALLBACK") {
    store.update(projectId, (s) => {
      sceneOf(s, sceneId).qualityWarning = true;
      transitionScene(s, sceneId, "READY");
    });
    emitScene(projectId, sceneId, "Fallback without footage — flagged quality_warning");
  }
}

/** Copy the chosen library clip into the project media dir and mark READY. */
async function attachExistingAsset(projectId: string, sceneId: string): Promise<void> {
  const store = getStore();
  store.update(projectId, (s) => {
    const scene = sceneOf(s, sceneId);
    if (!scene.selectedAsset) throw new Error(`no selected asset for ${sceneId}`);
    const dest = mediaFile(projectId, `${sceneId}-existing.mp4`);
    fs.copyFileSync(scene.selectedAsset.path, dest);
    scene.videoUrl = urlForMedia(dest);
    transitionScene(s, sceneId, "READY");
  });
  emitScene(projectId, sceneId, "Attached library clip — READY");
}

async function runGenerateVideo(projectId: string, sceneId: string): Promise<void> {
  const store = getStore();
  const state = store.get(projectId)!;
  if (!canGenerateVideo(state)) throw new Error("total video generation cap reached");

  const scene = sceneOf(state, sceneId);
  if (!scene.generationPrompt) throw new Error(`no generation prompt for ${sceneId}`);

  const genIndex = scene.repairHistory.length + 1;

  store.update(projectId, (s) => {
    transitionScene(s, sceneId, "GENERATING");
    s.runtime.totalVideoGenerations += 1;
  });
  emitScene(projectId, sceneId, `Generating video (attempt ${genIndex})`);
  emit(projectId, { type: "TOOL_STARTED", actor: "TOOL", sceneId, title: "generate_video" });

  const result = await generateSceneVideo({
    projectId,
    sceneId,
    prompt: scene.generationPrompt,
    durationSec: scene.durationSec,
    generationIndex: genIndex,
    onProgress: (message, extra) =>
      emit(projectId, { type: "TOOL_PROGRESS", actor: "TOOL", sceneId, title: message, data: extra }),
  });

  store.update(projectId, (s) => {
    const target = sceneOf(s, sceneId);
    target.videoUrl = result.videoUrl;
    target.videoJobId = result.jobId;
    transitionScene(s, sceneId, "EVALUATING");
  });
  emit(projectId, {
    type: "TOOL_COMPLETED",
    actor: "TOOL",
    sceneId,
    title: `video ready${result.fromCache ? " (from cache)" : ""}`,
    detail: `${result.provider}/${result.model}${result.jobId ? ` · job ${result.jobId}` : ""}`,
  });
  emitScene(projectId, sceneId, "Video generated — awaiting QA");
}

async function runEvaluateScene(projectId: string, sceneId: string): Promise<void> {
  const store = getStore();
  emit(projectId, { type: "AGENT_STARTED", actor: "CRITIC", sceneId, title: "Multimodal QA" });

  const state = store.get(projectId)!;
  let result: Awaited<ReturnType<typeof evaluateScene>>["result"];
  let frameUrls: string[] = [];
  try {
    ({ result, frameUrls } = await evaluateScene(state, sceneId));
  } catch (error) {
    // design doc §18.2: critic failure after retry → conservative PASS_WITH_WARNING
    console.warn(`[critic] evaluation failed for ${sceneId} — conservative pass:`, error);
    result = {
      score: 76,
      decision: "PASS",
      dimensions: {
        intentAlignment: 76,
        visualQuality: 76,
        productVisibility: 76,
        localization: 76,
        safetyAndText: 76,
      },
      issues: [
        {
          type: "critic-unavailable",
          severity: "low",
          description: `Critic could not evaluate (${error instanceof Error ? error.message.slice(0, 80) : "unknown"}); scene passed conservatively.`,
        },
      ],
    };
    store.update(projectId, (s) => {
      sceneOf(s, sceneId).qualityWarning = true;
    });
  }

  store.update(projectId, (s) => {
    const target = sceneOf(s, sceneId);
    target.qa = result;

    // close out any pending repair record with the observed score
    const pending = target.repairHistory.find((r) => r.outcome === "PENDING");
    if (pending) {
      pending.newScore = result.score;
      pending.outcome = result.score > pending.previousScore ? "IMPROVED" : "NO_IMPROVEMENT";
      if (pending.outcome === "NO_IMPROVEMENT") target.qualityWarning = true;
    }

    if (result.decision === "PASS") {
      transitionScene(s, sceneId, "READY");
    } else {
      transitionScene(s, sceneId, "REPAIRING");
    }
  });

  emit(projectId, {
    type: "CRITIC_COMPLETED",
    actor: "CRITIC",
    sceneId,
    title: `${sceneId} scored ${result.score} — ${result.decision}`,
    detail: result.issues.map((i) => `${i.severity}: ${i.description}`).join(" | ") || "no issues",
    data: { score: result.score, decision: result.decision, dimensions: result.dimensions, frameUrls },
  });
  emitScene(projectId, sceneId, result.decision === "PASS" ? "QA PASS — READY" : "QA REPAIR");
}

async function runRepairScene(projectId: string, sceneId: string): Promise<void> {
  const store = getStore();
  const state = store.get(projectId)!;
  const scene = sceneOf(state, sceneId);
  const qa = scene.qa;

  if (qa?.decision === "REPAIR" && canRepairScene(scene) && canGenerateVideo(state)) {
    const promptDelta =
      qa.repair?.promptDelta ?? "Make the product experience clearly visible and central.";

    store.update(projectId, (s) => {
      const target = sceneOf(s, sceneId);
      target.repairHistory.push({
        attempt: target.repairHistory.length + 1,
        at: new Date().toISOString(),
        promptDelta,
        previousScore: qa.score,
        outcome: "PENDING",
      });
      target.generationPrompt = `${target.generationPrompt ?? ""}\n[repair ${target.repairHistory.length}] ${promptDelta}`.trim();
      // invalidate the failed footage so the loop regenerates this scene
      target.videoUrl = undefined;
      target.videoJobId = undefined;
      target.qa = undefined;
      s.runtime.totalRepairs += 1;
      // status stays REPAIRING; the loop dispatches GENERATE_VIDEO next
    });

    emit(projectId, {
      type: "REPAIR_STARTED",
      actor: "DIRECTOR",
      sceneId,
      title: `Repairing ${sceneId} — patching prompt, regenerating this scene only`,
      detail: promptDelta,
    });
    return;
  }

  // ── forced stop (§13.3): repair budget OR global generation budget
  //    exhausted, never a third attempt ──
  const fallback = (scene.assetCandidates ?? []).find((c) => c.score > 0.2);
  if (fallback) {
    store.update(projectId, (s) => {
      const target = sceneOf(s, sceneId);
      target.selectedAsset = fallback;
      target.sourceStrategy = "FALLBACK";
      target.sourceReason = "QA failed after repair budget — fell back to library clip";
    });
    await attachExistingAsset(projectId, sceneId);
    emit(projectId, {
      type: "SCENE_UPDATED",
      actor: "SYSTEM",
      sceneId,
      title: `${sceneId} forced fallback to library clip`,
      detail: "Repair budget exhausted; kept the run on track.",
    });
  } else {
    store.update(projectId, (s) => {
      sceneOf(s, sceneId).qualityWarning = true;
      transitionScene(s, sceneId, "READY");
    });
    emit(projectId, {
      type: "SCENE_UPDATED",
      actor: "SYSTEM",
      sceneId,
      title: `${sceneId} kept with quality_warning`,
      detail: "Repair budget exhausted; keeping the second generation.",
    });
  }
}

async function runGenerateVoices(projectId: string): Promise<void> {
  const store = getStore();
  const state = store.get(projectId)!;
  const pending = state.scenes.filter((s) => s.voiceover && !s.audioUrl);

  emit(projectId, {
    type: "TOOL_STARTED",
    actor: "TOOL",
    title: `generate_voice for ${pending.length} scene${pending.length === 1 ? "" : "s"}`,
  });

  for (const scene of pending) {
    let audioUrl: string;
    try {
      audioUrl = await generateSceneVoice({
        projectId,
        sceneId: scene.id,
        text: scene.voiceover!,
      });
    } catch (error) {
      // degrade, don't die: a TTS outage must not kill a finished-shoot run
      console.warn(`[tts] provider failed for ${scene.id} — using offline voice:`, error);
      emit(projectId, {
        type: "TOOL_PROGRESS",
        actor: "TOOL",
        sceneId: scene.id,
        title: "TTS provider failed — falling back to offline voice",
        detail: error instanceof Error ? error.message.slice(0, 120) : String(error),
      });
      const { FakeTtsProvider } = await import("@/lib/providers/fake-tts-provider");
      const outPath = mediaFile(projectId, `${scene.id}-voice.mp3`);
      await new FakeTtsProvider().synthesize({ text: scene.voiceover!, outPath });
      audioUrl = urlForMedia(outPath);
    }
    store.update(projectId, (s) => {
      sceneOf(s, scene.id).audioUrl = audioUrl;
    });
    emit(projectId, { type: "TOOL_COMPLETED", actor: "TOOL", sceneId: scene.id, title: "voiceover ready" });
  }
}

async function runComposeVideo(projectId: string): Promise<void> {
  const store = getStore();
  emit(projectId, { type: "TOOL_STARTED", actor: "TOOL", title: "compose_video: normalize → concat → mix" });

  const state = store.get(projectId)!;
  const finalUrl = await composeFinalVideo(projectId, state);

  store.update(projectId, (s) => {
    s.finalVideoUrl = finalUrl;
  });
  emit(projectId, { type: "TOOL_COMPLETED", actor: "TOOL", title: "Final MP4 ready", detail: finalUrl });
}

async function runFinish(projectId: string): Promise<void> {
  const store = getStore();
  const state = store.get(projectId)!;
  const allReady = state.scenes.length > 0 && state.scenes.every((s) => s.status === "READY");

  store.update(projectId, (s) => {
    s.status = state.finalVideoUrl || allReady ? "COMPLETED" : "FAILED";
    if (s.status === "FAILED" && !state.finalVideoUrl) {
      s.error = { category: "STATE", message: "pipeline stalled before composition" };
    }
    s.runtime.completedAt = new Date().toISOString();
  });

  emit(projectId, {
    type: "PROJECT_COMPLETED",
    actor: "SYSTEM",
    title: state.finalVideoUrl ? "Final ad delivered" : "Run finished",
    detail: state.finalVideoUrl,
  });
}

function emitScene(projectId: string, sceneId: string | undefined, title: string): void {
  if (!sceneId) return;
  emit(projectId, { type: "SCENE_UPDATED", actor: "SYSTEM", sceneId, title });
}
