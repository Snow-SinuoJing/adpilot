import path from "node:path";

/** All runtime data lives under <repo>/data so it can be swapped for
 *  Redis / object storage later without touching the Agent layer.
 *  ADPILOT_DATA_DIR overrides the root (used by tests for isolation). */
export const DATA_DIR = path.resolve(
  process.env.ADPILOT_DATA_DIR ?? path.join(process.cwd(), "data"),
);

export const ASSETS_DIR = path.join(DATA_DIR, "assets");
export const CACHE_DIR = path.join(DATA_DIR, "cache");
export const MEDIA_DIR = path.join(DATA_DIR, "media");
export const PROJECTS_DIR = path.join(DATA_DIR, "projects");
export const REPLAYS_DIR = path.join(DATA_DIR, "replays");

export function projectDir(projectId: string): string {
  return path.join(MEDIA_DIR, projectId);
}

export function ensureDir(dir: string): string {
  const fs = require("node:fs") as typeof import("node:fs");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
