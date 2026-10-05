import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { ASSETS_DIR } from "@/lib/paths";
import { readLibrary, writeLibrary } from "@/lib/assets-library";

export const runtime = "nodejs";

/** PATCH /api/assets/[id] — edit description / tags (metadata drives
 *  search matching, so good tags = better retrieval). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { description?: string; tags?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const library = readLibrary();
  const entry = library.find((a) => a.id === id);
  if (!entry) return NextResponse.json({ error: "素材不存在" }, { status: 404 });

  if (typeof body.description === "string" && body.description.trim()) {
    entry.description = body.description.trim().slice(0, 500);
  }
  if (Array.isArray(body.tags)) {
    entry.tags = body.tags
      .map((t) => String(t).trim())
      .filter(Boolean)
      .slice(0, 20);
  }
  writeLibrary(library);
  return NextResponse.json({ updated: entry });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const library = readLibrary();
  const index = library.findIndex((a) => a.id === id);
  if (index === -1) return NextResponse.json({ error: "素材不存在" }, { status: 404 });

  const [removed] = library.splice(index, 1);
  writeLibrary(library);

  const file = path.join(ASSETS_DIR, removed.file);
  if (fs.existsSync(file)) fs.rmSync(file);
  return NextResponse.json({ removed: id });
}
