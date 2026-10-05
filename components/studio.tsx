"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { requestStopRefresh } from "./stop-helper";
import Link from "next/link";
import type { ProjectState, RuntimeEvent } from "@/lib/state/schema";
import { PROJECT_STATUS_ZH, DEMO_MODE_ZH } from "@/lib/i18n";
import { AgentActivity } from "./agent-activity";
import { CreativeCanvas } from "./creative-canvas";
import { FinalVideo } from "./final-video";

/**
 * 三栏工作台（设计文档 §14）：
 * 左：简报 · 中：创意画布（3 张场景卡）· 右：智能体动态（事件流驱动）。
 */
export function Studio({ projectId, autostart }: { projectId: string; autostart: boolean }) {
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

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
        <div className="flex items-center gap-3">
          <Link href="/" className="grid size-8 place-items-center rounded-lg bg-indigo-500 font-black text-white" title="返回首页">A</Link>
          <span className="font-bold tracking-tight">AdPilot</span>
          <span className="text-zinc-600">/</span>
          <span className="text-sm text-zinc-400">
            项目：{state.brief.productName} · {state.brief.market}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2.5 text-xs">
          <StatusPill status={state.status} />
          {state.runtime.demoMode && (
            <span className={`rounded-full px-2.5 py-1 font-medium ${state.runtime.demoMode === "replay" ? "bg-amber-500/15 text-amber-300" : "bg-zinc-800 text-zinc-400"}`}>
              {DEMO_MODE_ZH[state.runtime.demoMode] ?? state.runtime.demoMode}
            </span>
          )}
          {canStop && (
            <button
              type="button"
              onClick={() => void onStop()}
              className="rounded-lg border border-red-500/50 px-2.5 py-1 font-medium text-red-300 hover:bg-red-500/10"
              title="停止当前任务（当前批次完成后终止，已完成内容保留）"
            >
              ■ 停止
            </button>
          )}
          <Link href="/assets" className="rounded-lg border border-zinc-700 px-2.5 py-1 text-zinc-300 hover:border-zinc-500">
            素材库
          </Link>
          <Link href="/" className="rounded-lg bg-indigo-500/90 px-2.5 py-1 font-medium text-white hover:bg-indigo-400">
            ＋ 新建广告
          </Link>
        </div>
      </header>

      <main className="grid flex-1 grid-cols-12 items-start gap-4 p-4">
        <section className="col-span-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
          <h2 className="mb-3 text-sm font-semibold text-zinc-300">广告简报</h2>
          <BriefPanel state={state} />
        </section>

        <section className="col-span-6">
          <CreativeCanvas state={state} />
        </section>

        <section className="col-span-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
          <h2 className="mb-3 text-sm font-semibold text-zinc-300">智能体动态</h2>
          <AgentActivity events={events} />
        </section>
      </main>

      <FinalVideo state={state} />
    </div>
  );
}

function BriefPanel({ state }: { state: ProjectState }) {
  const rows: Array<[string, string]> = [
    ["产品", state.brief.productName],
    ["市场", state.brief.market],
    ["受众", state.brief.audience],
    ["平台", state.brief.platform],
    ["时长", `${state.brief.durationSec} 秒`],
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
      {state.error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-2.5">
          <p className="text-xs font-semibold text-red-300">{state.error.category}</p>
          <p className="mt-0.5 text-xs text-red-200/80">{state.error.message}</p>
        </div>
      )}
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
