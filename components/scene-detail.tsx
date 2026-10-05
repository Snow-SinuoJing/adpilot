"use client";

import type { SceneState } from "@/lib/state/schema";
import { DIMENSION_ZH } from "@/lib/i18n";

/** 展开后的场记详情：画面意图、来源理由、生成提示词、评审问题、修复历史（设计文档 §14.2）。 */
export function SceneDetail({ scene, landscape = false }: { scene: SceneState; landscape?: boolean }) {
  return (
    <div className="space-y-3 text-[11.5px] leading-relaxed">
      <Block label="画面意图">{scene.visualIntent}</Block>
      {scene.voiceover && (
        <Block label="口播文案">
          &ldquo;{scene.voiceover}&rdquo;
          {scene.audioUrl && (
            <audio src={scene.audioUrl} controls className="mt-1.5 h-7 w-full" preload="none" />
          )}
        </Block>
      )}
      {scene.sourceReason && (
        <Block label="为什么用这个来源">
          <span className="text-ink">{scene.sourceReason}</span>
        </Block>
      )}
      {scene.generationPrompt && (
        <Block label="生成提示词">
          <pre className="whitespace-pre-wrap rounded border border-ink/15 bg-white/50 p-2 font-mono text-[10px] text-[#5c554a]">
            {scene.generationPrompt}
          </pre>
        </Block>
      )}
      {scene.qa && (
        <Block label={`审片 — ${scene.qa.score}/100（${scene.qa.decision === "PASS" ? "通过" : "需重拍"}）`}>
          <div className="mt-1 grid grid-cols-5 gap-1">
            {Object.entries(scene.qa.dimensions).map(([dimension, value]) => (
              <div key={dimension} className="border border-ink/15 bg-white/50 px-1 py-1 text-center">
                <p className="truncate text-[8px] text-grey" title={DIMENSION_ZH[dimension] ?? dimension}>
                  {DIMENSION_ZH[dimension] ?? dimension}
                </p>
                <p className="text-[11px] font-bold">{value}</p>
              </div>
            ))}
          </div>
          {scene.qa.issues.length > 0 && (
            <ul className="mt-1.5 space-y-1">
              {scene.qa.issues.map((issue, i) => (
                <li key={i} className={issue.severity === "high" ? "text-[#c22b00]" : "text-[#5c554a]"}>
                  [{issue.severity === "high" ? "严重" : issue.severity === "medium" ? "中等" : "轻微"}] {issue.description}
                </li>
              ))}
            </ul>
          )}
        </Block>
      )}
      {scene.repairHistory.length > 0 && (
        <Block label="重拍版本对比">
          <div className="space-y-2">
            {scene.repairHistory.map((record) => (
              <div key={record.attempt} className="border border-ink/15 bg-white/50 p-2">
                <p className="mb-1.5 text-[11px] font-extrabold tracking-[0.1em] text-orange">
                  第 {record.attempt} 次重拍 · {record.previousScore} 分
                  <span className="mx-1 text-grey">→</span>
                  {record.newScore ?? "…"} 分（
                  {record.outcome === "IMPROVED" ? "改善" : record.outcome === "NO_IMPROVEMENT" ? "无改善" : record.outcome === "FALLBACK" ? "降级" : "进行中"}）
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <p className="mb-1 text-[10px] font-extrabold text-[#c22b00]">重拍前（被打回的版本）</p>
                    {record.previousVideoUrl ? (
                      <video
                        src={record.previousVideoUrl}
                        className={`${landscape ? "aspect-video" : "aspect-[9/16]"} w-full border border-ink/20 bg-black object-cover`}
                        controls
                        muted
                        playsInline
                        preload="metadata"
                      />
                    ) : (
                      <p className="text-[10px] text-grey">（旧数据未保留第一版视频）</p>
                    )}
                    {record.issues && record.issues.length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {record.issues.map((issue, i) => (
                          <li key={i} className={issue.severity === "high" ? "text-[10px] text-[#c22b00]" : "text-[10px] text-[#5c554a]"}>
                            [{issue.severity === "high" ? "严重" : issue.severity === "medium" ? "中等" : "轻微"}] {issue.description}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div>
                    <p className="mb-1 text-[10px] font-extrabold text-[#2e6b46]">重拍后（当前版本）</p>
                    {scene.videoUrl ? (
                      <video
                        src={scene.videoUrl}
                        className={`${landscape ? "aspect-video" : "aspect-[9/16]"} w-full border border-ink/20 bg-black object-cover`}
                        controls
                        muted
                        playsInline
                        preload="metadata"
                      />
                    ) : (
                      <p className="text-[10px] text-grey">（重新生成中…）</p>
                    )}
                    <p className="mt-1 border border-ink/15 bg-white/60 p-1.5 text-[10px] leading-relaxed text-[#5c554a]">
                      <span className="font-extrabold text-orange">重拍动作（提示词增量）：</span>
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
      <p className="mb-0.5 font-mono text-[9px] font-medium uppercase tracking-[0.24em] text-grey">{label}</p>
      <div className="text-[#4a443b]">{children}</div>
    </div>
  );
}
