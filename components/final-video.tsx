"use client";

import type { ProjectState } from "@/lib/state/schema";
import { IconDownload } from "./icons";

/**
 * 成片交付带：完成态的主视觉——大播放器 + 下载主按钮 + 制作轨迹。
 * 非完成态只保留一个安静的占位，不渲染空播放器。
 */
export function FinalVideo({ state }: { state: ProjectState }) {
  const landscape = state.brief.aspectRatio === "16:9";
  const ready = Boolean(state.finalVideoUrl);
  const playerClass = landscape ? "aspect-video w-[440px] max-w-full" : "aspect-[9/16] w-60";
  const repairs = state.scenes.flatMap((scene) =>
    scene.repairHistory.map((record) => ({ scene, record })),
  );

  return (
    <footer className="border-t border-zinc-800 bg-zinc-900/30 px-4 py-5">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
        {ready ? (
          <video
            key={state.finalVideoUrl}
            src={`${state.finalVideoUrl}#t=0.5`}
            className={`${playerClass} shrink-0 rounded-xl border border-zinc-800 bg-black object-cover shadow-[0_12px_48px_rgba(0,0,0,0.55)]`}
            controls
            playsInline
            preload="metadata"
          />
        ) : (
          <div
            className={`${playerClass} grid shrink-0 place-items-center rounded-xl border border-dashed border-zinc-800 bg-zinc-950/60`}
          >
            <div className="px-4 text-center">
              <p className={`text-sm text-zinc-400 ${state.status === "COMPOSING" ? "animate-pulse" : ""}`}>
                {state.status === "COMPOSING" ? "正在合成最终成片…" : "成片将在所有场景通过质检后自动合成"}
              </p>
              <p className="mt-1 text-xs text-zinc-600">
                {state.brief.durationSec} 秒 · {landscape ? "横屏 16:9" : "竖屏 9:16"}
              </p>
            </div>
          </div>
        )}

        <div className="min-w-0 flex-1 space-y-4 py-1">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold tracking-tight">最终成片</h2>
              {ready && (
                <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-300">
                  已就绪 · {state.brief.durationSec} 秒 · {landscape ? "横屏 16:9" : "竖屏 9:16"}
                </span>
              )}
            </div>
            {!ready && (
              <p className="mt-1.5 text-xs leading-relaxed text-zinc-500">
                {state.status === "FAILED"
                  ? "本次运行未产出成片——查看上方错误信息，处理后可复制简报重试。"
                  : "每个场景通过质检后自动拼接、配音、混音，无需手动操作。"}
              </p>
            )}
          </div>

          {ready && (
            <a
              href={state.finalVideoUrl}
              download={`${state.brief.productName.toLowerCase().replace(/\s+/g, "-")}.mp4`}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-400"
            >
              <IconDownload className="size-4" />
              下载 MP4
            </a>
          )}

          <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3.5">
            <p className="text-xs font-semibold text-zinc-300">制作轨迹</p>
            <div className="mt-2 space-y-1.5 text-xs leading-relaxed text-zinc-400">
              <p>
                {state.scenes.length} 个场景 · {state.runtime.totalVideoGenerations} 次画面生成 ·{" "}
                {repairs.length > 0 ? (
                  <span>
                    <span className="text-amber-300">{repairs.length} 次自修复</span>，仅重做不合格场景
                  </span>
                ) : (
                  "一次通过，无需修复"
                )}
              </p>
              {repairs.map(({ scene, record }) => (
                <p key={`${scene.id}-${record.attempt}`} className="text-zinc-500">
                  <span className="font-mono text-[10px]">{scene.id}</span> 修复：{record.previousScore ?? "—"} 分
                  <span className="mx-1 text-zinc-600">→</span>
                  <span className="font-medium text-emerald-300">{record.newScore ?? "…"} 分</span>
                  {record.outcome === "FALLBACK" && "（降级为素材库）"}
                </p>
              ))}
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
