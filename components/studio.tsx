"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { requestStopRefresh } from "./stop-helper";
import Link from "next/link";
import type { ProjectState, RuntimeEvent } from "@/lib/state/schema";
import { PROJECT_STATUS_ZH, ERROR_CATEGORY_ZH, marketLabel } from "@/lib/i18n";
import { AgentActivity } from "./agent-activity";
import { FinalVideo } from "./final-video";
import { ScenePoster } from "./scene-poster";
import { BrandBar } from "./brand-bar";
import { CrewRoster } from "./crew";
import { IconStop } from "./icons";

const RUNNING = new Set(["PLANNING", "EXECUTING", "EVALUATING", "REPAIRING", "COMPOSING"]);

/**
 * 项目页：一条从提案桌到放映厅的滚动叙事（设计文档 §14 的三幕版）。
 * 第一幕 提案 → 第二幕 片场实录（智能体场记 + 自修复时刻）→ 灯暗 → 第三幕 放映室。
 * 数据流不变：SSE 事件驱动刷新，状态接口告知"变成了什么"。
 */
export function Studio({ projectId, autostart }: { projectId: string; autostart: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<ProjectState | null>(null);
  const [events, setEvents] = useState<RuntimeEvent[]>([]);
  const [notFound, setNotFound] = useState(false);
  const started = useRef(false);

  const canStop =
    state !== null &&
    state.status !== "COMPLETED" &&
    state.status !== "FAILED" &&
    state.status !== "STOPPED" &&
    state.runtime.demoMode !== "replay";

  const onStop = useCallback(async () => {
    if (!confirm("确定停机？当前批次完成后终止，已完成的镜头与素材会保留。")) return;
    await fetch(`/api/projects/${projectId}/stop`, { method: "POST" });
    requestStopRefresh();
  }, [projectId]);

  const refreshState = useCallback(async () => {
    const response = await fetch(`/api/projects/${projectId}`);
    if (response.status === 404) {
      setNotFound(true);
      return;
    }
    const body = await response.json();
    setState(body.state as ProjectState);
  }, [projectId]);

  useEffect(() => {
    void refreshState();

    const source = new EventSource(`/api/projects/${projectId}/events`);
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as RuntimeEvent;
      setEvents((prev) => (prev.some((e) => e.id === event.id) ? prev : [...prev, event]));
      // 事件告诉我们"何时"变化；状态接口告诉我们"变成了什么"
      void refreshState();
    };
    source.onerror = () => {
      // SSE 断开（如开发服务器重启）：重拉状态保证界面一致
      void refreshState();
    };
    return () => source.close();
  }, [projectId, refreshState]);

  useEffect(() => {
    if (!autostart || started.current || !state) return;
    if (state.status !== "IDLE") return;
    started.current = true;
    void fetch(`/api/projects/${projectId}/run`, { method: "POST" });
  }, [autostart, state, projectId]);

  /** 引擎不支持终态原地重跑；把通告单带回首页预填，一键重新开机。 */
  const retryWithNewProject = useCallback(() => {
    if (!state) return;
    sessionStorage.setItem("adpilot:retryBrief", JSON.stringify(state.brief));
    router.push("/");
  }, [state, router]);

  if (notFound) {
    return (
      <div className="flex min-h-screen flex-col">
        <BrandBar current={null} />
        <div className="grid flex-1 place-items-center">
          <div className="text-center">
            <p className="text-lg font-black">项目不存在</p>
            <Link href="/" className="mt-2 inline-block text-sm text-orange hover:underline">
              ← 回到通告单
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="flex min-h-screen flex-col">
        <BrandBar current={null} />
        <div className="grid flex-1 place-items-center text-sm text-grey">剧组进场中…</div>
      </div>
    );
  }

  const landscape = state.brief.aspectRatio === "16:9";
  const scenes = [...state.scenes].sort((a, b) => a.order - b.order);
  const failedScenes = state.scenes.filter((s) => s.status === "FAILED").map((s) => s.id);
  const doneScenes = state.scenes.filter((s) => s.status === "READY").map((s) => s.id);
  const running = RUNNING.has(state.status);
  const repairs = state.scenes.flatMap((scene) =>
    scene.repairHistory.map((record) => ({ scene, record })),
  );
  const lastRepair = repairs[repairs.length - 1];

  return (
    <div className="flex min-h-screen flex-col">
      <BrandBar
        current={null}
        right={
          <>
            {state.runtime.demoMode === "replay" && (
              <span className="hidden border-[1.5px] border-amber bg-amber/10 px-2.5 py-1 font-mono text-[10px] tracking-[0.14em] text-[#9a6d1c] sm:inline-block">
                回放 · 真实运行录制
              </span>
            )}
            {canStop && (
              <button
                type="button"
                onClick={() => void onStop()}
                className="inline-flex items-center gap-1.5 border-[1.5px] border-[#c22b00] px-3 py-1.5 text-xs font-bold text-[#c22b00] transition-colors hover:bg-[#c22b00]/10"
                title="停机（当前批次完成后终止，已完成内容保留）"
              >
                <IconStop className="size-3" />
                停机
              </button>
            )}
          </>
        }
      />

      {/* NG 通告：失败就地给出原因与出路 */}
      {state.error && (
        <section className="border-b-2 border-[#c22b00] bg-[#c22b00]/10 px-5 py-4 md:px-10">
          <div className="mx-auto flex max-w-6xl flex-wrap items-start justify-between gap-x-8 gap-y-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2.5 text-sm font-black text-[#c22b00]">
                <span className="border-2 border-[#c22b00] px-1.5 py-0.5 font-mono text-[11px] tracking-[0.2em]">NG</span>
                本场中止 · {ERROR_CATEGORY_ZH[state.error.category] ?? state.error.category}
              </p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-[#7a1f00]">{state.error.message}</p>
              {(failedScenes.length > 0 || doneScenes.length > 0) && (
                <p className="mt-1.5 text-xs text-[#5c554a]">
                  {failedScenes.length > 0 && (
                    <span>
                      受影响镜头：<b className="text-[#c22b00]">{failedScenes.join("、")}</b>
                    </span>
                  )}
                  {failedScenes.length > 0 && doneScenes.length > 0 && " · "}
                  {doneScenes.length > 0 && <span>{doneScenes.join("、")} 已完成并保留</span>}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={retryWithNewProject}
              className="shrink-0 bg-[#c22b00] px-5 py-2.5 text-xs font-black tracking-[0.16em] text-paper transition-colors hover:bg-[#a32400]"
            >
              复制通告单，重新开机
            </button>
          </div>
        </section>
      )}

      {/* ═══ 第一幕 · 提案 ═══ */}
      <section className="border-b-[3px] border-ink">
        <div className="mx-auto max-w-6xl px-5 md:px-10">
          <div className="grid grid-cols-[1fr_auto] items-end gap-6 border-b-[3px] border-ink py-8 md:py-10">
            <div className="min-w-0">
              <p className="mb-3 font-mono text-[11px] tracking-[0.22em] text-grey">
                ADPILOT 广告提案 · <b className="text-ink">{marketLabel(state.brief.market)}</b>市场 ·{" "}
                {state.brief.platform} · {landscape ? "横屏 16:9" : "竖屏 9:16"} · {state.brief.durationSec} 秒 · 三幕叙事
              </p>
              <h1 className="break-words text-4xl font-black leading-[1.02] md:text-6xl">
                {state.brief.productName}
              </h1>
            </div>
            <div className="pb-1 text-right">
              <p className="font-mono text-[10px] tracking-[0.3em] text-grey">CUT · {state.runtime.startedAt?.slice(5, 10) ?? "--"}</p>
              {state.status === "COMPLETED" && (
                <span className="stamp stamp-ink mt-2 !rotate-[-3deg] text-base">
                  已交付<small className="mt-0.5">DELIVERED</small>
                </span>
              )}
              {state.status === "FAILED" && (
                <span className="stamp mt-2 !rotate-[-3deg] text-base">
                  NG<small className="mt-0.5">未过审</small>
                </span>
              )}
              {state.status === "STOPPED" && (
                <span className="stamp stamp-ink mt-2 !rotate-[-3deg] text-base">
                  已停机<small className="mt-0.5">STOPPED</small>
                </span>
              )}
              {running && (
                <span className="mt-2 inline-block animate-pulse border-[1.5px] border-orange px-2.5 py-1 text-[11px] font-black tracking-[0.2em] text-orange">
                  拍摄中 · {PROJECT_STATUS_ZH[state.status]}
                </span>
              )}
              {state.status === "IDLE" && (
                <span className="mt-2 inline-block border-[1.5px] border-ink/40 px-2.5 py-1 text-[11px] font-black tracking-[0.2em] text-grey">
                  待开机
                </span>
              )}
            </div>
          </div>

          <div className="grid gap-8 py-8 lg:grid-cols-[300px_repeat(3,1fr)]">
            <aside className="flex flex-col border-b-[3px] border-ink pb-6 lg:border-b-0 lg:border-r-[3px] lg:pr-6 lg:pb-0">
              <h2 className="mb-4 text-xs font-extrabold tracking-[0.34em] text-orange">本场通告 BRIEF</h2>
              <dl className="space-y-3 text-[13px] leading-[1.5]">
                {[
                  ["产品", state.brief.productName],
                  ["市场 / 受众", `${marketLabel(state.brief.market)} · ${state.brief.audience}`],
                  ["画幅 / 时长", `${landscape ? "横屏 16:9" : "竖屏 9:16"} · ${state.brief.durationSec} 秒`],
                  ["创意要求", state.brief.additionalRequirement || "—"],
                ].map(([k, v]) => (
                  <div key={k} className="border-b border-ink/15 pb-2.5">
                    <dt className="mb-1 text-[10px] tracking-[0.26em] text-grey">{k}</dt>
                    <dd className="font-bold">{v}</dd>
                  </div>
                ))}
              </dl>
              {state.strategy && (
                <p className="mt-auto pt-6 text-[13px] leading-[1.85] text-[#4a443b]">
                  创意概念：<b className="text-orange">「{state.strategy.concept.split("——")[0].replace(/[「」]/g, "")}」</b>
                  {state.strategy.concept.split("——")[1] && `——${state.strategy.concept.split("——")[1]}`}
                </p>
              )}
            </aside>

            {scenes.length === 0 ? (
              <div className="grid place-items-center border-2 border-dashed border-ink/30 py-20 text-sm text-grey lg:col-span-3">
                {state.status === "IDLE" ? "剧组待命，提交通告单后立即开机…" : "编剧正在定调三幕叙事…"}
              </div>
            ) : (
              scenes.map((scene, i) => (
                <ScenePoster key={scene.id} scene={scene} index={i} landscape={landscape} />
              ))
            )}
          </div>
        </div>
      </section>

      {/* ═══ 第二幕 · 片场实录 ═══ */}
      <section className="relative overflow-hidden py-12 md:py-14">
        <div className="mx-auto max-w-6xl px-5 md:px-10">
          <div className="grid items-end gap-6 md:grid-cols-[1fr_400px_120px]">
            <div>
              <p className="mb-3 font-mono text-[11px] tracking-[0.34em] text-orange">PRODUCTION LOG · 场记</p>
              <h2 className="text-3xl font-black leading-[1.05] md:text-[44px]">
                这支广告，
                <br className="hidden md:block" />
                是<em className="not-italic text-orange">这么拍出来的</em>
              </h2>
            </div>
            <p className="text-[13px] leading-[1.9] text-[#5c554a]">
              剧组每一步判断都有场记：<b className="text-ink">何时决策、何时转 AI 生成、何时只重拍不合格的那一幕</b>——全程留档，随时回看。
            </p>
            <div className="clap w-[110px] justify-self-end">
              <div className="arm"><i /><i /><i /></div>
              <div className="base"><i /><i /><i /></div>
              <p className="mt-1.5 text-center font-mono text-[9px] tracking-[0.3em] text-grey">
                {running ? "SHOOTING" : "CUT"} · <b className="font-normal text-orange">ACTION</b>
              </p>
            </div>
          </div>

          <CrewRoster className="mt-7" />

          <div className="mt-2">
            <AgentActivity events={events} autoCollapse={state.status === "COMPLETED"} />
          </div>

          {lastRepair && (
            <div className="mx-auto mt-9 max-w-[560px] bg-ink p-6 text-cream md:p-7">
              <p className="mb-3 font-mono text-[10px] tracking-[0.32em] text-amber">SELF-REPAIR · 自修复时刻</p>
              <h3 className="mb-4 text-xl font-black tracking-[0.03em]">
                不合格的镜头被当场打回，好的那版当场盖上章
              </h3>
              <div className="flex flex-wrap items-center gap-x-7 gap-y-4">
                <div className="score-old">
                  {lastRepair.record.previousScore}
                  <span>首版 · 打回</span>
                </div>
                <span className="font-mono text-lg text-dimroom">———→</span>
                <div className="score-new">
                  {lastRepair.record.newScore ?? lastRepair.scene.qa?.score ?? "…"}
                  <span>重拍 · 通过</span>
                </div>
                <p className="text-xs leading-[1.8] text-dimroom">
                  审片员逐帧质检，<b className="text-cream">只重拍不合格的那一个镜头</b>——
                  <br />
                  其余已通过的镜头一帧不动，不重复花钱、不重复等待。
                </p>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ═══ 灯暗 ═══ */}
      <div className="lightsdown" aria-hidden="true">
        <div className="lamp">
          <div className="mx-auto h-14 w-0.5 bg-[#1c1815]" />
          <div className="bulb" />
        </div>
        <p className="absolute bottom-4 left-0 right-0 text-center font-mono text-[10px] tracking-[0.4em] text-amber/80">
          LIGHTS DOWN · 请入座 · 成片即将开始
        </p>
      </div>

      {/* ═══ 第三幕 · 放映室 ═══ */}
      <FinalVideo state={state} />
    </div>
  );
}
