"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { AdBrief } from "@/lib/state/schema";
import { DEMO_BRIEF } from "@/lib/demo/demo-brief";
import { PROJECT_STATUS_ZH, marketLabel } from "@/lib/i18n";
import { IconFilm, IconImage, IconPlay, IconSparkles } from "./icons";

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
/** 与「上传」徽章重复的标签，不在卡片上重复展示。 */
const REDUNDANT_TAGS = new Set(["uploaded", "上传"]);

interface HistoryItem {
  projectId: string;
  product?: string;
  market?: string;
  status?: string;
  createdAt?: string;
  hasFinal: boolean;
  demoMode?: string;
}

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

  // 有进行中的项目时自动刷新历史，代替手动「刷新」按钮
  useEffect(() => {
    if (!history.some((h) => ACTIVE_STATUSES.has(h.status ?? ""))) return;
    const timer = setInterval(refreshHistory, 8000);
    return () => clearInterval(timer);
  }, [history, refreshHistory]);

  // 从工作台「复制简报，新建重试」带回来的简报：直接预填
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
      setRetryNote("已填入上次未完成的简报，确认内容后重新创建即可。");
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
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center gap-5 px-6 py-10">
      <header className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-indigo-500 font-black text-white">A</span>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">AdPilot</h1>
              <p className="text-sm text-zinc-400">自修复智能体广告工作室</p>
            </div>
          </div>
          <a
            href="/assets"
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 transition hover:border-zinc-500"
          >
            <IconFilm className="size-3.5" />
            素材库
          </a>
        </div>
        <p className="text-sm leading-relaxed text-zinc-400">
          提交一份广告简报，智能体团队会规划场景、决定每个画面用素材库还是 AI 生成、逐画面质检并自动修复，
          最终产出可直接投放的竖版广告。不确定从哪开始？先
          <button type="button" onClick={loadDemo} className="mx-1 text-indigo-300 underline decoration-indigo-500/40 underline-offset-2 hover:text-indigo-200">
            加载演示简报
          </button>
          走一遍全流程。
        </p>
      </header>

      <div className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">广告简报</h2>
          <button
            type="button"
            onClick={loadDemo}
            className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-3 py-1.5 text-xs font-medium text-indigo-300 transition hover:bg-indigo-500/20"
          >
            <IconSparkles className="size-3.5" />
            加载演示简报
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="产品名称" className="sm:col-span-2">
            <input className={inputClass} value={form.productName} onChange={(e) => set("productName", e.target.value)} placeholder="Tile Blitz" />
          </Field>
          <Field label="产品描述" className="sm:col-span-2">
            <textarea className={inputClass} rows={3} value={form.productDescription} onChange={(e) => set("productDescription", e.target.value)} placeholder="超休闲磁砖消除游戏，60 秒一关，连击爽感十足…" />
          </Field>
          <Field label="投放市场">
            <input className={inputClass} value={form.market} onChange={(e) => set("market", e.target.value)} placeholder="巴西" />
          </Field>
          <Field label="目标受众">
            <input className={inputClass} value={form.audience} onChange={(e) => set("audience", e.target.value)} placeholder="18-34 岁休闲手游玩家" />
          </Field>
          <Field label="投放平台">
            <select className={inputClass} value={form.platform} onChange={(e) => set("platform", e.target.value as AdBrief["platform"])}>
              <option>TikTok</option>
              <option>Reels</option>
              <option>Shorts</option>
            </select>
          </Field>
          <Field label="总时长">
            <select className={inputClass} value={form.durationSec} onChange={(e) => set("durationSec", Number(e.target.value) as AdBrief["durationSec"])}>
              <option value={15}>15 秒</option>
              <option value={20}>20 秒</option>
            </select>
          </Field>
          <Field label="配音语言">
            <select
              className={inputClass}
              value={form.language}
              onChange={(e) => set("language", e.target.value as NonNullable<AdBrief["language"]>)}
            >
              <option value="zh">中文普通话</option>
              <option value="yue">粤语</option>
              <option value="en">英语</option>
              <option value="pt">葡萄牙语</option>
              <option value="es">西班牙语</option>
            </select>
          </Field>
          <Field label="画幅" className="sm:col-span-2">
            <select
              className={inputClass}
              value={form.aspectRatio}
              onChange={(e) => set("aspectRatio", e.target.value as NonNullable<AdBrief["aspectRatio"]>)}
            >
              <option value="9:16">竖屏 9:16（手机信息流）</option>
              <option value="16:9">横屏 16:9（PC / 电视）</option>
            </select>
          </Field>
          <Field label="附加要求（可选）" className="sm:col-span-2">
            <input className={inputClass} value={form.additionalRequirement} onChange={(e) => set("additionalRequirement", e.target.value)} placeholder="强调连击爽感；色彩鲜艳，契合巴西审美" />
          </Field>
        </div>

        <details className="group rounded-xl border border-zinc-800 bg-zinc-950/40 open:pb-4">
          <summary className="flex cursor-pointer select-none items-center justify-between px-4 py-3 text-sm font-medium text-zinc-300 [&::-webkit-details-marker]:hidden">
            <span>高级选项</span>
            <span className="text-xs text-zinc-500 group-open:hidden">素材与参考图 · 可选</span>
          </summary>
          <div className="grid grid-cols-1 gap-3 px-4 sm:grid-cols-2">
            <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
              <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-300">
                <IconFilm className="size-3.5 text-zinc-400" />
                本次相关素材
              </p>
              <p className="text-[11px] leading-relaxed text-zinc-500">
                上传本产品的视频素材：自动识别、切片、打标入素材库，并在这次计划中优先检索
              </p>
              <button
                type="button"
                onClick={() => clipInput.current?.click()}
                disabled={clipInputBusy}
                className="w-full rounded-lg border border-dashed border-zinc-600 py-2 text-xs text-zinc-300 hover:border-indigo-500 hover:text-indigo-300 disabled:opacity-50"
              >
                {clipInputBusy ? "上传处理中…" : "＋ 上传视频素材"}
              </button>
              <input ref={clipInput} type="file" accept="video/*" multiple hidden onChange={(e) => void uploadClips(e.target.files)} />
              {uploadNote && <p className="text-[11px] text-emerald-300">{uploadNote}</p>}
              {analysisStatus.length > 0 && (
                <div className="space-y-1">
                  {analysisStatus.map((s) => (
                    <p key={s.id} className={`flex items-center gap-1.5 text-[11px] ${s.pending ? "text-amber-300" : "text-emerald-300"}`}>
                      {s.pending ? (
                        <span className="animate-pulse">{s.label} · 镜头拆分/视觉描述中…</span>
                      ) : (
                        <span>{s.label} · 已解析{s.segs > 0 ? ` ${s.segs} 段切片` : ""}</span>
                      )}
                    </p>
                  ))}
                  {analysisPending && (
                    <p className="text-[11px] text-amber-400/90">
                      建议等解析完成再生成，否则可能检索不到这些素材的切片
                    </p>
                  )}
                </div>
              )}
              {priorityIds.length > 0 && (
                <button type="button" onClick={() => setPriorityIds([])} className="text-[11px] text-zinc-500 hover:text-zinc-300">
                  清除优先（已选 {priorityIds.length} 个）
                </button>
              )}
            </div>
            <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
              <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-300">
                <IconImage className="size-3.5 text-zinc-400" />
                产品参考图
              </p>
              <p className="text-[11px] leading-relaxed text-zinc-500">
                上传产品图后，AI 生成会参考真实产品外观（实测相似度约 80 分）
              </p>
              {referenceImage ? (
                <div className="flex items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={referenceImage} alt="产品参考图" className="size-20 rounded-lg border border-zinc-700 object-cover" />
                  <button type="button" onClick={() => setReferenceImage(null)} className="text-[11px] text-red-300 hover:underline">
                    移除
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => refInput.current?.click()}
                  disabled={refBusy}
                  className="w-full rounded-lg border border-dashed border-zinc-600 py-2 text-xs text-zinc-300 hover:border-indigo-500 hover:text-indigo-300 disabled:opacity-50"
                >
                  {refBusy ? "上传中…" : "＋ 上传产品图（jpg / png）"}
                </button>
              )}
              <input ref={refInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => void uploadReference(e.target.files?.[0] ?? null)} />
            </div>
          </div>
        </details>

        {retryNote && (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">{retryNote}</p>
        )}
        {error && (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>
        )}

        <div className="sticky bottom-3 z-10 sm:static">
          <button
            type="button"
            disabled={!valid || loading}
            onClick={submit}
            className="w-full rounded-xl bg-indigo-500 py-2.5 font-semibold text-white shadow-lg shadow-black/50 transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-40 sm:shadow-none"
          >
            {loading ? "创建中…" : "创建广告计划"}
          </button>
        </div>

        {replays.length > 0 && (
          <div className="border-t border-zinc-800 pt-3">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-zinc-600">
              示例项目 · 一键回放完整运行
            </p>
            <div className="flex flex-wrap gap-2">
              {replays.map((replay) => (
                <button
                  key={replay.name}
                  type="button"
                  onClick={() => void startReplay(replay.name)}
                  className="inline-flex items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-300 transition hover:bg-amber-500/20"
                >
                  <IconPlay className="size-3" />
                  {replay.name}
                  {replay.product ? ` · ${replay.product}` : ""}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {history.length > 0 && (
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
          <h2 className="mb-3 text-sm font-semibold text-zinc-300">历史项目</h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {history.map((item) => (
              <button
                key={item.projectId}
                type="button"
                onClick={() => router.push(`/project/${item.projectId}`)}
                className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/60 text-left transition hover:border-zinc-600"
              >
                {item.hasFinal && (
                  <video
                    src={`/api/media/${item.projectId}/final.mp4#t=0.5`}
                    preload="metadata"
                    muted
                    playsInline
                    className="aspect-video w-full border-b border-zinc-800 bg-black object-cover"
                  />
                )}
                <div className="p-3">
                  <p className="truncate text-sm font-medium text-zinc-200">{item.product ?? item.projectId}</p>
                  <p className="mt-0.5 truncate text-[11px] text-zinc-500">
                    {marketLabel(item.market)} · {item.createdAt?.slice(5, 16).replace("T", " ") ?? ""}
                    {item.demoMode === "replay" ? " · 回放" : ""}
                  </p>
                  <span className={`mt-1.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusClass(item.status)}`}>
                    {PROJECT_STATUS_ZH[item.status as keyof typeof PROJECT_STATUS_ZH] ?? item.status}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function statusClass(status?: string): string {
  if (status === "COMPLETED") return "bg-emerald-500/15 text-emerald-300";
  if (status === "FAILED") return "bg-red-500/15 text-red-300";
  return "bg-zinc-800 text-zinc-400";
}

const inputClass =
  "w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none";

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`flex flex-col gap-1.5 text-xs font-medium text-zinc-400 ${className ?? ""}`}>
      {label}
      {children}
    </label>
  );
}
