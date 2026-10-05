"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PROJECT_STATUS_ZH, marketLabel } from "@/lib/i18n";
import { BrandBar } from "@/components/brand-bar";

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

/** 往期广告片：交付存档陈列馆——与道具间同款档案形式，一件一件看。 */
export default function ArchivePage() {
  const router = useRouter();
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((body) => {
        setHistory(body.projects ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!history.some((h) => ACTIVE_STATUSES.has(h.status ?? ""))) return;
    const timer = setInterval(refresh, 8000);
    return () => clearInterval(timer);
  }, [history, refresh]);

  return (
    <div className="flex min-h-screen flex-col">
      <BrandBar current="archive" />

      <section className="grid items-end gap-8 border-b-[3px] border-ink px-5 py-9 md:grid-cols-[1fr_auto] md:px-10">
        <div>
          <p className="mb-3 font-mono text-[11px] tracking-[0.34em] text-orange">FILMOGRAPHY · 往期广告片</p>
          <h1 className="text-4xl font-black leading-[1.05] md:text-5xl">
            往期广告片<span className="text-orange">。</span>
          </h1>
          <p className="mt-3 max-w-[620px] text-[13.5px] leading-[1.85] text-[#5c554a]">
            每一支都由剧组全程场记交付——<b className="text-ink">点开任意一支，回看它被拍出来的全过程</b>。
          </p>
        </div>
        <p className="font-mono text-[11px] tracking-[0.2em] text-grey">
          共 <b className="text-ink">{history.length}</b> 支 · 按开机时间陈列
        </p>
      </section>

      <div className="mx-auto w-full max-w-6xl flex-1 px-5 py-8 md:px-10">
        {loading ? (
          <p className="text-sm text-grey">翻检片库中…</p>
        ) : history.length === 0 ? (
          <div className="grid place-items-center border-2 border-dashed border-ink/30 py-20 text-sm text-grey">
            片库还是空的——回开机页发第一张通告单吧
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {history.map((item) => (
              <button
                key={item.projectId}
                type="button"
                onClick={() => router.push(`/project/${item.projectId}`)}
                className="propcard flex flex-col border border-ink/30 bg-white/50 text-left"
              >
                {item.hasFinal ? (
                  <video
                    src={`/api/media/${item.projectId}/final.mp4#t=0.5`}
                    preload="metadata"
                    muted
                    playsInline
                    className="aspect-video w-full border-b border-ink/30 bg-black object-cover"
                  />
                ) : (
                  <div className="grid aspect-video w-full place-items-center border-b border-ink/30 bg-paper font-mono text-[10px] tracking-[0.24em] text-grey">
                    本场未产出成片
                  </div>
                )}
                <span className="block flex-1 p-4">
                  <span className="block truncate text-[15px] font-black">{item.product ?? item.projectId}</span>
                  <span className="mt-1 block truncate font-mono text-[10px] tracking-[0.08em] text-grey">
                    {marketLabel(item.market)} · {item.createdAt?.slice(5, 16).replace("T", " ") ?? ""}
                    {item.demoMode === "replay" ? " · 回放" : ""}
                  </span>
                  <span
                    className={`stamp mt-2.5 !text-[14px] ${item.status === "COMPLETED" ? "stamp-ink" : ""}`}
                  >
                    {PROJECT_STATUS_ZH[item.status as keyof typeof PROJECT_STATUS_ZH] ?? item.status}
                    <small>
                      {item.status === "COMPLETED" ? "已交付" : item.status === "FAILED" ? "查看场记" : item.status === "STOPPED" ? "已停机" : "拍摄中"}
                    </small>
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <footer className="mt-auto border-t-2 border-ink px-5 py-3.5 md:px-10">
        <div className="mx-auto flex max-w-6xl justify-between font-mono text-[10px] tracking-[0.22em] text-grey">
          <span>ADPILOT · 往期广告片</span>
          <span className="hidden sm:inline">点开任意一支 · 回看拍摄全程</span>
        </div>
      </footer>
    </div>
  );
}
