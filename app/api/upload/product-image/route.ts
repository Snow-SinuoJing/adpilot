import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { MEDIA_DIR, ensureDir } from "@/lib/paths";

export const runtime = "nodejs";

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 20 * 1024 * 1024;

/** 产品参考图上传（用户反馈 #3）：供视频生成 API 以图生图地锚定
 *  产品外观。保存在 data/media/product-refs/ 下，通过媒体路由访问。 */
export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "invalid form data" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "未收到文件" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "图片过大（>20MB）" }, { status: 413 });
  }
  const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!["jpg", "jpeg", "png", "webp"].includes(ext) && !ALLOWED.has(file.type)) {
    return NextResponse.json({ error: "仅支持 jpg / png / webp 图片" }, { status: 415 });
  }

  const dir = ensureDir(path.join(MEDIA_DIR, "product-refs"));
  const name = `ref_${randomUUID().slice(0, 10)}.${ext === "jpeg" ? "jpg" : ext || "jpg"}`;
  fs.writeFileSync(path.join(dir, name), Buffer.from(await file.arrayBuffer()));

  return NextResponse.json({ url: `/api/media/product-refs/${name}` }, { status: 201 });
}
