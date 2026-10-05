"use client";

import { useEffect, useRef, useState } from "react";
import type { RuntimeEvent } from "@/lib/state/schema";
import { ACTOR_ZH } from "@/lib/i18n";

/**
 * 只展示可审计事件——绝不展示隐藏思维链（设计原则 P6）。
 * 完成态默认折叠为一条摘要，完整日志按需展开。
 */
export function AgentActivity({
  events,
  autoCollapse = false,
}: {
  events: RuntimeEvent[];
  autoCollapse?: boolean;
}) {
  const [expanded, setExpanded] = useState(!autoCollapse);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (expanded) bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [events.length, expanded]);

  if (!expanded) {
    return (
      <div>
        <p className="text-xs leading-relaxed text-zinc-500">
          运行完成 · 共 {events.length} 条决策与执行记录
        </p>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-1.5 text-xs text-indigo-300 hover:underline"
        >
          展开完整日志
        </button>
      </div>
    );
  }

  return (
    <div>
      {autoCollapse && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="mb-2.5 text-xs text-zinc-500 hover:text-zinc-300"
        >
          收起日志 ▲
        </button>
      )}
      <div className="max-h-[68vh] space-y-3 overflow-y-auto pr-1">
        {events.length === 0 && (
          <p className="text-xs text-zinc-500">等待第一个智能体事件…</p>
        )}
        {events.map((event) => (
          <ActivityLine key={event.id} event={event} />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

const ACTOR_COLORS: Record<RuntimeEvent["actor"], string> = {
  DIRECTOR: "text-indigo-300",
  STRATEGY: "text-sky-300",
  ASSET: "text-cyan-300",
  CRITIC: "text-violet-300",
  TOOL: "text-amber-300",
  SYSTEM: "text-zinc-400",
};

/** 绿色只留给"成功/就绪"状态，角色名不与其争用。 */

function ActivityLine({ event }: { event: RuntimeEvent }) {
  const clock = event.timestamp.slice(11, 19);
  // 纯 API 路径的 detail 对用户是噪音（成片位置已由交付带表达）
  const detail = event.detail && !/^\/api\//.test(event.detail.trim()) ? event.detail : null;
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
      {detail && <p className="mt-0.5 line-clamp-3 text-[11px] text-zinc-500">{detail}</p>}
    </div>
  );
}
