"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { requestStopRefresh } from "./stop-helper";
import Link from "next/link";
import type { ProjectState, RuntimeEvent } from "@/lib/state/schema";
import { PROJECT_STATUS_ZH, ERROR_CATEGORY_ZH, marketLabel } from "@/lib/i18n";
import { AgentActivity } from "./agent-activity";
import { CreativeCanvas } from "./creative-canvas";
import { FinalVideo } from "./final-video";
import { IconAlert, IconPlus, IconStop } from "./icons";

/**
 * 三栏工作台（设计文档 §14）：
 * 左：简报 · 中：创意画布（3 张场景卡）· 右：智能体动态（事件流驱动）。
 * 失败时画布上方出现独立错误条，就地给出原因与出路。
 */
export function Studio({ projectId, autostart }: { projectId: string; autostart: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<ProjectState | null>(null);
  const [events, setEvents] = useState<RuntimeEvent[]>([]);
  const [notFound, setNotFound] = useState(false);
  const started = useRef(false);

  const canStop =
    state !== null &&
    state.status !== "COMPLETED" &&
    state.status !== "FAILED" &&
    state.status !== "STOPPED" &&
    state.runtime.demoMode !== "replay";

  const onStop = useCallback(async () => {
    if (!confirm("确定停止当前任务？当前批次完成后终止，已完成的场景与素材会保留。")) return;
    await fetch(`/api/projects/${projectId}/stop`, { method: "POST" });
    requestStopRefresh();
  }, [projectId]);

  const refreshState = useCallback(async () => {
    const response = await fetch(`/api/projects/${projectId}`);
    if (response.status === 404) {
      setNotFound(true);
      return;
    }
    const body = await response.json();
    setState(body.state as ProjectState);
  }, [projectId]);

  useEffect(() => {
    void refreshState();

    const source = new EventSource(`/api/projects/${projectId}/events`);
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as RuntimeEvent;
      setEvents((prev) => (prev.some((e) => e.id === event.id) ? prev : [...prev, event]));
      // 事件告诉我们"何时"变化；状态接口告诉我们"变成了什么"
      void refreshState();
    };
    source.onerror = () => {
      // SSE 断开（如开发服务器重启）：重拉状态保证界面一致
      void refreshState();
    };
    return () => source.close();
  }, [projectId, refreshState]);

  useEffect(() => {
    if (!autostart || started.current || !state) return;
    if (state.status !== "IDLE") return;
    started.current = true;
    void fetch(`/api/projects/${projectId}/run`, { method: "POST" });
  }, [autostart, state, projectId]);

  /** 引擎不支持终态原地重跑；把简报带回首页预填，一键新建重试。 */
  const retryWithNewProject = useCallback(() => {
    if (!state) return;
    sessionStorage.setItem("adpilot:retryBrief", JSON.stringify(state.brief));
    router.push("/");
  }, [state, router]);

  if (notFound) {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="text-center">
          <p className="text-lg font-semibold">项目不存在</p>
          <Link href="/" className="mt-2 inline-block text-sm text-indigo-400 hover:underline">
            ← 返回首页
          </Link>
        </div>
      </div>
    );
  }

  if (!state) {
    return <div className="grid min-h-screen place-items-center text-zinc-500">加载项目中…</div>;
  }

  const failedScenes = state.scenes.filter((s) => s.status === "FAILED").map((s) => s.id);
  const doneScenes = state.scenes
    .filter((s) => s.status === "READY")
    .map((s) => s.id);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
        <div className="flex items-center gap-3">
          <Link href="/" className="grid size-8 place-items-center rounded-lg bg-indigo-500 font-black text-white" title="返回首页">A</Link>
          <span className="font-bold tracking-tight">AdPilot</span>
          <span className="text-zinc-600">/</span>
          <span className="text-sm text-zinc-400">
            项目：{state.brief.productName} · {marketLabel(state.brief.market)}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2.5 text-xs">
          <StatusPill status={state.status} />
          {state.runtime.demoMode === "replay" && (
            <span className="rounded-full bg-amber-500/15 px-2.5 py-1 font-medium text-amber-300">
              回放 · 真实运行录制
            </span>
          )}
          {canStop && (
            <button
              type="button"
              onClick={() => void onStop()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/50 px-2.5 py-1 font-medium text-red-300 hover:bg-red-500/10"
              title="停止当前任务（当前批次完成后终止，已完成内容保留）"
            >
              <IconStop className="size-3" />
              停止
            </button>
          )}
          <Link href="/assets" className="rounded-lg border border-zinc-700 px-2.5 py-1 text-zinc-300 hover:border-zinc-500">
            素材库
          </Link>
          <Link href="/" className="inline-flex items-center gap-1 rounded-lg bg-indigo-500/90 px-2.5 py-1 font-medium text-white hover:bg-indigo-400">
            <IconPlus className="size-3.5" />
            新建广告
          </Link>
        </div>
      </header>

      <main className="grid flex-1 grid-cols-12 items-start gap-4 p-4">
        {state.error && (
          <section className="col-span-12 flex flex-wrap items-start justify-between gap-x-6 gap-y-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-semibold text-red-200">
                <IconAlert className="size-4 shrink-0" />
                运行中止 · {ERROR_CATEGORY_ZH[state.error.category] ?? state.error.category}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-red-200/80">{state.error.message}</p>
              {(failedScenes.length > 0 || doneScenes.length > 0) && (
                <p className="mt-1.5 text-xs text-zinc-400">
                  {failedScenes.length > 0 && (
                    <span>
                      受影响场景：<span className="text-red-200">{failedScenes.join("、")}</span>
                    </span>
                  )}
                  {failedScenes.length > 0 && doneScenes.length > 0 && " · "}
                  {doneScenes.length > 0 && <span>{doneScenes.join("、")} 已完成并保留</span>}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={retryWithNewProject}
              className="shrink-0 rounded-lg bg-red-500 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-red-400"
            >
              复制简报，新建重试
            </button>
          </section>
        )}

        <section className="col-span-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
          <h2 className="mb-3 text-sm font-semibold text-zinc-300">广告简报</h2>
          <BriefPanel state={state} />
        </section>

        <section className="col-span-6">
          <CreativeCanvas state={state} />
        </section>

        <section className="col-span-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
          <h2 className="mb-3 text-sm font-semibold text-zinc-300">智能体动态</h2>
          <AgentActivity events={events} autoCollapse={state.status === "COMPLETED"} />
        </section>
      </main>

      <FinalVideo state={state} />
    </div>
  );
}

function BriefPanel({ state }: { state: ProjectState }) {
  const rows: Array<[string, string]> = [
    ["产品", state.brief.productName],
    ["市场", marketLabel(state.brief.market)],
    ["受众", state.brief.audience],
    ["平台", state.brief.platform],
    ["时长", `${state.brief.durationSec} 秒`],
    ["画幅", state.brief.aspectRatio === "16:9" ? "横屏 16:9" : "竖屏 9:16"],
  ];
  return (
    <dl className="space-y-2.5 text-sm">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs font-medium text-zinc-500">{k}</dt>
          <dd className="text-zinc-200">{v}</dd>
        </div>
      ))}
      <div>
        <dt className="text-xs font-medium text-zinc-500">描述</dt>
        <dd className="text-xs leading-relaxed text-zinc-400">{state.brief.productDescription}</dd>
      </div>
    </dl>
  );
}

function StatusPill({ status }: { status: ProjectState["status"] }) {
  const styles: Record<ProjectState["status"], string> = {
    IDLE: "bg-zinc-800 text-zinc-400",
    PLANNING: "bg-sky-500/15 text-sky-300",
    EXECUTING: "bg-indigo-500/15 text-indigo-300",
    EVALUATING: "bg-violet-500/15 text-violet-300",
    REPAIRING: "bg-amber-500/15 text-amber-300",
    COMPOSING: "bg-teal-500/15 text-teal-300",
    COMPLETED: "bg-emerald-500/15 text-emerald-300",
    FAILED: "bg-red-500/15 text-red-300",
    STOPPED: "bg-zinc-700 text-zinc-300",
  };
  return (
    <span className={`rounded-full px-2.5 py-1 font-medium ${styles[status]}`}>
      {PROJECT_STATUS_ZH[status]}
    </span>
  );
}
