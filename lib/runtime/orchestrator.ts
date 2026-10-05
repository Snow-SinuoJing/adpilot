import fs from "node:fs";
import type { DirectorAction, ErrorCategory, ProjectState, SceneState } from "@/lib/state/schema";
import { getStore } from "@/lib/state/store";
import { directorView, scenesMatchingAction, type Capabilities } from "@/lib/state/selectors";
import { makeEvent } from "./events";
import { transitionScene, validateInvariants } from "./reducer";
import { canGenerateVideo, canRepairScene, canTakeDirectorStep, MAX_TOTAL_VIDEO_GENERATIONS } from "./limits";
import { decideNextAction, policyDecision } from "@/lib/agents/director";
import { createStrategy } from "@/lib/agents/strategy";
import { planAsset, buildGenerationPrompt } from "@/lib/agents/asset-planner";
import { searchAssets } from "@/lib/tools/search-assets";
import { runFfmpeg } from "@/lib/ffmpeg";
import { generateSceneVideo } from "@/lib/tools/generate-video";
import { evaluateScene } from "@/lib/tools/evaluate-scene";
import { generateSceneVoice } from "@/lib/tools/generate-voice";
import { composeFinalVideo } from "@/lib/tools/compose-video";
import { refineSegmentWindow } from "@/lib/tools/segment-refine";
import { getVideoProvider } from "@/lib/providers/video-provider";
import { getTtsProvider } from "@/lib/providers/tts-provider";
import { mediaFile, urlForMedia } from "@/lib/media";
import { llmConfig } from "@/lib/agents/llm";
import { ACTION_ZH, DEMO_MODE_ZH, SOURCE_ZH } from "@/lib/i18n";

/**
 * Orchestrator 主循环（设计文档 §10，按用户反馈 #1 升级为并行分发）。
 * Director 决定"做什么阶段"；同一阶段内所有符合条件的兄弟场景并行执行
 * （检索并行 / 规划并行 / 多路视频生成并行 / 多路评审并行）。单个场景
 * 失败只标记该场景，不炸整个 run。每步状态校验 + 落盘 + 可审计事件。
 */

const runningProjects = new Set<string>();

export interface OrchestratorDeps {
  capabilities: Capabilities;
}

