"use client";

/** 成片空态：胶片倒计时片头——正片开演前数 3、2、1。 */
export function FilmLeader({ label }: { label?: string }) {
  return (
    <div className="leader absolute inset-0" aria-label={label ?? "等待成片合成"}>
      <span className="cross-h" />
      <span className="cross-v" />
      <div className="ring">
        <span className="sweep" />
        <span className="n n3">3</span>
        <span className="n n2">2</span>
        <span className="n n1">1</span>
      </div>
      {label && (
        <span className="absolute bottom-3 left-0 right-0 text-center font-mono text-[10px] tracking-[0.3em] text-cream/60">
          {label}
        </span>
      )}
    </div>
  );
}
