import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { ASSETS_DIR } from "@/lib/paths";
import { readLibrary, writeLibrary } from "@/lib/assets-library";
import { analyzeAssetInBackground } from "@/lib/tools/analyze-asset";

export const runtime = "nodejs";

/** PATCH /api/assets/[id] — 编辑描述/标签（标签直接影响检索匹配）。 */
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
    entry.tags = body.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 20);
  }
  writeLibrary(library);
  return NextResponse.json({ updated: entry });
}

/** POST /api/assets/[id] — 对已有素材（重新）做镜头拆分 + 视觉描述分析（后台执行）。 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const library = readLibrary();
  const entry = library.find((a) => a.id === id);
  if (!entry) return NextResponse.json({ error: "素材不存在" }, { status: 404 });
  if (entry.parentFile) return NextResponse.json({ error: "切片无需分析" }, { status: 400 });

  entry.analysis = "pending";
  writeLibrary(library);

  void analyzeAssetInBackground(id).catch((error) => {
    console.warn(`[analyze] ${id} failed:`, error);
  });

  return NextResponse.json({ started: true }, { status: 202 });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const library = readLibrary();
  const index = library.findIndex((a) => a.id === id);
  if (index === -1) return NextResponse.json({ error: "素材不存在" }, { status: 404 });

  const [removed] = library.splice(index, 1);
  // 删除父素材时一并删除其全部子切片（共享同一物理文件）
  let removedChildren = 0;
  if (!removed.parentFile) {
    const before = library.length;
    const kept = library.filter((a) => a.parentFile !== removed.file);
    removedChildren = before - kept.length;
    library.length = 0;
    library.push(...kept);
  }
  writeLibrary(library);

  // 切片与父素材共享文件：只有当没有其它条目引用该文件时才删除物理文件
  const stillReferenced = library.some((a) => a.file === removed.file);
  if (!stillReferenced) {
    const file = path.join(ASSETS_DIR, removed.file);
    if (fs.existsSync(file)) fs.rmSync(file);
  }
  void removedChildren;
  return NextResponse.json({ removed: id, removedChildren });
}