export function defaultDeps(): OrchestratorDeps {
  return {
    capabilities: {
      video: getVideoProvider() !== null,
      critic: true,
      tts: getTtsProvider() !== null,
      compose: true,
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

function aspectOf(state: ProjectState): "9:16" | "16:9" {
  return state.brief.aspectRatio === "16:9" ? "16:9" : "9:16";
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

/** 并行批次执行 + 单场景失败隔离（用户反馈 #1）。 */
async function runBatch(
  projectId: string,
  scenes: SceneState[],
  task: (sceneId: string) => Promise<void>,
): Promise<void> {
  if (scenes.length <= 1) {
    if (scenes.length === 1) await task(scenes[0].id);
    return;
  }
  emit(projectId, {
    type: "SCENE_UPDATED",
    actor: "SYSTEM",
    title: `⚡ 并行执行 ${scenes.length} 个场景：${scenes.map((s) => s.id).join("、")}`,
  });
  const results = await Promise.allSettled(scenes.map((s) => task(s.id)));
  for (const [i, result] of results.entries()) {
    if (result.status === "rejected") {
      const sceneId = scenes[i].id;
      const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
      emit(projectId, {
        type: "ERROR",
        actor: "SYSTEM",
        sceneId,
        title: `${sceneId} 执行失败（不影响其他场景）`,
        detail: message,
      });
      try {
        getStore().update(projectId, (s) => transitionScene(s, sceneId, "FAILED"));
      } catch {
        // 场景状态可能已被任务自身推进；忽略非法转换
      }
    }
  }
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
      title: `智能体运行启动（${DEMO_MODE_ZH[demoMode()]}模式）`,
      detail: `决策模型: ${llmConfig().mode === "live" ? "GLM 实时" : "mock"}${deps.capabilities.video ? ` · 视频: ${getVideoProvider()?.name}` : ""}`,
    });

    while (true) {
      const state = store.get(projectId)!;
      if (isTerminal(state)) break;

      if (!canTakeDirectorStep(state)) {
        failProject(projectId, "STATE", "已达到导演步数上限（MAX_DIRECTOR_STEPS）");
        break;
      }

      const view = directorView(state, deps.capabilities);
      // Director LLM 是决策顾问，确定性 policy 是底线——模型抖动绝不中断运行
      let decision;
      try {
        decision = await decideNextAction(view);
      } catch (error) {
        console.warn("[director] LLM 决策失败——回退到确定性策略:", error);
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
      const siblings = scenesMatchingAction(decision.action, state, deps.capabilities);
      const parallelNote =
        siblings.length > 1 && decision.sceneId ? `（并行处理 ${siblings.length} 个场景）` : "";
      emit(projectId, {
        type: "DECISION_MADE",
        actor: "DIRECTOR",
        sceneId: decision.sceneId,
        title: `决策：${ACTION_ZH[decision.action]}${decision.sceneId ? ` ${decision.sceneId}` : ""}${parallelNote}`,
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
          title: `${ACTION_ZH[decision.action]} 执行失败`,
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
  emit(projectId, { type: "ERROR", actor: "SYSTEM", title: "项目失败", detail: message });
}

// ─── action handlers ─────────────────────────────────────────────────────────

async function executeAction(
  projectId: string,
  action: DirectorAction,
  _sceneId: string | undefined,
  deps: OrchestratorDeps,
): Promise<void> {
  const store = getStore();
  const state = () => store.get(projectId)!;

  switch (action) {
    case "CREATE_STRATEGY":
      return runCreateStrategy(projectId);

    case "RETRIEVE_ASSET": {
      const siblings = state().scenes.filter((s) => s.status === "PLANNED");
      await runBatch(projectId, siblings, (sceneId) => runRetrieveAsset(projectId, sceneId));
      return;
    }

    case "PLAN_ASSETS": {
      const siblings = state().scenes.filter(
        (s) => s.status === "SEARCHING" && s.assetCandidates && !s.sourceStrategy,
      );
      await runBatch(projectId, siblings, (sceneId) => runPlanAssets(projectId, sceneId, deps));
      return;
    }

    case "GENERATE_VIDEO": {
      const current = state();
      const eligible = current.scenes.filter(
        (s) =>
          s.sourceStrategy === "GENERATED_VIDEO" &&
          !s.videoUrl &&
          (s.status === "SEARCHING" || s.status === "REPAIRING") &&
          s.generationPrompt,
      );
      const budgetLeft = MAX_TOTAL_VIDEO_GENERATIONS - current.runtime.totalVideoGenerations;
      const batch = eligible.slice(0, Math.max(0, budgetLeft));
      if (batch.length > 0) {
        store.update(projectId, (s) => {
          s.runtime.totalVideoGenerations += batch.length;
        });
      }
      await runBatch(projectId, batch, (sceneId) => runGenerateVideo(projectId, sceneId));
      return;
    }

    case "EVALUATE_SCENE": {
      const siblings = state().scenes.filter((s) => s.videoUrl && !s.qa && s.status !== "READY");
      await runBatch(projectId, siblings, (sceneId) => runEvaluateScene(projectId, sceneId));
      return;
    }

    case "REPAIR_SCENE":
      return runRepairScene(projectId, _sceneId!);
    case "GENERATE_VOICE":
      return runGenerateVoices(projectId);
    case "COMPOSE_VIDEO":
      return runComposeVideo(projectId);
    case "FINISH":
      return runFinish(projectId);
  }
}

async function runCreateStrategy(projectId: string): Promise<void> {
  const store = getStore();
  emit(projectId, { type: "AGENT_STARTED", actor: "STRATEGY", title: "正在创建三段式创意叙事" });

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
    title: `策略就绪：${strategy.scenes.map((s) => `${s.id} ${s.purpose} ${s.durationSec}s`).join(" · ")}`,
    detail: strategy.concept,
  });
}

async function runRetrieveAsset(projectId: string, sceneId: string): Promise<void> {
  const store = getStore();
  store.update(projectId, (s) => transitionScene(s, sceneId, "SEARCHING"));
  emitScene(projectId, sceneId, "正在检索素材库");
  emit(projectId, { type: "TOOL_STARTED", actor: "TOOL", sceneId, title: "检索素材" });

  const state = store.get(projectId)!;
  const scene = sceneOf(state, sceneId);
  // 产品锚定（用户反馈 #4）：产品词并入查询，产品主体不符的素材天然得分低
  const query = `${scene.visualIntent}。产品：${state.brief.productName}——${state.brief.productDescription}`;
  const candidates = searchAssets({ query, purpose: scene.purpose, topK: 3 });

  store.update(projectId, (s) => {
    sceneOf(s, sceneId).assetCandidates = candidates;
  });
  emit(projectId, {
    type: "TOOL_COMPLETED",
    actor: "TOOL",
    sceneId,
    title: `检索到 ${candidates.length} 个候选素材`,
    detail:
      candidates
        .map((c) => `${c.id}（${c.score.toFixed(2)}${c.startTime !== undefined ? ` · ${c.startTime}-${c.endTime}s` : ""}）${c.description}`)
        .join(" | ") || "没有候选",
  });
}

async function runPlanAssets(projectId: string, sceneId: string, deps: OrchestratorDeps): Promise<void> {
  const store = getStore();
  emit(projectId, { type: "AGENT_STARTED", actor: "ASSET", sceneId, title: "正在决策画面来源" });

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
    title: `${sceneId} → ${SOURCE_ZH[decision.strategy]}`,
    detail: decision.reason,
    data: { strategy: decision.strategy, confidence: decision.confidence },
  });

  if (decision.selectedAssetId && (decision.strategy === "EXISTING_ASSET" || decision.strategy === "FALLBACK")) {
    await attachExistingAsset(projectId, sceneId);
  } else if (decision.strategy === "FALLBACK") {
    // 无素材可用也无生成能力：诚实标记失败，而不是带着空画面"就绪"
    store.update(projectId, (s) => {
      sceneOf(s, sceneId).qualityWarning = true;
      transitionScene(s, sceneId, "FAILED");
    });
    emitScene(projectId, sceneId, "降级但没有可用素材——场景标记失败");
  }
}

/** Pure: cut args for a segment candidate (frame-accurate re-encode). */
export function buildSegmentCutArgs(input: {
  source: string;
  startTime: number;
  endTime: number;
  dest: string;
}): string[] {
  return [
    "-ss", String(input.startTime),
    "-to", String(input.endTime),
    "-i", input.source,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    input.dest,
  ];
}

/** 挂载选中的素材（整条或切片）：切片先视觉精确定位（#3），
 *  素材类场景同样路由到多模态评审（#4）。ffmpeg 副作用在 mutator 之外。 */
async function attachExistingAsset(projectId: string, sceneId: string): Promise<void> {
  const store = getStore();
  const state = store.get(projectId)!;
  const scene = sceneOf(state, sceneId);
  const asset = scene.selectedAsset;
  if (!asset) throw new Error(`no selected asset for ${sceneId}`);

  let cut: { source: string; startTime: number; endTime: number; dest: string } | null = null;
  if (asset.startTime !== undefined && asset.endTime !== undefined) {
    let start = asset.startTime;
    let end = asset.endTime;
    const refined = await refineSegmentWindow({
      videoPath: asset.path,
      startTime: start,
      endTime: end,
      intent: scene.visualIntent,
      product: state.brief.productName,
    });
    if (refined) {
      emit(projectId, {
        type: "TOOL_PROGRESS",
        actor: "TOOL",
        sceneId,
        title: `切片精确定位：${start.toFixed(1)}-${end.toFixed(1)}s → ${refined.start.toFixed(1)}-${refined.end.toFixed(1)}s`,
      });
      start = refined.start;
      end = refined.end;
    }
    cut = { source: asset.path, startTime: start, endTime: end, dest: mediaFile(projectId, `${sceneId}-existing.mp4`) };
  }

  const dest = cut ? cut.dest : mediaFile(projectId, `${sceneId}-existing.mp4`);
  if (!cut) {
    fs.copyFileSync(asset.path, dest);
  }
  store.update(projectId, (s) => {
    sceneOf(s, sceneId).videoUrl = urlForMedia(dest);
    transitionScene(s, sceneId, "EVALUATING");
  });
  if (cut) {
    await runFfmpeg(buildSegmentCutArgs(cut));
  }
  emitScene(projectId, sceneId, "已挂载素材库片段——评审中");
}

async function runGenerateVideo(projectId: string, sceneId: string): Promise<void> {
  const store = getStore();
  const state = store.get(projectId)!;
  const scene = sceneOf(state, sceneId);
  if (!scene.generationPrompt) throw new Error(`没有生成提示词: ${sceneId}`);

  const genIndex = scene.repairHistory.length + 1;

  store.update(projectId, (s) => {
    transitionScene(s, sceneId, "GENERATING");
  });
  emitScene(projectId, sceneId, `正在生成视频（第 ${genIndex} 版）`);
  emit(projectId, { type: "TOOL_STARTED", actor: "TOOL", sceneId, title: "提交视频生成任务" });

  const result = await generateSceneVideo({
    projectId,
    sceneId,
    prompt: scene.generationPrompt,
    durationSec: scene.durationSec,
    generationIndex: genIndex,
    aspectRatio: aspectOf(state),
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
    title: `视频就绪${result.fromCache ? "（命中缓存）" : ""}`,
    detail: `${result.provider}/${result.model}${result.jobId ? ` · 任务 ${result.jobId}` : ""}`,
  });
  emitScene(projectId, sceneId, "视频已生成——等待质检");
}

async function runEvaluateScene(projectId: string, sceneId: string): Promise<void> {
  const store = getStore();
  emit(projectId, { type: "AGENT_STARTED", actor: "CRITIC", sceneId, title: "多模体质检" });

  const state = store.get(projectId)!;
  let result: Awaited<ReturnType<typeof evaluateScene>>["result"];
  let frameUrls: string[] = [];
  try {
    ({ result, frameUrls } = await evaluateScene(state, sceneId));
  } catch (error) {
    // 设计文档 §18.2：评审服务失败 → 保守放行
    console.warn(`[critic] ${sceneId} 评审失败——保守放行:`, error);
    result = {
      score: 76,
      decision: "PASS",
      dimensions: { intentAlignment: 76, visualQuality: 76, productVisibility: 76, localization: 76, safetyAndText: 76 },
      issues: [
        {
          type: "critic-unavailable",
          severity: "low",
          description: `评审服务暂不可用（${error instanceof Error ? error.message.slice(0, 60) : "未知"}），保守放行。`,
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
    title: `${sceneId} 得分 ${result.score} — ${result.decision === "PASS" ? "通过" : "需修复"}`,
    detail:
      result.issues
        .map((i) => `${i.severity === "high" ? "严重" : i.severity === "medium" ? "中等" : "轻微"}：${i.description}`)
        .join(" | ") || "无问题",
    data: { score: result.score, decision: result.decision, dimensions: result.dimensions, frameUrls },
  });
  emitScene(projectId, sceneId, result.decision === "PASS" ? "质检通过——就绪" : "质检需修复");
}

async function runRepairScene(projectId: string, sceneId: string): Promise<void> {
  const store = getStore();
  const state = store.get(projectId)!;
  const scene = sceneOf(state, sceneId);
  const qa = scene.qa;

  if (qa?.decision !== "REPAIR") return;

  // ── 情形 A：AI 生成类场景 → 修补提示词，只重生成该场景 ──
  if (scene.sourceStrategy === "GENERATED_VIDEO" && canRepairScene(scene) && canGenerateVideo(state)) {
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
        // 版本对比数据：保留第一版视频与打回原因（用户反馈 #3）
        previousVideoUrl: target.videoUrl,
        issues: qa.issues,
        previousDimensions: qa.dimensions,
      });
      target.generationPrompt = `${target.generationPrompt ?? ""}\n[repair ${target.repairHistory.length}] ${promptDelta}`.trim();
      target.videoUrl = undefined;
      target.videoJobId = undefined;
      target.qa = undefined;
      s.runtime.totalRepairs += 1;
    });

    emit(projectId, {
      type: "REPAIR_STARTED",
      actor: "DIRECTOR",
      sceneId,
      title: `修复 ${sceneId}——修补提示词，只重新生成该场景`,
      detail: promptDelta,
    });
    return;
  }

  // ── 情形 B：素材类场景未通过评审 → 换下一个候选素材重新挂载（用户反馈 #4）──
  if (scene.sourceStrategy !== "GENERATED_VIDEO") {
    const rejected = new Set([
      ...(scene.rejectedAssetIds ?? []),
      scene.selectedAsset?.id,
    ].filter(Boolean) as string[]);
    const next = (scene.assetCandidates ?? []).find((c) => !rejected.has(c.id) && c.score > 0.1);

    if (next) {
      store.update(projectId, (s) => {
        const target = sceneOf(s, sceneId);
        target.rejectedAssetIds = [...rejected];
        target.selectedAsset = next;
        target.qa = undefined;
        target.videoUrl = undefined;
        target.sourceReason = `上一条素材未通过评审（${qa.issues[0]?.description.slice(0, 40) ?? "原因未知"}）——更换候选`;
      });
      emit(projectId, {
        type: "REPAIR_STARTED",
        actor: "DIRECTOR",
        sceneId,
        title: `更换 ${sceneId} 的素材：${scene.selectedAsset?.id} → ${next.id}`,
        detail: `上一条被评审打回：${qa.issues.map((i) => i.description).join("；").slice(0, 120)}`,
      });
      await attachExistingAsset(projectId, sceneId);
      return;
    }

    if (canGenerateVideo(state)) {
      store.update(projectId, (s) => {
        const target = sceneOf(s, sceneId);
        target.rejectedAssetIds = [...rejected];
        target.sourceStrategy = "GENERATED_VIDEO";
        target.generationPrompt = buildGenerationPrompt(target, s.brief);
        target.sourceReason = "素材候选均未通过评审——改为 AI 生成";
        target.qa = undefined;
        target.videoUrl = undefined;
      });
      emit(projectId, {
        type: "REPAIR_STARTED",
        actor: "DIRECTOR",
        sceneId,
        title: `${sceneId} 候选素材全部未通过评审——切换为 AI 生成`,
      });
      return;
    }
  }

  // ── 情形 C：强制停止（§13.3）——预算耗尽，绝不第三次尝试 ──
  const fallback = (scene.assetCandidates ?? []).find(
    (c) => c.score > 0.2 && c.id !== scene.selectedAsset?.id,
  );
  if (fallback && !canGenerateVideo(state)) {
    store.update(projectId, (s) => {
      const target = sceneOf(s, sceneId);
      target.selectedAsset = fallback;
      target.sourceStrategy = "FALLBACK";
      target.sourceReason = "评审未通过且额度用尽——降级为最接近的素材库片段";
    });
    await attachExistingAsset(projectId, sceneId);
    emit(projectId, {
      type: "SCENE_UPDATED",
      actor: "SYSTEM",
      sceneId,
      title: `${sceneId} 强制降级为素材库片段`,
      detail: "修复预算已用尽；保证整体运行继续。",
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
      title: `${sceneId} 保留当前版本并标记质量警告`,
      detail: "修复预算已用尽；保留当前结果。",
    });
  }
}

