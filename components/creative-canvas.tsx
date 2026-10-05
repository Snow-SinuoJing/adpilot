"use client";

import type { ProjectState } from "@/lib/state/schema";
import { SceneCard } from "./scene-card";

export function CreativeCanvas({ state }: { state: ProjectState }) {
  const scenes = [...state.scenes].sort((a, b) => a.order - b.order);

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-sm font-semibold text-zinc-300">创意画布</h2>
        {state.strategy && (
          <p className="max-w-[60%] truncate text-xs text-zinc-500" title={state.strategy.concept}>
            {state.strategy.concept}
          </p>
        )}
      </div>

      {scenes.length === 0 ? (
        <div className="grid flex-1 place-items-center rounded-2xl border border-dashed border-zinc-800 py-16 text-sm text-zinc-600">
          {state.status === "IDLE" ? "等待启动…" : "策略智能体正在规划场景…"}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {scenes.map((scene) => (
            <SceneCard key={scene.id} scene={scene} />
          ))}
        </div>
      )}
    </div>
  );
}
