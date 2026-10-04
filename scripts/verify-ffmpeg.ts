/**
 * Verifies that the project-local ffmpeg/ffprobe binaries work and can
 * encode the codecs the composition pipeline depends on (h264 + aac).
 */
import { execFileSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";

function run(bin: string, args: string[]): string {
  return execFileSync(bin, args, { encoding: "utf8" });
}

function main() {
  if (!ffmpegPath) throw new Error("ffmpeg-static binary not found");
  const ffprobePath = ffprobeStatic.path;

  const ffmpegVersion = run(ffmpegPath, ["-version"]).split("\n")[0];
  const ffprobeVersion = run(ffprobePath, ["-version"]).split("\n")[0];
  console.log(ffmpegVersion);
  console.log(ffprobeVersion);

  const encoders = run(ffmpegPath, ["-hide_banner", "-encoders"]);
  for (const codec of ["libx264", "aac"]) {
    if (!encoders.includes(codec)) {
      throw new Error(`required encoder missing: ${codec}`);
    }
    console.log(`encoder ok: ${codec}`);
  }

  const filters = run(ffmpegPath, ["-hide_banner", "-filters"]);
  for (const filter of ["drawtext", "scale", "concat", "amix"]) {
    if (!filters.includes(filter)) {
      throw new Error(`required filter missing: ${filter}`);
    }
    console.log(`filter ok: ${filter}`);
  }

  console.log("\nffmpeg environment OK");
}

main();