async function runGenerateVoices(projectId: string): Promise<void> {
  const store = getStore();
  const state = store.get(projectId)!;
  const pending = state.scenes.filter((s) => s.voiceover && !s.audioUrl && s.status === "READY");

  emit(projectId, {
    type: "TOOL_STARTED",
    actor: "TOOL",
    title: `为 ${pending.length} 个场景生成配音`,
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
      // 降级不死机：TTS 故障不能毁掉拍完的 run
      console.warn(`[tts] ${scene.id} 生成失败——离线语音兜底:`, error);
      emit(projectId, {
        type: "TOOL_PROGRESS",
        actor: "TOOL",
        sceneId: scene.id,
        title: "TTS 服务不可用——降级为离线语音",
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
    emit(projectId, { type: "TOOL_COMPLETED", actor: "TOOL", sceneId: scene.id, title: "配音就绪" });
  }
}

async function runComposeVideo(projectId: string): Promise<void> {
  const store = getStore();
  emit(projectId, { type: "TOOL_STARTED", actor: "TOOL", title: "合成视频：标准化 → 拼接 → 混音" });

  const state = store.get(projectId)!;
  const finalUrl = await composeFinalVideo(projectId, state);

  store.update(projectId, (s) => {
    s.finalVideoUrl = finalUrl;
  });
  emit(projectId, { type: "TOOL_COMPLETED", actor: "TOOL", title: "最终 MP4 就绪", detail: finalUrl });
}

async function runFinish(projectId: string): Promise<void> {
  const store = getStore();
  const state = store.get(projectId)!;
  const allReady = state.scenes.length > 0 && state.scenes.every((s) => s.status === "READY");

  store.update(projectId, (s) => {
    s.status = state.finalVideoUrl || allReady ? "COMPLETED" : "FAILED";
    if (s.status === "FAILED" && !state.finalVideoUrl) {
      s.error = { category: "STATE", message: "流水线在合成前停滞" };
    }
    s.runtime.completedAt = new Date().toISOString();
  });

  emit(projectId, {
    type: "PROJECT_COMPLETED",
    actor: "SYSTEM",
    title: state.finalVideoUrl ? "最终广告已交付" : "运行结束",
    detail: state.finalVideoUrl,
  });
}

function emitScene(projectId: string, sceneId: string | undefined, title: string): void {
  if (!sceneId) return;
  emit(projectId, { type: "SCENE_UPDATED", actor: "SYSTEM", sceneId, title });
}
