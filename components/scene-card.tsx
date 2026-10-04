"use client";

import { useState } from "react";
import type { SceneState } from "@/lib/state/schema";
import { SceneDetail } from "./scene-detail";

const STATUS_STYLES: Record<SceneState["status"], string> = {
  PLANNED: "bg-zinc-800 text-zinc-400",
  SEARCHING: "bg-sky-500/15 text-sky-300",
  GENERATING: "bg-indigo-500/15 text-indigo-300",
  EVALUATING: "bg-violet-500/15 text-violet-300",
  REPAIRING: "bg-amber-500/15 text-amber-300",
  READY: "bg-emerald-500/15 text-emerald-300",
  FAILED: "bg-red-500/15 text-red-300",
};

const SOURCE_LABEL: Record<string, string> = {
  EXISTING_ASSET: "Existing",
  GENERATED_VIDEO: "Generate",
  REUSE: "Reuse",
  FALLBACK: "Fallback",
};

export function SceneCard({ scene }: { scene: SceneState }) {
  const [expanded, setExpanded] = useState(false);
  const busy = scene.status === "GENERATING" || scene.status === "SEARCHING" || scene.status === "EVALUATING" || scene.status === "REPAIRING";

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/60">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left"
      >
        <div className="relative h-[42vh] max-h-[520px] bg-zinc-950">
          {scene.videoUrl ? (
            <video
              src={scene.videoUrl}
              className="size-full object-cover"
              muted
              loop
              playsInline
              preload="metadata"
              onMouseEnter={(e) => void e.currentTarget.play().catch(() => {})}
              onMouseLeave={(e) => e.currentTarget.pause()}
            />
          ) : (
            <div className={`grid size-full place-items-center text-xs text-zinc-600 ${busy ? "animate-pulse" : ""}`}>
              {scene.status === "PLANNED" ? "no footage yet" : `${scene.status.toLowerCase()}…`}
            </div>
          )}

          <div className="absolute left-2 top-2 flex gap-1.5">
            <span className="rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-semibold text-white">
              {scene.id} · {scene.purpose}
            </span>
            {scene.qualityWarning && (
              <span className="rounded-full bg-amber-500/80 px-2 py-0.5 text-[10px] font-semibold text-black">
                warning
              </span>
            )}
          </div>

          {scene.qa && (
            <span
              className={`absolute right-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                scene.qa.decision === "PASS" ? "bg-emerald-500 text-black" : "bg-amber-500 text-black"
              }`}
            >
              {scene.qa.score} {scene.qa.decision}
            </span>
          )}

          <div className="absolute bottom-0 w-full bg-gradient-to-t from-black/85 to-transparent px-2.5 pb-2 pt-6">
            <p className="text-[11px] font-medium text-zinc-200">
              {scene.sourceStrategy ? SOURCE_LABEL[scene.sourceStrategy] : "pending"}
              {scene.repairHistory.length > 0 && (
                <span className="text-zinc-500"> · gen {scene.repairHistory.length + 1}</span>
              )}
              <span className="float-right text-zinc-500">{scene.durationSec}s</span>
            </p>
          </div>
        </div>
      </button>

      <div className="flex items-center justify-between gap-2 px-2.5 py-2">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLES[scene.status]}`}>
          {scene.status}
        </span>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-[10px] text-zinc-500 hover:text-zinc-300"
        >
          {expanded ? "hide detail ▲" : "detail ▼"}
        </button>
      </div>

      {expanded && <SceneDetail scene={scene} />}
    </div>
  );
}
