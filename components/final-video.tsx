"use client";

import type { ProjectState } from "@/lib/state/schema";
import { FilmLeader } from "./film-leader";
import { LANGUAGE_ZH } from "@/lib/i18n";
import { IconDownload } from "./icons";

/**
 * 放映室（第三幕）：成片在此首映——四角片框大画面 + 下载成片 + 制作轨迹。
 * 成片未就绪时整块画面是胶片倒计时片头。
 */
export function FinalVideo({ state }: { state: ProjectState }) {
  const landscape = state.brief.aspectRatio === "16:9";
  const ready = Boolean(state.finalVideoUrl);
  const repairs = state.scenes.flatMap((scene) =>
    scene.repairHistory.map((record) => ({ scene, record })),
  );

  return (
    <section className="bg-room px-5 pb-14 text-cream md:px-10">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-8 py-10 lg:flex-row lg:items-start lg:gap-14">
        <figure
          className={`filmframe relative shrink-0 overflow-hidden bg-black shadow-[0_0_90px_rgba(232,163,61,.14),0_30px_80px_rgba(0,0,0,.7)] ${
            landscape ? "aspect-video w-[min(560px,88vw)]" : "aspect-[9/16] w-[min(300px,58vw)]"
          }`}
        >
          {ready ? (
            <video
              key={state.finalVideoUrl}
              src={`${state.finalVideoUrl}#t=0.5`}
              className="size-full object-cover"
              controls
              playsInline
              preload="metadata"
            />
          ) : (
            <FilmLeader
              label={
                state.status === "COMPOSING"
                  ? "正在合成最终成片…"
                  : state.status === "FAILED"
                    ? "本场未产出成片"
                    : "所有镜头通过质检后自动合成"
              }
            />
          )}
          <span className="corner"><i /></span>
          {ready && (
            <span className="absolute bottom-2.5 left-3 font-mono text-[10px] tracking-[0.18em] text-cream/75 [text-shadow:0_1px_4px_#000]">
              {state.brief.durationSec} 秒 · {landscape ? "竖屏 16:9" : "竖屏 9:16"} · 已通过质检
            </span>
          )}
        </figure>

        <div className="max-w-[430px]">
          <p className="mb-4 font-mono text-[11px] tracking-[0.34em] text-amber">PREMIERE · 放映室</p>
          <h2 className="text-4xl font-black leading-[1.14] tracking-[0.01em] md:text-5xl">
            {state.brief.productName}
          </h2>
          {state.strategy && (
            <p className="mt-4 text-sm leading-[1.9] text-dimroom">
              {state.strategy.concept}
            </p>
          )}

          <dl className="mt-6 flex flex-wrap gap-x-7 gap-y-3 text-xs tracking-[0.04em] text-dimroom">
            <div>
              <dt className="mb-1">时长</dt>
              <dd className="text-sm font-semibold text-cream">{state.brief.durationSec} 秒</dd>
            </div>
            <div>
              <dt className="mb-1">画幅</dt>
              <dd className="text-sm font-semibold text-cream">{landscape ? "横屏 16:9" : "竖屏 9:16"}</dd>
            </div>
            <div>
              <dt className="mb-1">配音</dt>
              <dd className="text-sm font-semibold text-cream">{LANGUAGE_ZH[state.brief.language ?? "zh"] ?? "中文普通话"}</dd>
            </div>
          </dl>

          <div className="mt-8 flex flex-wrap items-center gap-4">
            {ready ? (
              <a
                href={state.finalVideoUrl}
                download={`${state.brief.productName.toLowerCase().replace(/\s+/g, "-")}.mp4`}
                className="inline-flex items-center gap-2 bg-amber px-8 py-3.5 text-sm font-extrabold tracking-[0.2em] text-room transition-transform hover:-translate-y-px hover:shadow-[0_6px_26px_rgba(232,163,61,.4)]"
              >
                <IconDownload className="size-4" />
                下载成片 · MP4
              </a>
            ) : (
              <span className={`text-sm text-dimroom ${state.status === "COMPOSING" ? "animate-pulse" : ""}`}>
                {state.status === "COMPOSING"
                  ? "正在合成最终成片…"
                  : state.status === "FAILED"
                    ? "本场未产出成片——按上方指引重新开机即可。"
                    : "每个镜头通过质检后自动拼接、配音、混音。"}
              </span>
            )}
          </div>

          <div className="mt-8 border border-lineroom bg-room2 p-4">
            <p className="text-xs font-bold tracking-[0.2em] text-cream">制作轨迹</p>
            <div className="mt-2 space-y-1.5 text-xs leading-[1.9] text-dimroom">
              <p>
                {state.scenes.length} 个镜头 · {state.runtime.totalVideoGenerations} 次画面生成 ·{" "}
                {repairs.length > 0 ? (
                  <span>
                    <span className="text-amber">{repairs.length} 次自修复</span>，仅重拍不合格镜头
                  </span>
                ) : (
                  "一次通过，无需重拍"
                )}
              </p>
              {repairs.map(({ scene, record }) => (
                <p key={`${scene.id}-${record.attempt}`} className="text-dimroom/80">
                  <span className="font-mono text-[10px]">{scene.id}</span> 重拍：{record.previousScore ?? "—"} 分
                  <span className="mx-1 text-dimroom/50">→</span>
                  <span className="font-semibold text-amber">{record.newScore ?? "…"} 分</span>
                  {record.outcome === "FALLBACK" && "（降级为道具间）"}
                </p>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
