"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BrandBar } from "@/components/brand-bar";
import { CharacterPropMaster } from "@/components/crew";
import { formatDuration } from "@/lib/i18n";

interface AssetEntry {
  id: string;
  file: string;
  description: string;
  tags: string[];
  durationSec: number;
  origin?: "builtin" | "upload" | "segment";
  hasSegments?: boolean;
  analysis?: "done" | "pending";
  parentFile?: string;
  startTime?: number;
  endTime?: number;
  url: string;
}

/** 与「上传」来源章重复的标签，不在卡片上重复展示。 */
const REDUNDANT_TAGS = new Set(["uploaded", "上传"]);

/** 道具间：素材是片场的道具，每条是一张印刷档案卡。 */
export default function AssetsPage() {
  const [assets, setAssets] = useState<AssetEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [expandedParent, setExpandedParent] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const poller = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/assets");
    const body = await response.json();
    setAssets(body.assets ?? []);
    setLoading(false);
    // 有素材还在后台分析（镜头拆分+视觉描述）时自动轮询刷新
    const pending = (body.assets ?? []).some((a: AssetEntry) => a.analysis === "pending");
    if (pending && !poller.current) {
      poller.current = setInterval(() => void refresh(), 5000);
    } else if (!pending && poller.current) {
      clearInterval(poller.current);
      poller.current = null;
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => {
      if (poller.current) clearInterval(poller.current);
    };
  }, [refresh]);

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setMessage(null);
    try {
      const form = new FormData();
      for (const file of Array.from(files)) form.append("files", file);
      const response = await fetch("/api/assets/upload", { method: "POST", body: form });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "上传失败");
      setMessage({
        kind: "ok",
        text:
          body.analyzing > 0
            ? `已入库 ${body.added.length} 件道具，其中 ${body.analyzing} 件正在后台做镜头拆分与视觉描述（完成后自动刷新）`
            : `已入库 ${body.added.length} 件道具（道具间总数 ${body.total}）`,
      });
      await refresh();
    } catch (e) {
      setMessage({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const analyze = async (id: string) => {
    const response = await fetch(`/api/assets/${id}`, { method: "POST" });
    const body = await response.json();
    if (response.ok) {
      setMessage({ kind: "ok", text: "拆分已启动：镜头检测 → 切片 → 视觉描述（约几十秒，自动刷新）" });
      await refresh();
    } else {
      setMessage({ kind: "err", text: body.error ?? "启动拆分失败" });
    }
  };

  const saveEdit = async (id: string, description: string, tagsText: string) => {
    const tags = tagsText.split(/[,，\s]+/).map((t) => t.trim()).filter(Boolean);
    const response = await fetch(`/api/assets/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description, tags }),
    });
    if (response.ok) {
      setEditing(null);
      setMessage({ kind: "ok", text: "道具卡片已更新（标签直接影响检索匹配）" });
      await refresh();
    } else {
      setMessage({ kind: "err", text: "更新失败" });
    }
  };

  const remove = async (id: string) => {
    if (!confirm(`确定删除道具 ${id}？其子切片会一并删除，往期广告片不受影响。`)) return;
    const response = await fetch(`/api/assets/${id}`, { method: "DELETE" });
    if (response.ok) {
      setMessage({ kind: "ok", text: `已删除 ${id}` });
      await refresh();
    }
  };

  const parents = assets.filter((a) => !a.parentFile);
  const childrenOf = (file: string) => assets.filter((a) => a.parentFile === file);
  const builtinCount = parents.filter((a) => a.origin !== "upload").length;
  const uploadCount = parents.length - builtinCount;

  return (
    <div className="flex min-h-screen flex-col">
      <BrandBar current="assets" />

      <section className="grid items-end gap-8 border-b-[3px] border-ink px-5 py-9 md:grid-cols-[1fr_auto] md:px-10">
        <div>
          <p className="mb-3 font-mono text-[11px] tracking-[0.34em] text-orange">PROP ROOM · 道具间</p>
          <h1 className="text-4xl font-black leading-[1.05] md:text-5xl">
            道具间<span className="text-orange">。</span>
          </h1>
          <p className="mt-3 max-w-[620px] text-[13.5px] leading-[1.85] text-[#5c554a]">
            素材是片场的道具：<b className="text-ink">上传后自动镜头拆分与视觉描述</b>，
            切片直接参与剧组的检索匹配——开机时道具越全，成片越快。
          </p>
        </div>
        <div className="text-right">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={uploading}
            className="bg-ink px-7 py-3.5 text-[13px] font-black tracking-[0.18em] text-paper transition-colors hover:bg-orange disabled:opacity-50"
          >
            {uploading ? "入库处理中…" : "＋ 入库视频道具"}
          </button>
          <p className="mt-2.5 font-mono text-[10px] tracking-[0.12em] text-grey">支持 mp4 / mov / webm · 长素材自动切片</p>
        </div>
      </section>

      <div className="mx-auto w-full max-w-6xl flex-1 px-5 py-8 md:px-10">
        {message && (
          <p className={`mb-5 border-2 px-3.5 py-2.5 text-sm font-bold ${message.kind === "ok" ? "border-[#2e6b46] bg-[#2e6b46]/10 text-[#2e6b46]" : "border-[#c22b00] bg-[#c22b00]/10 text-[#c22b00]"}`}>
            {message.text}
          </p>
        )}

        <div className="mb-5 flex flex-wrap items-center gap-4">
          <span className="font-mono text-[11px] tracking-[0.2em] text-grey">
            共 <b className="text-ink">{parents.length}</b> 件 · 内置 {builtinCount} · 上传 {uploadCount}
          </span>
        </div>

        {loading ? (
          <p className="text-sm text-grey">清点道具中…</p>
        ) : parents.length === 0 ? (
          <div className="grid place-items-center border-2 border-dashed border-ink/30 py-20 text-sm text-grey">
            道具间是空的——点击「入库视频道具」或运行{" "}
            <code className="mx-1 border border-ink/20 bg-white/60 px-1.5 py-0.5 font-mono text-xs">npm run assets</code>{" "}
            生成内置演示道具
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {parents.map((asset) => {
              const children = childrenOf(asset.file);
              return (
                <div key={asset.id} className="flex flex-col">
                  <PropCard
                    asset={asset}
                    segmentCount={children.length}
                    expanded={expandedParent === asset.id}
                    onToggle={() => setExpandedParent(expandedParent === asset.id ? null : asset.id)}
                    editing={editing === asset.id}
                    onEdit={() => setEditing(asset.id)}
                    onCancel={() => setEditing(null)}
                    onSave={(description, tags) => void saveEdit(asset.id, description, tags)}
                    onDelete={() => void remove(asset.id)}
                    onAnalyze={() => void analyze(asset.id)}
                  />
                  {expandedParent === asset.id && children.length > 0 && (
                    <div className="mt-2 space-y-1.5 border border-ink/20 bg-white/40 p-2">
                      <p className="px-1 font-mono text-[10px] font-medium uppercase tracking-[0.24em] text-grey">
                        自动切片（{children.length} 段 · 时间戳 + 视觉描述）
                      </p>
                      {children.map((child) => (
                        <div key={child.id} className="border border-ink/15 bg-white/60 p-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-[10px] text-orange">{child.id.replace(/^[^_]+_/, "")}</span>
                            <span className="font-mono text-[10px] text-grey">{formatDuration(child.durationSec)}</span>
                          </div>
                          <video
                            src={`${child.url}#t=${child.startTime ?? 0},${child.endTime ?? child.durationSec}`}
                            className="mt-1 aspect-video w-full border border-ink/15 bg-black object-cover"
                            controls
                            muted
                            playsInline
                            preload="metadata"
                          />
                          <p className="mt-1 line-clamp-2 text-[11px] text-[#4a443b]">{child.description}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <footer className="mt-auto border-t-2 border-ink px-5 py-3.5 md:px-10">
        <div className="mx-auto flex max-w-6xl justify-between font-mono text-[10px] tracking-[0.22em] text-grey">
          <span>ADPILOT · 道具间</span>
          <span className="hidden sm:inline">道具越全，开机越快</span>
        </div>
      </footer>

      <input
        ref={fileInput}
        type="file"
        accept="video/mp4,video/quicktime,video/webm,video/*"
        multiple
        hidden
        onChange={(e) => void upload(e.target.files)}
      />
    </div>
  );
}

function PropCard({
  asset,
  segmentCount,
  expanded,
  onToggle,
  editing,
  onEdit,
  onCancel,
  onSave,
  onDelete,
  onAnalyze,
}: {
  asset: AssetEntry;
  segmentCount: number;
  expanded: boolean;
  onToggle: () => void;
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (description: string, tags: string) => void;
  onDelete: () => void;
  onAnalyze: () => void;
}) {
  const [description, setDescription] = useState(asset.description);
  const [tags, setTags] = useState(asset.tags.join(", "));

  // 上传时若还没生成 AI 描述，展示的是「文件名（用户上传·竖屏）」——转成人话
  const descriptionLabel =
    asset.description.match(/^\S+?\.(?:mp4|mov|webm)（(.+)）$/u)?.[1] ?? asset.description;
  const visibleTags = Array.from(new Set(asset.tags)).filter((tag) => !REDUNDANT_TAGS.has(tag));

  return (
    <div className="propcard flex flex-col border border-ink/30 bg-white/50">
      <div className="relative overflow-hidden border-b border-ink/30 bg-black">
        <video
          src={`${asset.url}#t=0.1`}
          className="block aspect-[3/4] w-full object-cover"
          muted
          loop
          playsInline
          preload="metadata"
          onMouseEnter={(e) => void e.currentTarget.play().catch(() => {})}
          onMouseLeave={(e) => e.currentTarget.pause()}
        />
        <span
          className={`absolute left-2.5 top-2.5 border-[1.5px] bg-paper px-2 py-0.5 text-[10px] font-black tracking-[0.22em] ${
            asset.origin === "upload" ? "border-orange text-orange" : "border-ink text-ink"
          }`}
        >
          {asset.origin === "upload" ? "上传" : "内置"}
        </span>
        {asset.analysis === "pending" && (
          <span className="absolute inset-0 grid place-items-center bg-paper/75 font-mono text-[11px] tracking-[0.3em] text-orange [animation:ch-ant_1.6s_steps(2)_infinite]">
            拆分分析中…
          </span>
        )}
        <span className="absolute bottom-2.5 right-2.5 bg-ink/80 px-2 py-1 font-mono text-[10.5px] tracking-[0.08em] text-paper">
          {formatDuration(asset.durationSec)}
        </span>
      </div>

      {editing ? (
        <div className="space-y-2 p-3.5">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full border-b-2 border-ink bg-transparent px-1 py-1.5 text-xs text-ink outline-none focus:border-orange"
            placeholder="道具描述（描述越具体检索越准）"
          />
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            className="w-full border-b-2 border-ink bg-transparent px-1 py-1.5 text-xs text-ink outline-none focus:border-orange"
            placeholder="标签，逗号分隔，如：反应, 手机, 游戏"
          />
          <div className="flex gap-2">
            <button type="button" onClick={() => onSave(description, tags)} className="flex-1 bg-ink py-1.5 text-xs font-black tracking-[0.1em] text-paper hover:bg-orange">
              保存
            </button>
            <button type="button" onClick={onCancel} className="flex-1 border-[1.5px] border-ink py-1.5 text-xs font-bold">
              取消
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col p-3.5">
          <p className="mb-1.5 font-mono text-[10px] tracking-[0.22em] text-grey">
            {asset.id.toUpperCase()} · 道具间
          </p>
          <p className="line-clamp-2 min-h-[41px] text-[12.5px] leading-[1.65] text-[#3a352d]">{descriptionLabel}</p>
          {visibleTags.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {visibleTags.slice(0, 6).map((tag) => (
                <span key={tag} className="border border-ink/30 px-2 py-0.5 text-[10px] tracking-[0.06em] text-[#5c554a]">{tag}</span>
              ))}
            </div>
          )}
          <div className="mt-auto flex items-center gap-3 border-t border-ink/15 pt-2.5">
            {segmentCount > 0 ? (
              <button type="button" onClick={onToggle} className="border-b-2 border-orange pb-0.5 text-[11.5px] font-extrabold tracking-[0.08em] hover:text-orange">
                {expanded ? "收起切片 ▲" : `切片 ${segmentCount} 段 ▼`}
              </button>
            ) : (
              <button
                type="button"
                onClick={onAnalyze}
                className="border-b-2 border-orange pb-0.5 text-[11.5px] font-extrabold tracking-[0.08em] hover:text-orange"
                title="镜头检测 → 切片 → 视觉描述"
              >
                AI 切片
              </button>
            )}
            <span className="ml-auto flex gap-3 text-[11px] text-grey">
              <button type="button" onClick={onEdit} className="hover:text-orange">编辑</button>
              <button type="button" onClick={onDelete} className="hover:text-[#c22b00]">删除</button>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
