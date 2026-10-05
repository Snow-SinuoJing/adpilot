"use client";

import type { RuntimeActor } from "@/lib/state/schema";
import { ACTOR_ZH } from "@/lib/i18n";

/** 剧组小角色：六个手绘线稿小人，各带待机动画（CSS 见 globals.css）。 */

function Eyes() {
  return (
    <g className="eyes">
      <circle cx="18" cy="26.5" r="1.7" fill="currentColor" />
      <circle cx="26.5" cy="26.5" r="1.7" fill="currentColor" />
    </g>
  );
}

/** 导演：橙色贝雷帽 + 手持喇叭，头与喇叭同步挥动。 */
export function CharacterDirector({ className = "size-11" }: { className?: string }) {
  return (
    <svg className={`ch ch-dir ${className}`} viewBox="0 0 48 48" aria-hidden="true">
      <g className="head" stroke="currentColor" fill="none">
        <circle cx="22" cy="27" r="12" fill="var(--color-paper)" strokeWidth="2" />
        <path d="M10.5 20.5c1.5-6.5 8-9.5 14-8.5 4.5.8 7.5 3 8.8 5.8-6.5-2.2-16.3-1.8-22.8 2.7z" fill="var(--color-orange)" strokeWidth="2" strokeLinejoin="round" />
        <circle cx="24" cy="9.5" r="1.6" fill="currentColor" stroke="none" />
        <Eyes />
        <path d="M19.5 32.5c1.4 1.1 3.6 1.1 5 0" strokeWidth="2" strokeLinecap="round" />
      </g>
      <g className="mega" stroke="currentColor">
        <path d="M35 24.5 45 20v13l-10-4.5z" fill="var(--color-amber)" strokeWidth="2" strokeLinejoin="round" />
        <path d="M35 24.5v4" strokeWidth="2" />
      </g>
    </svg>
  );
}

