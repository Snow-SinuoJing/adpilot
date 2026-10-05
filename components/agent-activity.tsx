"use client";

import { useEffect, useRef } from "react";
import type { RuntimeEvent } from "@/lib/state/schema";
import { ACTOR_ZH } from "@/lib/i18n";

/** 只展示可审计事件——绝不展示隐藏思维链（设计原则 P6）。 */
export function AgentActivity({ events }: { events: RuntimeEvent[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [events.length]);

  return (
    <div className="max-h-[68vh] space-y-3 overflow-y-auto pr-1">
      {events.length === 0 && (
        <p className="text-xs text-zinc-500">等待第一个智能体事件…</p>
      )}
      {events.map((event) => (
        <ActivityLine key={event.id} event={event} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

const ACTOR_COLORS: Record<RuntimeEvent["actor"], string> = {
  DIRECTOR: "text-indigo-300",
  STRATEGY: "text-sky-300",
  ASSET: "text-teal-300",
  CRITIC: "text-violet-300",
  TOOL: "text-amber-300",
  SYSTEM: "text-zinc-400",
};

function ActivityLine({ event }: { event: RuntimeEvent }) {
  const clock = event.timestamp.slice(11, 19);
  return (
    <div className="border-l-2 border-zinc-800 pl-3 text-xs leading-relaxed">
      <p className="flex items-baseline gap-2">
        <span className="font-mono text-[10px] text-zinc-600">{clock}</span>
        <span className={`w-[36px] shrink-0 font-semibold ${ACTOR_COLORS[event.actor]}`}>
          {ACTOR_ZH[event.actor]}
        </span>
      </p>
      <p className="mt-0.5 text-zinc-200">
        {event.sceneId && <span className="mr-1 font-mono text-[10px] text-zinc-500">{event.sceneId}</span>}
        {event.title}
      </p>
      {event.detail && (
        <p className="mt-0.5 line-clamp-3 text-[11px] text-zinc-500">{event.detail}</p>
      )}
    </div>
  );
}
