import { NextResponse } from "next/server";
import { readLibrary, assetUrl } from "@/lib/assets-library";

export const runtime = "nodejs";

export async function GET() {
  const assets = readLibrary().map((entry) => ({ ...entry, url: assetUrl(entry) }));
  return NextResponse.json({ assets });
}
