"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

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
            ? `已上传 ${body.added.length} 个素材，其中 ${body.analyzing} 个长素材正在后台做镜头拆分与视觉描述（完成后自动刷新）`
            : `已上传 ${body.added.length} 个素材（入库总数 ${body.total}）`,
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
      setMessage({ kind: "ok", text: "分析已启动：镜头检测 → 切片 → 视觉描述（约几十秒，自动刷新）" });
      await refresh();
    } else {
      setMessage({ kind: "err", text: body.error ?? "启动分析失败" });
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
      setMessage({ kind: "ok", text: "素材信息已更新（标签直接影响检索匹配）" });
      await refresh();
    } else {
      setMessage({ kind: "err", text: "更新失败" });
    }
  };

  const remove = async (id: string) => {
    if (!confirm(`确定删除素材 ${id}？其子切片会一并删除，历史项目不受影响。`)) return;
    const response = await fetch(`/api/assets/${id}`, { method: "DELETE" });
    if (response.ok) {
      setMessage({ kind: "ok", text: `已删除 ${id}` });
      await refresh();
    }
  };

  const parents = assets.filter((a) => !a.parentFile);
  const childrenOf = (file: string) => assets.filter((a) => a.parentFile === file);

  return (
    <div className="mx-auto min-h-screen w-full max-w-6xl px-6 py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/" className="grid size-9 place-items-center rounded-lg bg-indigo-500 font-black text-white">A</Link>
          <div>
            <h1 className="text-xl font-bold tracking-tight">素材库</h1>
            <p className="text-xs text-zinc-400">
              上传后长素材会自动做「镜头检测 → 切片 → 视觉描述」，切片直接参与 Agent 检索匹配
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/" className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:border-zinc-500">
            ← 返回首页
          </Link>
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={uploading}
            className="rounded-lg bg-indigo-500 px-4 py-1.5 text-sm font-semibold text-white hover:bg-indigo-400 disabled:opacity-50"
          >
            {uploading ? "上传处理中…" : "＋ 上传视频素材"}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="video/mp4,video/quicktime,video/webm,video/*"
            multiple
            hidden
            onChange={(e) => void upload(e.target.files)}
          />
        </div>
      </header>

      {message && (
        <p className={`mb-4 rounded-lg border px-3 py-2 text-sm ${message.kind === "ok" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-red-500/30 bg-red-500/10 text-red-300"}`}>
          {message.text}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-zinc-500">加载中…</p>
      ) : parents.length === 0 ? (
        <div className="grid place-items-center rounded-2xl border border-dashed border-zinc-800 py-20 text-sm text-zinc-500">
          素材库为空——点击「上传视频素材」或运行 <code className="mx-1 rounded bg-zinc-800 px-1.5 py-0.5">npm run assets</code> 生成内置演示素材
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {parents.map((asset) => {
            const children = childrenOf(asset.file);
            return (
              <div key={asset.id} className="flex flex-col">
                <AssetCard
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
                  <div className="mt-2 space-y-1.5 rounded-xl border border-zinc-800 bg-zinc-950/60 p-2">
                    <p className="px-1 text-[10px] font-bold uppercase tracking-wider text-zinc-600">
                      自动切片（{children.length} 段 · 时间戳 + 视觉描述）
                    </p>
                    {children.map((child) => (
                      <div key={child.id} className="rounded-lg bg-zinc-900/80 p-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-[10px] text-amber-300">
                            {child.id.replace(/^[^_]+_/, "")}
                          </span>
                          <span className="text-[10px] text-zinc-500">{child.durationSec}s</span>
                        </div>
                        <video
                          src={`${child.url}#t=${child.startTime ?? 0},${child.endTime ?? child.durationSec}`}
                          className="mt-1 aspect-video w-full rounded bg-black object-cover"
                          controls
                          muted
                          playsInline
                          preload="metadata"
                        />
                        <p className="mt-1 line-clamp-2 text-[11px] text-zinc-400">{child.description}</p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {child.tags.slice(0, 5).map((tag) => (
                            <span key={tag} className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] text-zinc-500">{tag}</span>
                          ))}
                        </div>
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
  );
}

function AssetCard({
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

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/60">
      <div className="relative aspect-[9/16] max-h-64 bg-black">
        <video
          src={asset.url}
          className="size-full object-cover"
          muted
          loop
          playsInline
          preload="metadata"
          onMouseEnter={(e) => void e.currentTarget.play().catch(() => {})}
          onMouseLeave={(e) => e.currentTarget.pause()}
        />
        <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-semibold text-white">
          {asset.origin === "upload" ? "上传" : "内置"}
        </span>
        {asset.analysis === "pending" && (
          <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 animate-pulse rounded-full bg-black/70 px-3 py-1 text-[10px] text-amber-300">
            拆分分析中…
          </span>
        )}
        <span className="absolute right-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] text-zinc-200">
          {asset.durationSec}s
        </span>
      </div>

      {editing ? (
        <div className="space-y-2 p-3">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100 focus:border-indigo-500 focus:outline-none"
            placeholder="素材描述（中英文都可以，描述越具体检索越准）"
          />
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100 focus:border-indigo-500 focus:outline-none"
            placeholder="标签，逗号分隔，如：反应, 手机, 游戏, celebration"
          />
          <div className="flex gap-2">
            <button type="button" onClick={() => onSave(description, tags)} className="flex-1 rounded-lg bg-emerald-500/90 py-1.5 text-xs font-semibold text-black hover:bg-emerald-400">
              保存
            </button>
            <button type="button" onClick={onCancel} className="flex-1 rounded-lg border border-zinc-700 py-1.5 text-xs text-zinc-300">
              取消
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-2 p-3">
          <p className="line-clamp-2 text-xs text-zinc-300">{asset.description}</p>
          <div className="flex flex-wrap gap-1">
            {asset.tags.slice(0, 6).map((tag) => (
              <span key={tag} className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">{tag}</span>
            ))}
          </div>
          <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
            {segmentCount > 0 ? (
              <button type="button" onClick={onToggle} className="flex-1 rounded-lg border border-amber-500/40 bg-amber-500/10 py-1 text-[11px] text-amber-300">
                {expanded ? "收起切片 ▲" : `切片 ${segmentCount} 段 ▼`}
              </button>
            ) : (
              <button type="button" onClick={onAnalyze} className="flex-1 rounded-lg border border-zinc-700 py-1 text-[11px] text-zinc-300 hover:border-zinc-500" title="镜头检测 → 切片 → 视觉描述">
                AI 拆分分析
              </button>
            )}
            <button type="button" onClick={onEdit} className="rounded-lg border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:border-zinc-500">
              编辑
            </button>
            <button type="button" onClick={onDelete} className="rounded-lg border border-red-500/40 px-2 py-1 text-[11px] text-red-300 hover:bg-red-500/10">
              删除
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
