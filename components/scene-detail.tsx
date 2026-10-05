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
        <Block label="修复版本对比">
          <div className="space-y-2">
            {scene.repairHistory.map((record) => (
              <div key={record.attempt} className="rounded-lg bg-zinc-800/70 p-2">
                <p className="mb-1.5 font-semibold text-amber-300">
                  第 {record.attempt} 次修复 · {record.previousScore} 分
                  <span className="mx-1 text-zinc-500">→</span>
                  {record.newScore ?? "…"} 分（
                  {record.outcome === "IMPROVED" ? "改善" : record.outcome === "NO_IMPROVEMENT" ? "无改善" : record.outcome === "FALLBACK" ? "降级" : "进行中"}）
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <p className="mb-1 text-[10px] font-bold text-red-300">修复前（被打回的版本）</p>
                    {record.previousVideoUrl ? (
                      <video
                        src={record.previousVideoUrl}
                        className="aspect-[9/16] w-full rounded bg-black object-cover"
                        controls
                        muted
                        playsInline
                        preload="metadata"
                      />
                    ) : (
                      <p className="text-[10px] text-zinc-500">（旧数据未保留第一版视频）</p>
                    )}
                    {record.issues && record.issues.length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {record.issues.map((issue, i) => (
                          <li key={i} className={issue.severity === "high" ? "text-[10px] text-red-300" : "text-[10px] text-zinc-400"}>
                            [{issue.severity === "high" ? "严重" : issue.severity === "medium" ? "中等" : "轻微"}] {issue.description}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div>
                    <p className="mb-1 text-[10px] font-bold text-emerald-300">修复后（当前版本）</p>
                    {scene.videoUrl ? (
                      <video
                        src={scene.videoUrl}
                        className="aspect-[9/16] w-full rounded bg-black object-cover"
                        controls
                        muted
                        playsInline
                        preload="metadata"
                      />
                    ) : (
                      <p className="text-[10px] text-zinc-500">（重新生成中…）</p>
                    )}
                    <p className="mt-1 rounded bg-zinc-900/80 p-1.5 text-[10px] leading-relaxed text-zinc-400">
                      <span className="font-bold text-amber-300">修复动作（提示词增量）：</span>
                      {record.promptDelta}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
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
