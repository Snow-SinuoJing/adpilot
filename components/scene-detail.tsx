"use client";

import type { SceneState } from "@/lib/state/schema";
import { DIMENSION_ZH } from "@/lib/i18n";

/** 展开后的场景详情：意图、来源理由、生成提示词、评审问题、修复历史（设计文档 §14.2）。 */
export function SceneDetail({ scene }: { scene: SceneState }) {
  return (
    <div className="space-y-3 border-t border-zinc-800 px-2.5 py-2.5 text-[11px] leading-relaxed">
      <Block label="画面意图">{scene.visualIntent}</Block>
      {scene.voiceover && (
        <Block label="口播文案">
          &ldquo;{scene.voiceover}&rdquo;
          {scene.audioUrl && (
            <audio src={scene.audioUrl} controls className="mt-1 h-7 w-full" preload="none" />
          )}
        </Block>
      )}
      {scene.sourceReason && (
        <Block label="为什么用这个来源">
          <span className="text-zinc-300">{scene.sourceReason}</span>
        </Block>
      )}
      {scene.generationPrompt && (
        <Block label="生成提示词">
          <pre className="whitespace-pre-wrap font-mono text-[10px] text-zinc-500">{scene.generationPrompt}</pre>
        </Block>
      )}
      {scene.qa && (
        <Block label={`评审 — ${scene.qa.score}/100（${scene.qa.decision === "PASS" ? "通过" : "需修复"}）`}>
          <div className="mt-1 grid grid-cols-5 gap-1">
            {Object.entries(scene.qa.dimensions).map(([dimension, value]) => (
              <div key={dimension} className="rounded bg-zinc-800/70 px-1 py-1 text-center">
                <p className="truncate text-[8px] text-zinc-500" title={DIMENSION_ZH[dimension] ?? dimension}>
                  {DIMENSION_ZH[dimension] ?? dimension}
                </p>
                <p className="text-[11px] font-semibold text-zinc-200">{value}</p>
              </div>
            ))}
          </div>
          {scene.qa.issues.length > 0 && (
            <ul className="mt-1.5 space-y-1">
              {scene.qa.issues.map((issue, i) => (
                <li key={i} className={issue.severity === "high" ? "text-red-300" : "text-zinc-400"}>
                  [{issue.severity === "high" ? "严重" : issue.severity === "medium" ? "中等" : "轻微"}] {issue.description}
                </li>
              ))}
            </ul>
          )}
        </Block>
      )}
      {scene.repairHistory.length > 0 && (
        <Block label="修复历史">
          <ul className="space-y-1">
            {scene.repairHistory.map((record) => (
              <li key={record.attempt} className="rounded bg-zinc-800/70 p-1.5">
                <p className="font-semibold text-amber-300">
                  第 {record.attempt} 次修复 · {record.previousScore} → {record.newScore ?? "…"}（
                  {record.outcome === "IMPROVED" ? "改善" : record.outcome === "NO_IMPROVEMENT" ? "无改善" : record.outcome === "FALLBACK" ? "降级" : "进行中"}）
                </p>
                <p className="text-zinc-400">提示词增量：{record.promptDelta}</p>
              </li>
            ))}
          </ul>
        </Block>
      )}
    </div>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[9px] font-bold uppercase tracking-wider text-zinc-600">{label}</p>
      <div className="mt-0.5 text-zinc-400">{children}</div>
    </div>
  );
}
