import { NextResponse } from "next/server";
import { getStore } from "@/lib/state/store";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const state = getStore().get(id);
  if (!state) return NextResponse.json({ error: "project not found" }, { status: 404 });
  return NextResponse.json({ state });
}
