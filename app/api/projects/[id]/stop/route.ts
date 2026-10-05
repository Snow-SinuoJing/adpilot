import { NextResponse } from "next/server";
import { getStore } from "@/lib/state/store";
import { requestStop } from "@/lib/runtime/orchestrator";

export const runtime = "nodejs";

/** 用户随时停止当前任务（用户反馈 #5）：当前批次完成后优雅终止，
 *  已完成的场景与素材保留。 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const state = getStore().get(id);
  if (!state) return NextResponse.json({ error: "项目不存在" }, { status: 404 });

  const stopped = requestStop(id);
  if (!stopped) {
    return NextResponse.json({ error: "项目已结束，无需停止" }, { status: 409 });
  }
  return NextResponse.json({ stopped: true });
}
