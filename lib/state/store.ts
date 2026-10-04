import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  AdBriefSchema,
  ProjectStateSchema,
  type AdBrief,
  type ProjectState,
  type RuntimeEvent,
} from "./schema";
import { PROJECTS_DIR, ensureDir } from "@/lib/paths";

/**
 * MVP persistence: in-memory Map + one JSON file per project under
 * data/projects/ (design doc §4.4). The interface is deliberately narrow so
 * it can be swapped for Redis/Postgres without touching the Agent layer.
 */

type Listener = (event: RuntimeEvent) => void;

export class ProjectStore {
  private projects = new Map<string, ProjectState>();
  private listeners = new Map<string, Set<Listener>>();

  create(brief: AdBrief): ProjectState {
    const parsed = AdBriefSchema.parse(brief);
    const now = new Date().toISOString();
    const state: ProjectState = {
      projectId: `prj_${randomUUID().slice(0, 8)}`,
      createdAt: now,
      updatedAt: now,
      brief: parsed,
      scenes: [],
      status: "IDLE",
      decisions: [],
      events: [],
      runtime: {
        totalVideoGenerations: 0,
        totalRepairs: 0,
        directorSteps: 0,
      },
    };
    ProjectStateSchema.parse(state);
    this.projects.set(state.projectId, state);
    this.persist(state);
    return state;
  }

  get(projectId: string): ProjectState | undefined {
    if (this.projects.has(projectId)) return this.projects.get(projectId);
    const revived = this.loadFromDisk(projectId);
    if (revived) this.projects.set(projectId, revived);
    return revived;
  }

  /** The only way state ever mutates: apply a mutator to a draft, then
   *  schema-validate before committing. Invalid state never lands. */
  update(projectId: string, mutator: (draft: ProjectState) => void): ProjectState {
    const current = this.get(projectId);
    if (!current) throw new Error(`project not found: ${projectId}`);
    const draft = structuredClone(current);
    mutator(draft);
    draft.updatedAt = new Date().toISOString();
    const next = ProjectStateSchema.parse(draft);
    this.projects.set(projectId, next);
    this.persist(next);
    return next;
  }

  appendDecision(
    projectId: string,
    decision: { action: ProjectState["currentAction"] & string; sceneId?: string; reason: string },
  ) {
    this.update(projectId, (s) => {
      s.decisions.push({ at: new Date().toISOString(), ...decision });
    });
  }

  appendEvent(projectId: string, event: RuntimeEvent) {
    this.update(projectId, (s) => {
      s.events.push(event);
    });
    this.publish(projectId, event);
    recordReplaySnapshot(projectId, event);
  }

  /** Replay path: restore a recorded state verbatim (schema-validated),
   *  without the live-run bookkeeping. */
  replace(projectId: string, state: ProjectState) {
    const next = ProjectStateSchema.parse({ ...state, projectId });
    this.projects.set(projectId, next);
    this.persist(next);
    return next;
  }

  /** Replay path: push an already-recorded event to SSE subscribers. */
  publishEvent(projectId: string, event: RuntimeEvent) {
    this.publish(projectId, event);
  }

  subscribe(projectId: string, listener: Listener): () => void {
    const set = this.listeners.get(projectId) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(projectId, set);
    return () => set.delete(listener);
  }

  private publish(projectId: string, event: RuntimeEvent) {
    const set = this.listeners.get(projectId);
    if (!set) return;
    for (const listener of set) {
      try {
        listener(event);
      } catch {
        // a broken SSE consumer must never break the orchestrator
      }
    }
  }

  private fileFor(projectId: string): string {
    return path.join(ensureDir(PROJECTS_DIR), `${projectId}.json`);
  }

  private persist(state: ProjectState) {
    fs.writeFileSync(this.fileFor(state.projectId), JSON.stringify(state, null, 2));
  }

  private loadFromDisk(projectId: string): ProjectState | undefined {
    const file = this.fileFor(projectId);
    if (!fs.existsSync(file)) return undefined;
    try {
      return ProjectStateSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
    } catch {
      return undefined;
    }
  }
}

// Survive Next.js dev-mode hot reloads: keep one store per Node process.
const globalForStore = globalThis as unknown as { __adpilotStore?: ProjectStore };

export function getStore(): ProjectStore {
  if (!globalForStore.__adpilotStore) {
    globalForStore.__adpilotStore = new ProjectStore();
  }
  return globalForStore.__adpilotStore;
}

// ─── replay recording hook (design doc §17 Mode C) ──────────────────────────
// When RECORD_REPLAY_NAME is set, every state change of a live run is
// captured as {event, state} lines so the run can be replayed later.
import fsSync from "node:fs";
import pathSync from "node:path";
import { REPLAYS_DIR } from "@/lib/paths";

function recordReplaySnapshot(projectId: string, event: RuntimeEvent): void {
  const name = process.env.RECORD_REPLAY_NAME?.trim();
  if (!name) return;
  const store = getStore();
  const state = store.get(projectId);
  if (!state) return;
  const dir = pathSync.join(REPLAYS_DIR, name);
  fsSync.mkdirSync(dir, { recursive: true });
  fsSync.appendFileSync(
    pathSync.join(dir, "timeline.jsonl"),
    `${JSON.stringify({ event, state })}\n`,
  );
  if (event.type === "PROJECT_COMPLETED" || event.type === "ERROR") {
    const mediaSrc = pathSync.join(process.cwd(), "data", "media", projectId);
    if (fsSync.existsSync(mediaSrc)) {
      fsSync.cpSync(mediaSrc, pathSync.join(dir, "media", projectId), { recursive: true });
    }
    fsSync.writeFileSync(
      pathSync.join(dir, "meta.json"),
      JSON.stringify(
        { name, projectId, recordedAt: new Date().toISOString(), brief: state.brief },
        null,
        2,
      ),
    );
  }
}
