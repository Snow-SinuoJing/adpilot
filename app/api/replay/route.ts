import { NextResponse } from "next/server";
import { listReplays, startReplay } from "@/lib/demo/replay";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ replays: listReplays() });
}

export async function POST(request: Request) {
  let body: { name?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!body.name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  try {
    const projectId = await startReplay(body.name);
    return NextResponse.json({ projectId }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "replay failed" },
      { status: 404 },
    );
  }
}
