import { NextResponse } from "next/server";
import { AdBriefSchema } from "@/lib/state/schema";
import { getStore } from "@/lib/state/store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = AdBriefSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid brief", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) },
      { status: 400 },
    );
  }

  const state = getStore().create(parsed.data);
  return NextResponse.json({ projectId: state.projectId, state }, { status: 201 });
}
