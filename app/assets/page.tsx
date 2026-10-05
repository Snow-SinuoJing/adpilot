"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

interface AssetEntry {
  id: string;
  file: string;
  description: string;
  tags: string[];
  durationSec: number;
  origin?: "builtin" | "upload";
  url: string;
}

export default function AssetsPage() {
  const [assets, setAssets] = useState<AssetEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/assets");
    const body = await response.json();
    setAssets(body.assets ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
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
      setMessage({ kind: "ok", text: `已上传 ${body.added.length} 个素材（入库总数 ${body.total}）` });
      await refresh();
    } catch (e) {
      setMessage({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
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
    if (!confirm(`确定删除素材 ${id}？正在引用它的历史项目不受影响。`)) return;
    const response = await fetch(`/api/assets/${id}`, { method: "DELETE" });
    if (response.ok) {
      setMessage({ kind: "ok", text: `已删除 ${id}` });
      await refresh();
    }
  };

  return (
    <div className="mx-auto min-h-screen w-full max-w-6xl px-6 py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/" className="grid size-9 place-items-center rounded-lg bg-indigo-500 font-black text-white">A</Link>
          <div>
            <h1 className="text-xl font-bold tracking-tight">素材库</h1>
            <p className="text-xs text-zinc-400">上传真实素材后，Agent 会自动把它们纳入检索匹配池</p>
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
      ) : assets.length === 0 ? (
        <div className="grid place-items-center rounded-2xl border border-dashed border-zinc-800 py-20 text-sm text-zinc-500">
          素材库为空——点击「上传视频素材」或运行 <code className="mx-1 rounded bg-zinc-800 px-1.5 py-0.5">npm run assets</code> 生成内置演示素材
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {assets.map((asset) => (
            <AssetCard
              key={asset.id}
              asset={asset}
              editing={editing === asset.id}
              onEdit={() => setEditing(asset.id)}
              onCancel={() => setEditing(null)}
              onSave={(description, tags) => void saveEdit(asset.id, description, tags)}
              onDelete={() => void remove(asset.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AssetCard({
  asset,
  editing,
  onEdit,
  onCancel,
  onSave,
  onDelete,
}: {
  asset: AssetEntry;
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (description: string, tags: string) => void;
  onDelete: () => void;
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
          <div className="mt-auto flex gap-2 pt-1">
            <button type="button" onClick={onEdit} className="flex-1 rounded-lg border border-zinc-700 py-1 text-[11px] text-zinc-300 hover:border-zinc-500">
              编辑信息
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
