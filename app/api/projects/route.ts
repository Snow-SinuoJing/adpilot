import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { AdBriefSchema } from "@/lib/state/schema";
import { getStore } from "@/lib/state/store";
import { PROJECTS_DIR } from "@/lib/paths";

export const runtime = "nodejs";

/** Recent projects for the home page history section — read from disk so
 *  it survives dev-server restarts. */
export async function GET() {
  const dir = PROJECTS_DIR;
  if (!fs.existsSync(dir)) return NextResponse.json({ projects: [] });
  const projects = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        const s = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
        return {
          projectId: s.projectId as string,
          product: s.brief?.productName as string | undefined,
          market: s.brief?.market as string | undefined,
          status: s.status as string | undefined,
          createdAt: s.createdAt as string | undefined,
          hasFinal: Boolean(s.finalVideoUrl),
          demoMode: s.runtime?.demoMode as string | undefined,
          scenes: (s.scenes ?? []).map((sc: { id: string; status: string }) => ({ id: sc.id, status: sc.status })),
        };
      } catch {
        return null;
      }
    })
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
    .slice(0, 12);
  return NextResponse.json({ projects });
}

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
