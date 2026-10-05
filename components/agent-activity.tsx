"use client";

import { useEffect, useRef, useState } from "react";
import type { RuntimeEvent } from "@/lib/state/schema";
import { ACTOR_ZH } from "@/lib/i18n";
import { ActorCharacter } from "./crew";

/**
 * 片场实录：可审计事件沿胶片齿孔脊线左右交错（设计原则 P6——绝不展示隐藏思维链）。
 * 完成态默认折叠为一条摘要，完整场记按需展开。
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
      <div className="border border-ink/20 bg-white/50 px-5 py-4">
        <p className="text-[13px] leading-relaxed text-[#5c554a]">
          本场拍摄完成 · 共 <b className="text-ink">{events.length}</b> 条场记（决策与执行全记录）
        </p>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-1.5 text-xs font-bold text-orange underline decoration-orange underline-offset-4 hover:no-underline"
        >
          展开完整场记
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
          className="mb-3 text-xs text-grey hover:text-ink"
        >
          收起场记 ▲
        </button>
      )}
      <div className="max-h-[70vh] overflow-y-auto pr-1">
        <div className="logspine">
          {events.length === 0 && (
            <p className="py-6 text-center text-xs text-grey">等待剧组进场…提交通告单后立即开机。</p>
          )}
          {events.map((event) => (
            <LogLine key={event.id} event={event} />
          ))}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}

function LogLine({ event }: { event: RuntimeEvent }) {
  const clock = event.timestamp.slice(11, 19);
  const hot = event.type === "ERROR" || /失败|不合格|重做|修复/.test(event.title);
  // 纯 API 路径的 detail 对用户是噪音（成片位置已由放映室表达）
  const detail = event.detail && !/^\/api\//.test(event.detail.trim()) ? event.detail : null;

  return (
    <div className={`logev ${hot ? "hot" : ""}`}>
      <span className="mb-1.5 inline-flex items-center gap-2">
        <ActorCharacter actor={event.actor} className="!size-[17px] text-ink" />
        <b className="text-[11px] font-extrabold tracking-[0.22em]">{ACTOR_ZH[event.actor]}</b>
        <i className="font-mono text-[10px] not-italic tracking-[0.1em] text-grey">{clock}</i>
      </span>
      <p className="text-[13.5px] leading-[1.65]">
        {event.sceneId && <span className="mr-1.5 font-mono text-[10px] text-grey">{event.sceneId}</span>}
        {event.title}
        {detail && <small className="mt-0.5 block text-[11px] leading-relaxed text-grey">{detail}</small>}
      </p>
    </div>
  );
}
