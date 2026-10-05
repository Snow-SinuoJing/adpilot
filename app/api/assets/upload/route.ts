import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ASSETS_DIR, ensureDir } from "@/lib/paths";
import { runFfmpeg, probeDurationSec, FFPROBE_BIN } from "@/lib/ffmpeg";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readLibrary, writeLibrary } from "@/lib/assets-library";

const execFileAsync = promisify(execFile);

export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 300 * 1024 * 1024;

/** Upload one or more video clips into the asset library. Non-mp4 inputs
 *  are transcoded to a browser-safe h264 mp4; every clip gets probed for
 *  duration so search/matching stays metadata-driven. */
export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "invalid form data" }, { status: 400 });
  }

  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "no files uploaded" }, { status: 400 });
  }
  for (const file of files) {
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: `文件过大（>300MB）: ${file.name}` }, { status: 413 });
    }
  }

  const dir = ensureDir(ASSETS_DIR);
  const tmpDir = ensureDir(path.join(dir, ".upload-tmp"));
  const library = readLibrary();
  const added: string[] = [];

  for (const file of files) {
    const id = `up_${randomUUID().slice(0, 8)}`;
    const safeName = file.name.replace(/[^a-zA-Z0-9._\-\u4e00-\u9fff]/g, "_");
    const isMp4 = /\.mp4$/i.test(safeName) || file.type === "video/mp4";

    const rawPath = path.join(tmpDir, `${id}_raw`);
    fs.writeFileSync(rawPath, Buffer.from(await file.arrayBuffer()));

    const dest = path.join(dir, `${id}.mp4`);
    try {
      if (isMp4) {
        // remux + faststart so the browser can stream it immediately
        await runFfmpeg(["-i", rawPath, "-c", "copy", "-movflags", "+faststart", dest]);
      } else {
        await runFfmpeg([
          "-i", rawPath,
          "-c:v", "libx264", "-preset", "veryfast", "-crf", "22",
          "-c:a", "aac", "-b:a", "128k",
          "-pix_fmt", "yuv420p", "-movflags", "+faststart",
          dest,
        ]);
      }
    } catch (error) {
      fs.rmSync(rawPath, { force: true });
      return NextResponse.json(
        { error: `转码失败：${safeName}（${error instanceof Error ? error.message.slice(0, 120) : "未知错误"}）` },
        { status: 422 },
      );
    }
    fs.rmSync(rawPath, { force: true });

    const durationSec = Math.max(1, Math.round((await probeDurationSec(dest)) * 10) / 10);
    let orientation = "横屏";
    try {
      const { stdout } = await execFileAsync(FFPROBE_BIN, [
        "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height", "-of", "csv=p=0", dest,
      ]);
      const [w, h] = stdout.trim().split(",").map(Number);
      if (w && h) orientation = h >= w ? "竖屏" : "横屏";
    } catch {
      // probe failure is non-fatal
    }

    library.push({
      id,
      file: `${id}.mp4`,
      description: `${safeName}（用户上传 · ${orientation}）`,
      tags: ["uploaded", "上传", orientation],
      durationSec,
      origin: "upload",
    });
    added.push(id);
  }

  writeLibrary(library);
  return NextResponse.json({ added, total: library.length }, { status: 201 });
}
