"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { ProjectState, RuntimeEvent } from "@/lib/state/schema";
import { AgentActivity } from "./agent-activity";
import { CreativeCanvas } from "./creative-canvas";
import { FinalVideo } from "./final-video";

/**
 * The three-column studio (design doc §14).
 * Left: brief · Center: creative canvas (3 scene cards) · Right: agent
 * activity timeline rendered purely from the RuntimeEvent SSE stream.
 */
export function Studio({ projectId, autostart }: { projectId: string; autostart: boolean }) {
  const [state, setState] = useState<ProjectState | null>(null);
  const [events, setEvents] = useState<RuntimeEvent[]>([]);
  const [notFound, setNotFound] = useState(false);
  const started = useRef(false);

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
      // events tell us WHEN something changed; the state endpoint says WHAT
      void refreshState();
    };
    source.onerror = () => {
      // SSE dropped (e.g. dev server restart): state refetch keeps UI sane
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
          <p className="text-lg font-semibold">Project not found</p>
          <Link href="/" className="mt-2 inline-block text-sm text-indigo-400 hover:underline">
            ← back to brief
          </Link>
        </div>
      </div>
    );
  }

  if (!state) {
    return <div className="grid min-h-screen place-items-center text-zinc-500">Loading project…</div>;
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
        <div className="flex items-center gap-3">
          <Link href="/" className="grid size-8 place-items-center rounded-lg bg-indigo-500 font-black text-white">A</Link>
          <span className="font-bold tracking-tight">AdPilot</span>
          <span className="text-zinc-600">/</span>
          <span className="text-sm text-zinc-400">
            Project: {state.brief.productName} · {state.brief.market}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-xs">
          <StatusPill status={state.status} />
          {state.runtime.demoMode && (
            <span className={`rounded-full px-2.5 py-1 font-medium ${state.runtime.demoMode === "replay" ? "bg-amber-500/15 text-amber-300" : "bg-zinc-800 text-zinc-400"}`}>
              {state.runtime.demoMode === "replay" ? "Replay of previous real run" : state.runtime.demoMode}
            </span>
          )}
        </div>
      </header>

      <main className="grid flex-1 grid-cols-12 items-start gap-4 p-4">
        <section className="col-span-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
          <h2 className="mb-3 text-sm font-semibold text-zinc-300">Brief</h2>
          <BriefPanel state={state} />
        </section>

        <section className="col-span-6">
          <CreativeCanvas state={state} />
        </section>

        <section className="col-span-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
          <h2 className="mb-3 text-sm font-semibold text-zinc-300">Agent Activity</h2>
          <AgentActivity events={events} />
        </section>
      </main>

      <FinalVideo state={state} />
    </div>
  );
}

function BriefPanel({ state }: { state: ProjectState }) {
  const rows: Array<[string, string]> = [
    ["Product", state.brief.productName],
    ["Market", state.brief.market],
    ["Audience", state.brief.audience],
    ["Platform", state.brief.platform],
    ["Duration", `${state.brief.durationSec}s`],
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
        <dt className="text-xs font-medium text-zinc-500">Description</dt>
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
  };
  return (
    <span className={`rounded-full px-2.5 py-1 font-medium ${styles[status]}`}>{status}</span>
  );
}
