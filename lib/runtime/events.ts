import { randomUUID } from "node:crypto";
import {
  RuntimeEventSchema,
  type RuntimeActor,
  type RuntimeEvent,
  type RuntimeEventType,
} from "@/lib/state/schema";

export function makeEvent(input: {
  type: RuntimeEventType;
  actor: RuntimeActor;
  title: string;
  sceneId?: string;
  detail?: string;
  data?: Record<string, unknown>;
}): RuntimeEvent {
  return RuntimeEventSchema.parse({
    id: `evt_${randomUUID().slice(0, 8)}`,
    timestamp: new Date().toISOString(),
    ...input,
  });
}

/** Format used by the Agent Activity timeline in the UI. */
export function formatEventLine(event: RuntimeEvent): string {
  const clock = event.timestamp.slice(11, 19);
  const scene = event.sceneId ? ` ${event.sceneId}` : "";
  return `${clock} ${event.actor.padEnd(8)}${scene} ${event.title}`;
}
