"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AdBrief } from "@/lib/state/schema";
import { DEMO_BRIEF } from "@/lib/demo/demo-brief";

const EMPTY_FORM = {
  productName: "",
  productDescription: "",
  market: "",
  audience: "",
  platform: "TikTok" as AdBrief["platform"],
  durationSec: 15 as AdBrief["durationSec"],
  additionalRequirement: "",
};

export function BriefForm() {
  const router = useRouter();
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replays, setReplays] = useState<Array<{ name: string; product?: string }>>([]);

  useEffect(() => {
    fetch("/api/replay")
      .then((r) => r.json())
      .then((body) => setReplays(body.replays ?? []))
      .catch(() => {});
  }, []);

  const startReplay = async (name: string) => {
    const response = await fetch("/api/replay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const body = await response.json();
    if (response.ok) router.push(`/project/${body.projectId}`);
  };

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
      additionalRequirement: DEMO_BRIEF.additionalRequirement ?? "",
    });
    setError(null);
  };

  const submit = async () => {
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
        ...(form.additionalRequirement.trim() ? { additionalRequirement: form.additionalRequirement.trim() } : {}),
      };

      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(brief),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "failed to create project");

      router.push(`/project/${body.projectId}?autostart=1`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    }
  };

  const valid = form.productName && form.productDescription && form.market && form.audience;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center gap-6 px-6 py-12">
      <header className="space-y-2">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-indigo-500 font-black text-white">A</span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">AdPilot</h1>
            <p className="text-sm text-zinc-400">Self-Repairing Agentic Ad Studio</p>
          </div>
        </div>
        <p className="text-sm leading-relaxed text-zinc-400">
          Submit a brief. A Creative Director agent plans 3 scenes, decides between library
          footage and AI generation, QA-checks every generated scene with a multimodal critic,
          and repairs failures locally — down to one final MP4.
        </p>
      </header>

      <div className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Ad Brief</h2>
          <button
            type="button"
            onClick={loadDemo}
            className="rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-3 py-1.5 text-xs font-medium text-indigo-300 transition hover:bg-indigo-500/20"
          >
            Load Demo Brief
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Product" className="col-span-2">
            <input className={inputClass} value={form.productName} onChange={(e) => set("productName", e.target.value)} placeholder="Tile Blitz" />
          </Field>
          <Field label="Product Description" className="col-span-2">
            <textarea className={inputClass} rows={3} value={form.productDescription} onChange={(e) => set("productDescription", e.target.value)} placeholder="A hyper-casual tile-matching puzzle game…" />
          </Field>
          <Field label="Market">
            <input className={inputClass} value={form.market} onChange={(e) => set("market", e.target.value)} placeholder="Brazil" />
          </Field>
          <Field label="Audience">
            <input className={inputClass} value={form.audience} onChange={(e) => set("audience", e.target.value)} placeholder="casual mobile players 18-34" />
          </Field>
          <Field label="Platform">
            <select className={inputClass} value={form.platform} onChange={(e) => set("platform", e.target.value as AdBrief["platform"])}>
              <option>TikTok</option>
              <option>Reels</option>
              <option>Shorts</option>
            </select>
          </Field>
          <Field label="Duration">
            <select className={inputClass} value={form.durationSec} onChange={(e) => set("durationSec", Number(e.target.value) as AdBrief["durationSec"])}>
              <option value={15}>15s</option>
              <option value={20}>20s</option>
            </select>
          </Field>
          <Field label="Additional Requirement" className="col-span-2">
            <input className={inputClass} value={form.additionalRequirement} onChange={(e) => set("additionalRequirement", e.target.value)} placeholder="optional" />
          </Field>
        </div>

        {error && (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>
        )}

        <button
          type="button"
          disabled={!valid || loading}
          onClick={submit}
          className="w-full rounded-xl bg-indigo-500 py-2.5 font-semibold text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? "Creating…" : "Create Campaign"}
        </button>

        {replays.length > 0 && (
          <div className="border-t border-zinc-800 pt-3">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-zinc-600">
              Offline fallback · replay a recorded real run
            </p>
            <div className="flex flex-wrap gap-2">
              {replays.map((replay) => (
                <button
                  key={replay.name}
                  type="button"
                  onClick={() => void startReplay(replay.name)}
                  className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-300 transition hover:bg-amber-500/20"
                >
                  ▶ {replay.name}
                  {replay.product ? ` · ${replay.product}` : ""}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
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
