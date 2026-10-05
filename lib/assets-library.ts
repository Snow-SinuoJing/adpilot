import fs from "node:fs";
import path from "node:path";
import { ASSETS_DIR, ensureDir } from "@/lib/paths";

export interface AssetEntry {
  id: string;
  file: string;
  description: string;
  tags: string[];
  durationSec: number;
  origin?: "builtin" | "upload" | "segment";
  /** segmented parents are excluded from search (their children cover them) */
  hasSegments?: boolean;
  analysis?: "done" | "pending";
  /** segment children only */
  parentFile?: string;
  startTime?: number;
  endTime?: number;
}

export function readLibrary(): AssetEntry[] {
  const file = path.join(ensureDir(ASSETS_DIR), "assets.json");
  if (!fs.existsSync(file)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(raw) ? (raw as AssetEntry[]) : [];
  } catch {
    return [];
  }
}

export function writeLibrary(entries: AssetEntry[]): void {
  fs.writeFileSync(
    path.join(ensureDir(ASSETS_DIR), "assets.json"),
    JSON.stringify(entries, null, 2),
  );
}

export function assetUrl(entry: AssetEntry): string {
  return `/api/media/assets/${entry.file}`;
}
