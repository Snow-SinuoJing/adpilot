import { NextResponse } from "next/server";
import { getStore } from "@/lib/state/store";
import { runProject } from "@/lib/runtime/orchestrator";

export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const state = getStore().get(id);
  if (!state) return NextResponse.json({ error: "project not found" }, { status: 404 });
  if (state.status === "COMPLETED" || state.status === "FAILED") {
    return NextResponse.json({ error: `project already ${state.status.toLowerCase()}` }, { status: 409 });
  }

  // Fire-and-forget: the orchestrator streams progress over SSE; this
  // endpoint must never block on external video generation.
  void runProject(id).catch((error) => {
    console.error(`[run] project ${id} crashed:`, error);
  });

  return NextResponse.json({ started: true }, { status: 202 });
}
