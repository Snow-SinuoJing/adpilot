import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";

const execFileAsync = promisify(execFile);

export const FFMPEG_BIN: string = ffmpegStatic ?? "ffmpeg";
export const FFPROBE_BIN: string = ffprobeStatic.path;

/** Runs the project-local ffmpeg. Throws with the stderr tail so callers
 *  can surface a useful MEDIA_PROCESSING error. */
export async function runFfmpeg(args: string[]): Promise<string> {
  try {
    const { stderr } = await execFileAsync(FFMPEG_BIN, ["-hide_banner", "-loglevel", "error", "-y", ...args]);
    return stderr;
  } catch (error) {
    const err = error as { stderr?: string; message?: string };
    const tail = (err.stderr ?? "").split("\n").slice(-6).join("\n").trim();
    throw new Error(tail || err.message || "ffmpeg failed");
  }
}

export async function probeDurationSec(file: string): Promise<number> {
  const { stdout } = await execFileAsync(FFPROBE_BIN, [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    file,
  ]);
  return Number.parseFloat(stdout.trim());
}

export async function fileExists(file: string): Promise<boolean> {
  const fs = await import("node:fs");
  return fs.existsSync(file);
}
