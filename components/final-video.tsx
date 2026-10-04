"use client";

import type { ProjectState } from "@/lib/state/schema";

export function FinalVideo({ state }: { state: ProjectState }) {
  return (
    <footer className="border-t border-zinc-800 px-4 py-3">
      <div className="flex items-center gap-5">
        <div className="w-40 shrink-0">
          <video
            key={state.finalVideoUrl}
            src={state.finalVideoUrl}
            className="aspect-[9/16] w-40 rounded-xl border border-zinc-800 bg-black object-cover"
            controls
            playsInline
            preload={state.finalVideoUrl ? "metadata" : "none"}
          />
        </div>
        <div className="space-y-1">
          <h2 className="text-sm font-semibold text-zinc-300">Final Video</h2>
          {state.finalVideoUrl ? (
            <>
              <p className="text-xs text-emerald-400">Ready — {state.brief.durationSec}s vertical MP4</p>
              <a
                href={state.finalVideoUrl}
                download={`${state.brief.productName.toLowerCase().replace(/\s+/g, "-")}.mp4`}
                className="inline-block rounded-lg border border-zinc-700 px-3 py-1 text-xs text-zinc-300 hover:border-zinc-500"
              >
                Download MP4
              </a>
            </>
          ) : (
            <p className="text-xs text-zinc-500">
              {state.status === "COMPOSING"
                ? "Composing final MP4…"
                : state.status === "FAILED"
                  ? "Run failed — see error in Brief panel"
                  : "Composed automatically once all scenes pass QA"}
            </p>
          )}
        </div>
      </div>
    </footer>
  );
}
