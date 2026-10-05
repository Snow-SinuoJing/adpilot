"use client";

/** 首页 hero 的片场开机小剧场：AI 摄影师运镜、场记板开拍、收音杆、咖啡热气、REC。 */
export function SetScene({ className = "w-full max-w-[330px]" }: { className?: string }) {
  return (
    <svg className={`setscene block ${className}`} viewBox="0 0 320 240" aria-hidden="true">
      <text className="rec" x="16" y="26">● REC</text>
      <polygon points="176,150 306,98 306,196" fill="rgba(232,163,61,.10)" />
      <line x1="14" y1="212" x2="306" y2="212" stroke="var(--color-ink)" strokeWidth="2.5" strokeLinecap="round" />
      <g className="robot">
        <line x1="160" y1="185" x2="132" y2="212" stroke="var(--color-ink)" strokeWidth="3" strokeLinecap="round" />
        <line x1="160" y1="185" x2="188" y2="212" stroke="var(--color-ink)" strokeWidth="3" strokeLinecap="round" />
        <line x1="160" y1="185" x2="160" y2="212" stroke="var(--color-ink)" strokeWidth="3" strokeLinecap="round" />
        <rect x="149" y="177" width="22" height="10" rx="3" fill="var(--color-ink)" />
        <rect x="128" y="134" width="64" height="46" rx="9" fill="var(--color-ink)" />
        <rect x="135" y="141" width="50" height="32" rx="6" fill="var(--color-paper)" />
        <circle cx="160" cy="157" r="11" fill="none" stroke="var(--color-ink)" strokeWidth="2.5" />
        <circle className="pupil" cx="160" cy="157" r="5" fill="var(--color-orange)" />
        <rect x="158" y="118" width="14" height="9" rx="2" fill="var(--color-ink)" />
        <line x1="165" y1="110" x2="165" y2="118" stroke="var(--color-ink)" strokeWidth="2" />
        <circle className="rec" cx="165" cy="107" r="2.5" />
        <rect x="196" y="144" width="6" height="13" rx="2" fill="var(--color-ink)" />
      </g>
      <g>
        <g className="arm2">
          <rect x="34" y="168" width="56" height="13" rx="2" fill="var(--color-ink)" />
          <path d="M44 168l9 13M58 168l9 13M72 168l9 13" stroke="var(--color-paper)" strokeWidth="4" />
        </g>
        <rect x="34" y="181" width="56" height="13" rx="2" fill="var(--color-ink)" />
        <path d="M44 181l9 13M58 181l9 13M72 181l9 13" stroke="var(--color-paper)" strokeWidth="4" />
      </g>
      <g className="mic">
        <line x1="292" y1="8" x2="262" y2="48" stroke="var(--color-ink)" strokeWidth="2.5" strokeLinecap="round" />
        <rect x="248" y="44" width="20" height="13" rx="6.5" fill="var(--color-ink)" transform="rotate(33 258 50)" />
      </g>
      <rect x="250" y="190" width="20" height="19" rx="2" fill="var(--color-paper)" stroke="var(--color-ink)" strokeWidth="2" />
      <path d="M270 194h5a4.5 4.5 0 0 1 0 9h-5" fill="none" stroke="var(--color-ink)" strokeWidth="2" />
      <g className="steam">
        <path d="M256 184c-2-3 2-5 0-9" fill="none" stroke="var(--color-grey)" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M264 184c-2-3 2-5 0-9" fill="none" stroke="var(--color-grey)" strokeWidth="1.8" strokeLinecap="round" />
      </g>
    </svg>
  );
}
