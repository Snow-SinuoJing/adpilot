"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { AdBrief } from "@/lib/state/schema";
import { DEMO_BRIEF } from "@/lib/demo/demo-brief";
import { PROJECT_STATUS_ZH, marketLabel } from "@/lib/i18n";
import { BrandBar } from "./brand-bar";
import { SetScene } from "./set-scene";
import { CharacterPropMaster } from "./crew";
import { IconPlay } from "./icons";

const EMPTY_FORM = {
  productName: "",
  productDescription: "",
  market: "",
  audience: "",
  platform: "TikTok" as AdBrief["platform"],
  durationSec: 15 as AdBrief["durationSec"],
  aspectRatio: "9:16" as NonNullable<AdBrief["aspectRatio"]>,
  language: "zh" as NonNullable<AdBrief["language"]>,
  additionalRequirement: "",
};

const ACTIVE_STATUSES = new Set(["IDLE", "PLANNING", "EXECUTING", "EVALUATING", "REPAIRING", "COMPOSING"]);

interface HistoryItem {
  projectId: string;
  product?: string;
  market?: string;
  status?: string;
  createdAt?: string;
  hasFinal: boolean;
  demoMode?: string;
}

/** 首页：一张通告单开拍新广告 + 往期广告片档案墙。 */
export function BriefForm() {
  const router = useRouter();
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replays, setReplays] = useState<Array<{ name: string; product?: string }>>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [priorityIds, setPriorityIds] = useState<string[]>([]);
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  const [clipInputBusy, setClipInputBusy] = useState(false);
  const [referenceImage, setReferenceImage] = useState<string | null>(null);
  const [refBusy, setRefBusy] = useState(false);
  const [retryNote, setRetryNote] = useState<string | null>(null);
  const clipInput = useRef<HTMLInputElement>(null);
  const refInput = useRef<HTMLInputElement>(null);

  const uploadClips = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setClipInputBusy(true);
    setUploadNote("上传中，长素材会自动做镜头拆分与视觉描述…");
    try {
      const form = new FormData();
      for (const file of Array.from(files)) form.append("files", file);
      const response = await fetch("/api/assets/upload", { method: "POST", body: form });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "上传失败");
      setPriorityIds((prev) => [...prev, ...(body.added ?? [])].slice(-50));
      setUploadNote(`已上传 ${body.added.length} 个素材，正在解析…`);
    } catch (e) {
      setUploadNote(e instanceof Error ? e.message : String(e));
    } finally {
      setClipInputBusy(false);
      if (clipInput.current) clipInput.current.value = "";
    }
  };

  // 上传素材的解析状态轮询：解析完成前提示用户等待（用户反馈 #1）
  const [analysisStatus, setAnalysisStatus] = useState<Array<{ id: string; label: string; segs: number; pending: boolean }>>([]);
  useEffect(() => {
    if (priorityIds.length === 0) {
      setAnalysisStatus([]);
      return;
    }
    let alive = true;
    const poll = async () => {
      try {
        const response = await fetch("/api/assets");
        const body = await response.json();
        if (!alive) return;
        const assets: Array<{ id: string; description: string; analysis?: string; file?: string; parentFile?: string; durationSec?: number }> = body.assets ?? [];
        const status = priorityIds.map((id) => {
          const entry = assets.find((a) => a.id === id);
          const segs = entry ? assets.filter((a) => a.parentFile === entry.file).length : 0;
          return {
            id,
            label: (entry?.description ?? id).slice(0, 26),
            segs,
            pending: entry?.analysis === "pending" || (entry != null && entry.analysis !== "done" && (entry.durationSec ?? 0) > 12),
          };
        });
        setAnalysisStatus(status);
      } catch {
        /* 轮询失败忽略，下一轮再试 */
      }
    };
    void poll();
    const timer = setInterval(poll, 4000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [priorityIds]);

  const analysisPending = analysisStatus.some((s) => s.pending);

  const uploadReference = async (file: File | null) => {
    if (!file) return;
    setRefBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/upload/product-image", { method: "POST", body: form });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "上传失败");
      setReferenceImage(body.url);
    } catch (e) {
      setUploadNote(e instanceof Error ? e.message : String(e));
    } finally {
      setRefBusy(false);
      if (refInput.current) refInput.current.value = "";
    }
  };

  const refreshHistory = useCallback(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((body) => setHistory(body.projects ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/replay")
      .then((r) => r.json())
      .then((body) => setReplays(body.replays ?? []))
      .catch(() => {});
    refreshHistory();
  }, [refreshHistory]);

  // 有进行中的项目时自动刷新历史
  useEffect(() => {
    if (!history.some((h) => ACTIVE_STATUSES.has(h.status ?? ""))) return;
    const timer = setInterval(refreshHistory, 8000);
    return () => clearInterval(timer);
  }, [history, refreshHistory]);

  // 从工作台「复制通告单，重新开机」带回来的简报：直接预填
  useEffect(() => {
    const raw = sessionStorage.getItem("adpilot:retryBrief");
    if (!raw) return;
    sessionStorage.removeItem("adpilot:retryBrief");
    try {
      const brief = JSON.parse(raw) as Partial<AdBrief>;
      setForm((f) => ({
        ...f,
        productName: brief.productName ?? f.productName,
        productDescription: brief.productDescription ?? f.productDescription,
        market: brief.market ?? f.market,
        audience: brief.audience ?? f.audience,
        platform: brief.platform ?? f.platform,
        durationSec: brief.durationSec ?? f.durationSec,
        aspectRatio: brief.aspectRatio ?? f.aspectRatio,
        language: brief.language ?? f.language,
        additionalRequirement: brief.additionalRequirement ?? f.additionalRequirement,
      }));
      setRetryNote("已填入上一场的通告单，确认内容后重新开机即可。");
    } catch {
      /* 预填数据损坏时忽略，按空白表单使用 */
    }
  }, []);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const loadDemo = () => {
    setForm({
      productName: DEMO_BRIEF.productName,
      productDescription: DEMO_BRIEF.productDescription,
      market: DEMO_BRIEF.market,
      audience: DEMO_BRIEF.audience,
      platform: DEMO_BRIEF.platform,
      durationSec: DEMO_BRIEF.durationSec,
      aspectRatio: DEMO_BRIEF.aspectRatio ?? "9:16",
      language: DEMO_BRIEF.language ?? "zh",
      additionalRequirement: DEMO_BRIEF.additionalRequirement ?? "",
    });
    setError(null);
  };

  const submit = async () => {
    if (analysisPending && !confirm("部分素材还在解析中，现在生成可能检索不到它们的切片。确定继续吗？")) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const brief: AdBrief = {
        productName: form.productName.trim(),
        productDescription: form.productDescription.trim(),
        market: form.market.trim(),
        audience: form.audience.trim(),
        platform: form.platform,
        durationSec: form.durationSec,
        aspectRatio: form.aspectRatio,
        language: form.language,
        ...(priorityIds.length ? { priorityAssetIds: priorityIds } : {}),
        ...(referenceImage ? { referenceImage } : {}),
        ...(form.additionalRequirement.trim() ? { additionalRequirement: form.additionalRequirement.trim() } : {}),
      };

      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(brief),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "创建项目失败");

      router.push(`/project/${body.projectId}?autostart=1`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    }
  };

  const startReplay = async (name: string) => {
    const response = await fetch("/api/replay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const body = await response.json();
    if (response.ok) router.push(`/project/${body.projectId}`);
  };

  const valid = form.productName && form.productDescription && form.market && form.audience;

  return (
    <div className="flex min-h-screen flex-col">
      <BrandBar current="home" />

      <section className="grid items-end gap-8 border-b-[3px] border-ink px-5 py-10 md:grid-cols-[1fr_340px] md:px-10">
        <div>
          <p className="mb-3.5 font-mono text-[11px] tracking-[0.34em] text-orange">CALL SHEET · 通告单</p>
          <h1 className="text-4xl font-black leading-[1.06] md:text-[56px]">
            一支新广告，
            <br />
            今天<span className="text-orange">开机</span>。
          </h1>
          <p className="mt-4 max-w-[560px] text-sm leading-[1.9] text-[#5c554a]">
            发完这张<b className="text-ink">通告单</b>，<b className="text-ink">智能体剧组</b>接手余下全部：定三幕叙事、
            从道具间取材或转 AI 摄影师生成、逐帧质检、不合格只重拍那一幕——最后交付一支竖版成片。
          </p>
        </div>
        <div>
          <SetScene />
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              const first = replays[0];
              if (first) void startReplay(first.name);
            }}
            className="mt-1 inline-block bg-ink px-6 py-3.5 text-[13px] font-extrabold tracking-[0.14em] text-paper transition-colors hover:bg-orange"
          >
            先看一支示例片 →
          </a>
          <p className="mt-2.5 text-[11px] tracking-[0.06em] text-grey">约 40 秒 · 含一次真实的自修复</p>
        </div>
      </section>

      <div className="mx-auto w-full max-w-3xl px-5 py-10 md:px-0">
        <div className="border-[3px] border-ink bg-white/50">
          <div className="flex items-center justify-between border-b-2 border-ink px-7 py-4">
            <h2 className="text-[13px] font-black tracking-[0.3em]">通告单 · CALL SHEET</h2>
            <button
              type="button"
              onClick={loadDemo}
              className="font-mono text-[11px] tracking-[0.14em] text-orange underline decoration-orange underline-offset-4 hover:no-underline"
            >
              套用示例通告 ↗
            </button>
          </div>

          <div className="grid grid-cols-1 gap-x-8 gap-y-6 px-7 py-8 sm:grid-cols-2">
            <Field label="产品名称" className="sm:col-span-2">
              <input className="sheet-input" value={form.productName} onChange={(e) => set("productName", e.target.value)} placeholder="Tile Blitz" />
            </Field>
            <Field label="产品描述" className="sm:col-span-2">
              <textarea className="sheet-textarea" rows={3} value={form.productDescription} onChange={(e) => set("productDescription", e.target.value)} placeholder="超休闲磁砖消除游戏，60 秒一关，连击爽感十足…" />
            </Field>
            <Field label="投放市场">
              <input className="sheet-input" value={form.market} onChange={(e) => set("market", e.target.value)} placeholder="巴西" />
            </Field>
            <Field label="目标受众">
              <input className="sheet-input" value={form.audience} onChange={(e) => set("audience", e.target.value)} placeholder="18–34 岁休闲手游玩家" />
            </Field>
            <Field label="投放平台">
              <select className="sheet-select" value={form.platform} onChange={(e) => set("platform", e.target.value as AdBrief["platform"])}>
                <option>TikTok</option>
                <option>Reels</option>
                <option>Shorts</option>
              </select>
            </Field>
            <Field label="总时长">
              <select className="sheet-select" value={form.durationSec} onChange={(e) => set("durationSec", Number(e.target.value) as AdBrief["durationSec"])}>
                <option value={15}>15 秒</option>
                <option value={20}>20 秒</option>
              </select>
            </Field>
            <Field label="配音语言">
              <select className="sheet-select" value={form.language} onChange={(e) => set("language", e.target.value as NonNullable<AdBrief["language"]>)}>
                <option value="zh">中文普通话</option>
                <option value="yue">粤语</option>
                <option value="en">英语</option>
                <option value="pt">葡萄牙语</option>
                <option value="es">西班牙语</option>
              </select>
            </Field>
            <Field label="画幅">
              <select className="sheet-select" value={form.aspectRatio} onChange={(e) => set("aspectRatio", e.target.value as NonNullable<AdBrief["aspectRatio"]>)}>
                <option value="9:16">竖屏 9:16 · 手机信息流</option>
                <option value="16:9">横屏 16:9 · PC / 电视</option>
              </select>
            </Field>
            <Field label="附加要求 · 可选" className="sm:col-span-2">
              <input className="sheet-input" value={form.additionalRequirement} onChange={(e) => set("additionalRequirement", e.target.value)} placeholder="强调连击爽感；色彩鲜艳，契合巴西审美" />
            </Field>

            <details className="group col-span-full border border-dashed border-ink/40 open:pb-6">
              <summary className="flex cursor-pointer select-none items-center justify-between px-5 py-3.5 text-sm font-bold text-ink [&::-webkit-details-marker]:hidden">
                <span>附录 · 道具与参考图</span>
                <span className="text-xs font-normal tracking-[0.1em] text-grey group-open:hidden">可选 · 本产品的视频素材与产品图</span>
                <span className="hidden text-xs font-normal tracking-[0.1em] text-grey group-open:inline">收起附录</span>
              </summary>
              <div className="grid grid-cols-1 gap-4 px-5 sm:grid-cols-2">
                <div className="space-y-2 border border-ink/20 bg-white/40 p-4">
                  <p className="text-xs font-extrabold tracking-[0.2em] text-ink">上传本产品视频素材</p>
                  <p className="text-[11px] leading-relaxed text-grey">自动镜头拆分与视觉描述，本轮计划优先检索</p>
                  <button
                    type="button"
                    onClick={() => clipInput.current?.click()}
                    disabled={clipInputBusy}
                    className="w-full border border-dashed border-ink/40 py-2 text-xs font-bold text-ink transition-colors hover:border-orange hover:text-orange disabled:opacity-50"
                  >
                    {clipInputBusy ? "上传处理中…" : "＋ 上传视频素材"}
                  </button>
                  <input ref={clipInput} type="file" accept="video/*" multiple hidden onChange={(e) => void uploadClips(e.target.files)} />
                  {uploadNote && <p className="text-[11px] leading-relaxed text-[#2e6b46]">{uploadNote}</p>}
                  {analysisStatus.length > 0 && (
                    <div className="checkin-list mt-3 border border-ink/20 bg-white/60 p-3">
                      <div className="flex items-center gap-3">
                        <CharacterPropMaster className="size-12 shrink-0 text-ink" />
                        <div className="min-w-0">
                          <p className="text-xs font-extrabold tracking-[0.06em]">
                            {analysisPending ? (
                              <span className="text-orange">道具师正在清点新入库的道具…</span>
                            ) : (
                              <span className="text-[#2e6b46]">清点完毕，{analysisStatus.length} 件道具全部就绪</span>
                            )}
                          </p>
                          <p className="mt-0.5 font-mono text-[10px] tracking-[0.1em] text-grey">镜头拆分 → 视觉描述 → 入库检索</p>
                        </div>
                      </div>
                      <ul className="mt-3 space-y-2">
                        {analysisStatus.map((s) => (
                          <li key={s.id} className="flex items-center gap-2.5 text-[11px]">
                            {s.pending ? (
                              <span className="h-1.5 w-1.5 flex-none animate-pulse rounded-full bg-orange" />
                            ) : (
                              <span className="done-chip flex-none">已入库</span>
                            )}
                            <span className={`min-w-0 flex-1 truncate ${s.pending ? "font-bold text-orange" : "text-[#4a443b]"}`}>
                              {s.label}
                            </span>
                            {s.pending ? (
                              <span className="checkin-bar w-14 flex-none" />
                            ) : (
                              <span className="flex-none font-mono text-[10px] text-grey">
                                {s.segs > 0 ? `${s.segs} 段切片` : "整段可用"}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                      {analysisPending && (
                        <p className="mt-2.5 text-[11px] text-orange/90">建议等清点完成再开机，否则可能检索不到这些道具的切片</p>
                      )}
                    </div>
                  )}
                  {priorityIds.length > 0 && (
                    <button type="button" onClick={() => setPriorityIds([])} className="text-[11px] text-grey hover:text-ink">
                      清除优先（已选 {priorityIds.length} 个）
                    </button>
                  )}
                </div>
                <div className="space-y-2 border border-ink/20 bg-white/40 p-4">
                  <p className="text-xs font-extrabold tracking-[0.2em] text-ink">上传产品参考图</p>
                  <p className="text-[11px] leading-relaxed text-grey">AI 生成将参考真实产品外观（实测相似度约 80 分）</p>
                  {referenceImage ? (
                    <div className="flex items-center gap-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={referenceImage} alt="产品参考图" className="h-20 w-20 border border-ink/30 object-cover" />
                      <button type="button" onClick={() => setReferenceImage(null)} className="text-[11px] text-orange hover:underline">
                        移除
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => refInput.current?.click()}
                      disabled={refBusy}
                      className="w-full border border-dashed border-ink/40 py-2 text-xs font-bold text-ink transition-colors hover:border-orange hover:text-orange disabled:opacity-50"
                    >
                      {refBusy ? "上传中…" : "＋ 上传产品图（jpg / png）"}
                    </button>
                  )}
                  <input ref={refInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => void uploadReference(e.target.files?.[0] ?? null)} />
                </div>
              </div>
            </details>

            {retryNote && (
              <p className="col-span-full border border-orange/40 bg-orange/10 px-3 py-2 text-xs text-[#a03a00]">{retryNote}</p>
            )}
            {error && (
              <p className="col-span-full border-2 border-[#c22b00] bg-[#c22b00]/10 px-3 py-2 text-sm font-bold text-[#c22b00]">{error}</p>
            )}

            <div className="col-span-full flex flex-wrap items-center gap-5">
              <button
                type="button"
                disabled={!valid || loading}
                onClick={submit}
                className="bg-ink px-9 py-4 text-[15px] font-black tracking-[0.22em] text-paper transition-colors hover:bg-orange disabled:cursor-not-allowed disabled:opacity-40"
              >
                {loading ? "开机中…" : "开机 · 创建广告计划 →"}
              </button>
              <p className="text-[11.5px] leading-[1.8] text-grey">
                提交后剧组即刻开工，全程场记可回看。
                <br />
                平均 <b className="text-orange">40 秒</b> 交付首支成片。
              </p>
            </div>

            {replays.length > 0 && (
              <div className="col-span-full flex flex-wrap items-center gap-3.5 border-t border-ink/20 pt-5">
                <span className="font-mono text-[10px] tracking-[0.26em] text-grey">REFERENCE · 示例片</span>
                {replays.map((replay) => (
                  <button
                    key={replay.name}
                    type="button"
                    onClick={() => void startReplay(replay.name)}
                    className="inline-flex items-center gap-1.5 border-[1.5px] border-ink px-3.5 py-2 text-xs font-bold transition-colors hover:border-orange hover:text-orange"
                  >
                    <IconPlay className="size-3" />
                    {replay.name}
                    {replay.product ? ` · ${replay.product}` : ""}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {history.length > 0 && (
          <section id="archive" className="mt-16 scroll-mt-20">
            <div className="mb-5 flex items-baseline justify-between gap-4 border-b-[3px] border-ink pb-3">
              <h2 className="text-xl font-black tracking-[0.04em]">
                往期广告片
                <small className="ml-3.5 font-mono text-[10px] font-normal tracking-[0.3em] text-grey">FILMOGRAPHY · 交付存档</small>
              </h2>
              <a href="/archive" className="text-xs font-bold tracking-[0.1em] text-grey hover:text-orange">
                全部陈列 →
              </a>
            </div>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-5">
              {history.map((item) => (
                <button
                  key={item.projectId}
                  type="button"
                  onClick={() => router.push(`/project/${item.projectId}`)}
                  className="propcard flex flex-col border border-ink/25 bg-white/45 text-left"
                >
                  {item.hasFinal ? (
                    <video
                      src={`/api/media/${item.projectId}/final.mp4#t=0.5`}
                      preload="metadata"
                      muted
                      playsInline
                      className="aspect-video w-full border-b border-ink/25 bg-black object-cover"
                    />
                  ) : (
                    <div className="grid aspect-video w-full place-items-center border-b border-ink/25 bg-paper font-mono text-[10px] tracking-[0.2em] text-grey">
                      无成片
                    </div>
                  )}
                  <span className="block p-3">
                    <span className="block truncate text-[13.5px] font-extrabold">{item.product ?? item.projectId}</span>
                    <span className="mt-1 block truncate font-mono text-[10px] tracking-[0.08em] text-grey">
                      {marketLabel(item.market)} · {item.createdAt?.slice(5, 16).replace("T", " ") ?? ""}
                      {item.demoMode === "replay" ? " · 回放" : ""}
                    </span>
                    <span
                      className={`mt-1.5 inline-block px-2 py-0.5 text-[10px] font-black tracking-[0.12em] ${
                        item.status === "COMPLETED"
                          ? "bg-ink text-paper"
                          : item.status === "FAILED"
                            ? "border-[1.5px] border-orange text-orange"
                            : "bg-ink/10 text-ink"
                      }`}
                    >
                      {PROJECT_STATUS_ZH[item.status as keyof typeof PROJECT_STATUS_ZH] ?? item.status}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>

      <footer className="mt-auto border-t-2 border-ink px-5 py-3.5 md:px-10">
        <p className="font-mono text-[10px] tracking-[0.22em] text-grey">ADPILOT · 通告单</p>
      </footer>
    </div>
  );
}

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`flex flex-col gap-2 ${className ?? ""}`}>
      <span className="text-[10.5px] font-extrabold tracking-[0.26em] text-grey">{label}</span>
      {children}
    </label>
  );
}
