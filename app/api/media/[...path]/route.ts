import fs from "node:fs";
import path from "node:path";
import { MEDIA_DIR } from "@/lib/paths";

export const runtime = "nodejs";

const CONTENT_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

/** Serves everything under data/media (generated videos, frames, voiceovers)
 *  as /api/media/<relative-path>. Path traversal is rejected. */
export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path: segments } = await params;
  const rel = segments.map(decodeURIComponent).join("/");
  const abs = path.normalize(path.join(MEDIA_DIR, rel));

  if (!abs.startsWith(path.normalize(MEDIA_DIR) + path.sep)) {
    return new Response("forbidden", { status: 403 });
  }
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    return new Response("not found", { status: 404 });
  }

  const type = CONTENT_TYPES[path.extname(abs).toLowerCase()] ?? "application/octet-stream";
  const stat = fs.statSync(abs);
  const buffer = fs.readFileSync(abs);

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": type,
      "Content-Length": String(stat.size),
      "Cache-Control": "no-store",
      "Accept-Ranges": "bytes",
    },
  });
}
