import path from "node:path";
import { MEDIA_DIR, ensureDir } from "./paths";

/** URL ↔ filesystem mapping for everything under data/media.
 *  The UI only ever sees /api/media/... URLs. */

const URL_PREFIX = "/api/media/";

export function urlForMedia(absPath: string): string {
  const rel = path.relative(MEDIA_DIR, absPath);
  return `${URL_PREFIX}${rel.split(path.sep).join("/")}`;
}

export function localPathForMedia(url: string): string {
  if (!url.startsWith(URL_PREFIX)) throw new Error(`not a media url: ${url}`);
  const rel = url.slice(URL_PREFIX.length);
  const abs = path.normalize(path.join(MEDIA_DIR, rel));
  if (!abs.startsWith(path.normalize(MEDIA_DIR) + path.sep)) {
    throw new Error(`media url escapes media dir: ${url}`);
  }
  return abs;
}

export function mediaFile(projectId: string, name: string): string {
  return path.join(ensureDir(path.join(MEDIA_DIR, projectId)), name);
}