/** 编剧：圆眼镜，底下的台词线不断写出来。 */
export function CharacterWriter({ className = "size-11" }: { className?: string }) {
  return (
    <svg className={`ch ch-wri ${className}`} viewBox="0 0 48 48" aria-hidden="true">
      <g className="head" stroke="currentColor" fill="none">
        <circle cx="23" cy="27" r="12" fill="var(--color-paper)" strokeWidth="2" />
        <path d="M13 21c1-4.5 5-7.5 10-7.5 3 0 5.5 1 7.5 2.7-3.4-.9-6.3-.8-8.7.2 2.8.2 5.4 1.2 7.4 3-5.5-2-11.8-1.4-16.2 1.6z" fill="currentColor" />
        <circle cx="18.5" cy="27" r="1.7" fill="currentColor" stroke="none" />
        <circle cx="27.5" cy="27" r="1.7" fill="currentColor" stroke="none" />
        <circle cx="18.5" cy="27" r="4.2" strokeWidth="1.5" />
        <circle cx="27.5" cy="27" r="4.2" strokeWidth="1.5" />
        <path d="M20.5 33.5c1.3 1 3.2 1 4.5 0" strokeWidth="2" strokeLinecap="round" />
      </g>
      <path className="scrib" d="M8 42c3-2.5 5 2.5 8 0s5 2.5 8 0 5 2.5 8 0" fill="none" stroke="var(--color-orange)" strokeWidth="2" strokeLinecap="round" />
      <path d="M40 33l4.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** 道具师：鸭舌帽，放大镜左右扫视。 */
export function CharacterPropMaster({ className = "size-11" }: { className?: string }) {
  return (
    <svg className={`ch ch-prop ${className}`} viewBox="0 0 48 48" aria-hidden="true">
      <g className="head" stroke="currentColor" fill="none">
        <circle cx="21" cy="28" r="12" fill="var(--color-paper)" strokeWidth="2" />
        <path d="M9.5 20h23c-1-4.5-5.5-7-11.5-7s-10.5 2.5-11.5 7z" fill="currentColor" />
        <path d="M8 20.5h26" strokeWidth="2" strokeLinecap="round" />
        <circle cx="17" cy="27.5" r="1.7" fill="currentColor" stroke="none" />
        <circle cx="25.5" cy="27.5" r="1.7" fill="currentColor" stroke="none" />
        <path d="M18.5 33.5c1.3 1 3.2 1 4.5 0" strokeWidth="2" strokeLinecap="round" />
      </g>
      <g className="mag" stroke="currentColor">
        <circle cx="37" cy="28" r="5.5" fill="rgba(255,77,0,.16)" strokeWidth="2" />
        <line x1="41" y1="32" x2="46" y2="37" strokeWidth="2.5" strokeLinecap="round" />
      </g>
    </svg>
  );
}

/** 审片员：印章周期性盖下。 */
export function CharacterCritic({ className = "size-11" }: { className?: string }) {
  return (
    <svg className={`ch ch-aud ${className}`} viewBox="0 0 48 48" aria-hidden="true">
      <g className="head" stroke="currentColor" fill="none">
        <circle cx="20" cy="27" r="12" fill="var(--color-paper)" strokeWidth="2" />
        <path d="M10 18.5c2.5-3.5 6-5.5 10-5.5s7.5 2 10 5.5" strokeWidth="2" strokeLinecap="round" />
        <circle cx="16" cy="26.5" r="1.7" fill="currentColor" stroke="none" />
        <circle cx="24.5" cy="26.5" r="1.7" fill="currentColor" stroke="none" />
        <path d="M17.5 32.5c1.3 1 3.2 1 4.5 0" strokeWidth="2" strokeLinecap="round" />
      </g>
      <g className="stampP" stroke="currentColor">
        <rect x="37" y="16" width="8" height="5" rx="1.5" fill="var(--color-orange)" strokeWidth="2" />
        <path d="M39.5 21v4h3v-4" fill="var(--color-amber)" strokeWidth="2" />
        <rect x="35" y="25" width="12" height="4.5" rx="1" fill="var(--color-amber)" strokeWidth="2" />
        <path d="M33 34h16" strokeWidth="2" strokeLinecap="round" />
      </g>
    </svg>
  );
}

/** AI 摄影师：小机器人摄像机——剧组里唯一的非人类，一眼认出它是 AIGC。 */
export function CharacterAICam({ className = "size-11" }: { className?: string }) {
  return (
    <svg className={`ch ch-cam ${className}`} viewBox="0 0 48 48" aria-hidden="true">
      <g className="body">
        <line x1="24" y1="5" x2="24" y2="10" stroke="currentColor" strokeWidth="2" />
        <circle className="ant" cx="24" cy="4" r="2.2" fill="var(--color-orange)" />
        <rect x="20" y="9" width="8" height="5" rx="1.5" fill="currentColor" />
        <rect x="9" y="13" width="30" height="24" rx="7" fill="currentColor" />
        <rect x="13" y="17" width="22" height="16" rx="5" fill="var(--color-paper)" />
        <circle cx="24" cy="25" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
        <circle className="pupil" cx="24" cy="25" r="3" fill="var(--color-orange)" />
        <rect x="41" y="21" width="4" height="8" rx="1.5" fill="currentColor" />
      </g>
    </svg>
  );
}

/** 制片：耳麦，清单上逐项打勾。 */
export function CharacterProducer({ className = "size-11" }: { className?: string }) {
  return (
    <svg className={`ch ch-prod ${className}`} viewBox="0 0 48 48" aria-hidden="true">
      <g className="head" stroke="currentColor" fill="none">
        <circle cx="21" cy="27" r="12" fill="var(--color-paper)" strokeWidth="2" />
        <path d="M9.5 25c0-6.5 5-11.5 11.5-11.5S32.5 18.5 32.5 25" strokeWidth="2" strokeLinecap="round" />
        <rect x="8" y="24" width="5" height="8" rx="2" fill="currentColor" />
        <circle cx="18" cy="27" r="1.7" fill="currentColor" stroke="none" />
        <circle cx="26" cy="27" r="1.7" fill="currentColor" stroke="none" />
        <path d="M19.5 32.5c1.4 1.1 3.6 1.1 5 0" strokeWidth="2" strokeLinecap="round" />
      </g>
      <g stroke="currentColor">
        <rect x="34" y="24" width="11" height="16" rx="1.5" fill="var(--color-paper)" strokeWidth="2" />
        <path d="M37 28.5h6M37 32h6M37 35.5h4" strokeWidth="1.6" strokeLinecap="round" />
        <path className="chk" d="M36.5 31.8l1.4 1.4 2.6-3" fill="none" stroke="var(--color-orange)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

const ACTOR_CHARACTER: Record<RuntimeActor, (p: { className?: string }) => React.ReactNode> = {
  DIRECTOR: CharacterDirector,
  STRATEGY: CharacterWriter,
  ASSET: CharacterPropMaster,
  CRITIC: CharacterCritic,
  TOOL: CharacterAICam,
  SYSTEM: CharacterProducer,
};

/** 按事件演员取角色形象。 */
export function ActorCharacter({ actor, className }: { actor: RuntimeActor; className?: string }) {
  const Component = ACTOR_CHARACTER[actor] ?? CharacterProducer;
  return <Component className={className} />;
}

const CREW: Array<{ actor: RuntimeActor; role: string; en: string }> = [
  { actor: "DIRECTOR", role: "导演", en: "DIRECTOR" },
  { actor: "STRATEGY", role: "编剧", en: "STRATEGY" },
  { actor: "ASSET", role: "道具师", en: "ASSET" },
  { actor: "CRITIC", role: "审片员", en: "CRITIC" },
  { actor: "TOOL", role: "AI 摄影师", en: "TOOL · AIGC" },
  { actor: "SYSTEM", role: "制片", en: "SYSTEM" },
];

/** 场记区开头的剧组名牌条：六个角色一字排开；activeActor = 当前正在干活的成员，高亮加速。 */
export function CrewRoster({
  activeActor = null,
  className = "",
}: {
  activeActor?: RuntimeActor | null;
  className?: string;
}) {
  return (
    <div className={`crew flex flex-wrap items-center gap-3 ${className}`}>
      <span className="mr-1.5 font-mono text-[10px] tracking-[0.3em] text-grey">CREW · 本场剧组</span>
      {CREW.map(({ actor, role, en }) => {
        const Component = ACTOR_CHARACTER[actor];
        const working = actor === activeActor;
        return (
          <span
            key={actor}
            className={`m inline-flex items-center gap-2 rounded-full border border-ink/30 bg-white/50 py-1.5 pl-1.5 pr-3.5 ${working ? "working" : ""}`}
          >
            <span className="av">
              <Component className="size-6 text-ink" />
            </span>
            <span>
              <b className="block text-[11.5px] font-extrabold tracking-[0.08em]">{role}</b>
              <i className="block font-mono text-[8px] not-italic tracking-[0.12em] text-grey">{en}</i>
            </span>
            {working && <span className="onduty">干活中</span>}
          </span>
        );
      })}
    </div>
  );
}

export { ACTOR_ZH };
