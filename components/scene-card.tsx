"use client";

import { useState } from "react";
import type { SceneState } from "@/lib/state/schema";
import { SCENE_STATUS_ZH, SOURCE_ZH, PURPOSE_ZH, formatDuration } from "@/lib/i18n";
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

/** 运行中的三段流水线：检索 → 生成 → 评审。 */
const STAGES = ["检索", "生成", "评审"] as const;

function stageIndex(status: SceneState["status"]): number | null {
  if (status === "SEARCHING") return 0;
  if (status === "GENERATING" || status === "REPAIRING") return 1;
  if (status === "EVALUATING") return 2;
  return null;
}

export function SceneCard({ scene, landscape = false }: { scene: SceneState; landscape?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const busy =
    scene.status === "GENERATING" ||
    scene.status === "SEARCHING" ||
    scene.status === "EVALUATING" ||
    scene.status === "REPAIRING";
  const activeStage = stageIndex(scene.status);

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/60">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left"
      >
        <div
          className={`relative bg-zinc-950 ${landscape ? "aspect-video w-full" : "h-[42vh] max-h-[520px]"}`}
        >
          {scene.videoUrl ? (
            <video
              src={`${scene.videoUrl}#t=0.5`}
              className="size-full object-cover"
              muted
              loop
              playsInline
              preload="metadata"
              onMouseEnter={(e) => void e.currentTarget.play().catch(() => {})}
              onMouseLeave={(e) => e.currentTarget.pause()}
            />
          ) : (
            <div className={`grid size-full place-items-center px-4 text-center text-xs text-zinc-600 ${busy ? "animate-pulse" : ""}`}>
              {scene.status === "PLANNED" ? "等待生成" : scene.status === "FAILED" ? "生成失败——详情见下方" : `${SCENE_STATUS_ZH[scene.status]}…`}
            </div>
          )}

          <div className="absolute left-2 top-2 flex gap-1.5">
            <span className="rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-semibold text-white">
              {scene.id} · {PURPOSE_ZH[scene.purpose]}
            </span>
            {scene.qualityWarning && (
              <span className="rounded-full bg-amber-500/80 px-2 py-0.5 text-[10px] font-semibold text-black">
                质量警告
              </span>
            )}
          </div>

          {scene.qa && (
            <span
              className={`absolute right-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                scene.qa.decision === "PASS" ? "bg-emerald-500 text-black" : "bg-amber-500 text-black"
              }`}
            >
              {scene.qa.score} 分 · {scene.qa.decision === "PASS" ? "通过" : "需修复"}
            </span>
          )}

          <div className="absolute bottom-0 w-full bg-gradient-to-t from-black/85 to-transparent px-2.5 pb-2 pt-6">
            <p className="text-[11px] font-medium text-zinc-200">
              {scene.sourceStrategy ? SOURCE_ZH[scene.sourceStrategy] : "来源决策中"}
              {scene.repairHistory.length > 0 && (
                <span className="text-zinc-500"> · 第 {scene.repairHistory.length + 1} 版</span>
              )}
              <span className="float-right text-zinc-500">{formatDuration(scene.durationSec)}</span>
            </p>
          </div>
        </div>
      </button>

      {activeStage !== null && (
        <div className="flex items-center gap-2 px-2.5 pt-2" aria-label="流水线进度">
          <div className="flex flex-1 gap-1">
            {STAGES.map((stage, i) => (
              <span
                key={stage}
                className={`h-0.5 flex-1 rounded-full ${
                  i < activeStage
                    ? "bg-indigo-400/70"
                    : i === activeStage
                      ? "animate-pulse bg-indigo-400"
                      : "bg-zinc-800"
                }`}
              />
            ))}
          </div>
          <span className="text-[10px] text-zinc-500">{STAGES[activeStage]}中</span>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 px-2.5 py-2">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLES[scene.status]}`}>
          {SCENE_STATUS_ZH[scene.status]}
        </span>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-[10px] text-zinc-500 hover:text-zinc-300"
        >
          {expanded ? "收起详情 ▲" : "查看详情 ▼"}
        </button>
      </div>

      {expanded && <SceneDetail scene={scene} landscape={landscape} />}
    </div>
  );
}
