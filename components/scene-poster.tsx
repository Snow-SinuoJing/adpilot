"use client";

import { useState } from "react";
import type { SceneState } from "@/lib/state/schema";
import { SCENE_STATUS_ZH, SOURCE_ZH, PURPOSE_ZH, formatDuration } from "@/lib/i18n";
import { SceneDetail } from "./scene-detail";

/** 运行中的三段流水线：检索 → 生成 → 评审。 */
const STAGES = ["检索", "生成", "评审"] as const;

function stageIndex(status: SceneState["status"]): number | null {
  if (status === "SEARCHING") return 0;
  if (status === "GENERATING" || status === "REPAIRING") return 1;
  if (status === "EVALUATING") return 2;
  return null;
}

/** 提案区场景海报：巨型编号 + 画面 + 分数印章，运行中显示流水线进度。 */
export function ScenePoster({
  scene,
  index,
  landscape = false,
}: {
  scene: SceneState;
  index: number;
  landscape?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const busy =
    scene.status === "GENERATING" ||
    scene.status === "SEARCHING" ||
    scene.status === "EVALUATING" ||
    scene.status === "REPAIRING";
  const activeStage = stageIndex(scene.status);
  const repaired = scene.repairHistory.length > 0;
  const failed = scene.status === "FAILED";

  return (
    <section className={`relative flex flex-col ${repaired ? "hot" : ""}`}>
      <p className="mb-2 font-mono text-[11px] font-medium tracking-[0.3em] text-grey">
        SCENE · {scene.sourceStrategy ? SOURCE_ZH[scene.sourceStrategy] : "待决策"}
        {repaired && <span className="text-orange"> · 第 {scene.repairHistory.length + 1} 版</span>}
      </p>
      <p className={`text-[72px] font-black leading-[0.85] tracking-[-0.04em] md:text-[82px] ${repaired ? "text-orange" : ""}`}>
        {String(index + 1).padStart(2, "0")}
      </p>

      <figure className="relative mt-3.5">
        <button type="button" onClick={() => setExpanded((v) => !v)} className="block w-full text-left">
          <div className={`relative w-full overflow-hidden border border-ink/25 bg-[#e9e4d6] ${landscape ? "aspect-video" : "aspect-[9/12]"}`}>
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
              <div className={`grid size-full place-items-center px-4 text-center text-xs text-grey ${busy ? "animate-pulse" : ""}`}>
                {scene.status === "PLANNED" ? "等待开机" : failed ? "生成失败 · 详情见下方" : `${SCENE_STATUS_ZH[scene.status]}…`}
              </div>
            )}
          </div>
        </button>
        {scene.qa && (
          <span className={`stamp absolute top-20 right-3 text-[20px] ${scene.qa.decision === "PASS" ? "stamp-ink" : ""}`}>
            {scene.qa.score}
            <small>{scene.qa.decision === "PASS" ? "分 · 通过" : failed ? "分 · NG" : "分 · 需重拍"}</small>
          </span>
        )}
        {failed && !scene.qa && (
          <span className="stamp absolute top-20 right-3 text-[20px]">NG<small>未产出画面</small></span>
        )}
        {scene.qualityWarning && scene.status === "READY" && (
          <span className="absolute left-3 top-3 border-[1.5px] border-orange bg-paper px-2 py-0.5 text-[10px] font-black tracking-[0.2em] text-orange">
            质量警告
          </span>
        )}
      </figure>

      <div className="mt-3 flex items-baseline justify-between gap-2">
        <span className="text-[15px] font-extrabold">
          {PURPOSE_ZH[scene.purpose]} · {scene.visualIntent.slice(0, 8)}
        </span>
        <span className="font-mono text-[10px] leading-[1.7] tracking-[0.16em] text-grey">
          {formatDuration(scene.durationSec)}
          <br />
          {scene.purpose}
        </span>
      </div>

      {activeStage !== null && (
        <div className="mt-2.5 flex items-center gap-2" aria-label="流水线进度">
          <div className="flex flex-1 gap-1">
            {STAGES.map((stage, i) => (
              <span
                key={stage}
                className={`h-[5px] flex-1 ${
                  i < activeStage ? "bg-orange/60" : i === activeStage ? "animate-pulse bg-orange" : "bg-ink/15"
                }`}
              />
            ))}
          </div>
          <span className="font-mono text-[10px] text-grey">{STAGES[activeStage]}中</span>
        </div>
      )}

      <div className="mt-2 flex items-center justify-between gap-2">
        <span
          className={`px-2 py-0.5 text-[10px] font-black tracking-[0.12em] ${
            failed
              ? "border-[1.5px] border-orange text-orange"
              : scene.status === "READY"
                ? "bg-ink text-paper"
                : busy
                  ? "bg-orange/15 text-orange"
                  : "bg-ink/10 text-ink"
          }`}
        >
          {SCENE_STATUS_ZH[scene.status]}
        </span>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-[11px] text-grey underline decoration-ink/30 underline-offset-4 hover:text-orange"
        >
          {expanded ? "收起详情 ▲" : "场记详情 ▼"}
        </button>
      </div>

      {expanded && (
        <div className="mt-3 border-t border-ink/20 pt-3">
          <SceneDetail scene={scene} landscape={landscape} />
        </div>
      )}
    </section>
  );
}
