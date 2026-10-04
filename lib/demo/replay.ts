import fs from "node:fs";
import path from "node:path";
import type { ProjectState, RuntimeEvent } from "@/lib/state/schema";
import { ProjectStateSchema } from "@/lib/state/schema";
import { getStore } from "@/lib/state/store";
import { REPLAYS_DIR, MEDIA_DIR, ensureDir } from "@/lib/paths";

/**
 * Replay (design doc §17 Mode C).
 * A recorded run = timeline of {event, state} snapshots + its media files.
 * Playback re-emits events on a compressed schedule and marks the UI
 * "Replay of previous real run" — it never pretends to be a live call.
 */

export function listReplays(): Array<{ name: string; recordedAt?: string; product?: string }> {
  if (!fs.existsSync(REPLAYS_DIR)) return [];
  return fs
    .readdirSync(REPLAYS_DIR)
    .filter((name) => fs.existsSync(path.join(REPLAYS_DIR, name, "timeline.jsonl")))
    .map((name) => {
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(REPLAYS_DIR, name, "meta.json"), "utf8"));
        return { name, recordedAt: meta.recordedAt, product: meta.brief?.productName };
      } catch {
        return { name };
      }
    });
}

function remapState(state: ProjectState, newProjectId: string, oldProjectId: string): ProjectState {
  const remapped = JSON.parse(
    JSON.stringify(state).split(`/api/media/${oldProjectId}/`).join(`/api/media/${newProjectId}/`),
  ) as ProjectState;
  remapped.projectId = newProjectId;
  remapped.createdAt = new Date().toISOString();
  remapped.updatedAt = new Date().toISOString();
  remapped.runtime.demoMode = "replay";
  return ProjectStateSchema.parse(remapped);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function startReplay(name: string): Promise<string> {
  const dir = path.join(REPLAYS_DIR, name);
  const timelineFile = path.join(dir, "timeline.jsonl");
  if (!fs.existsSync(timelineFile)) throw new Error(`replay not found: ${name}`);

  const lines = fs.readFileSync(timelineFile, "utf8").trim().split("\n");
  const entries = lines.map((line) => {
    const parsed = JSON.parse(line) as { event: RuntimeEvent; state: ProjectState };
    return { event: parsed.event, state: parsed.state };
  });
  if (entries.length === 0) throw new Error(`replay ${name} is empty`);

  const originalId = entries[0].state.projectId;
  const store = getStore();
  const replayProject = store.create(entries[0].state.brief);
  const replayId = replayProject.projectId;

  // stage media under the new project id so URLs resolve during playback
  const recordedMedia = path.join(dir, "media", originalId);
  if (fs.existsSync(recordedMedia)) {
    fs.cpSync(recordedMedia, path.join(ensureDir(MEDIA_DIR), replayId), { recursive: true });
  }

  const speed = Number(process.env.REPLAY_SPEED ?? 6);
  void (async () => {
    let previousAt = new Date(entries[0].event.timestamp).getTime();
    for (const entry of entries) {
      const at = new Date(entry.event.timestamp).getTime();
      const gap = Math.min(Math.max(((at - previousAt) / speed), 150), 1500);
      previousAt = at;
      await sleep(gap);

      const state = remapState(entry.state, replayId, originalId);
      store.replace(replayId, state);
      store.publishEvent(replayId, entry.event);
    }
  })().catch((error) => {
    console.error(`[replay] ${name} failed:`, error);
  });

  return replayId;
}
