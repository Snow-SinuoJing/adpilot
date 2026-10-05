"use client";

import type { ProjectState } from "@/lib/state/schema";

export function FinalVideo({ state }: { state: ProjectState }) {
  const landscape = state.brief.aspectRatio === "16:9";
  return (
    <footer className="border-t border-zinc-800 px-4 py-3">
      <div className="flex items-center gap-5">
        <div className={landscape ? "w-72 shrink-0" : "w-40 shrink-0"}>
          <video
            key={state.finalVideoUrl}
            src={state.finalVideoUrl}
            className={`${landscape ? "aspect-video w-72" : "aspect-[9/16] w-40"} rounded-xl border border-zinc-800 bg-black object-cover`}
            controls
            playsInline
            preload={state.finalVideoUrl ? "metadata" : "none"}
          />
        </div>
        <div className="space-y-1">
          <h2 className="text-sm font-semibold text-zinc-300">最终成片</h2>
          {state.finalVideoUrl ? (
            <>
              <p className="text-xs text-emerald-400">
                已就绪 — {state.brief.durationSec} 秒{landscape ? "横版" : "竖版"} MP4
              </p>
              <a
                href={state.finalVideoUrl}
                download={`${state.brief.productName.toLowerCase().replace(/\s+/g, "-")}.mp4`}
                className="inline-block rounded-lg border border-zinc-700 px-3 py-1 text-xs text-zinc-300 hover:border-zinc-500"
              >
                下载 MP4
              </a>
            </>
          ) : (
            <p className="text-xs text-zinc-500">
              {state.status === "COMPOSING"
                ? "正在合成最终 MP4…"
                : state.status === "FAILED"
                  ? "运行失败——详见左侧简报面板的错误信息"
                  : "所有场景通过质检后自动合成"}
            </p>
          )}
        </div>
      </div>
    </footer>
  );
}
