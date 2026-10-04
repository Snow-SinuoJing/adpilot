import fs from "node:fs";
import path from "node:path";
import { ASSETS_DIR, ensureDir } from "../lib/paths";

/**
 * Demo asset library (design doc §15): 12 synthetic vertical clips with
 * explainable metadata. CURATED so that in the standard demo run:
 *   S1 (HOOK — reaction)  → hits reaction clips
 *   S3 (CTA — celebrate/download) → hits celebration clips
 *   S2 (PROOF — level-progression cascade) → NO real match → AI generation
 * Regenerate anytime with `npm run assets`.
 */

export interface LibraryEntry {
  id: string;
  file: string;
  description: string;
  tags: string[];
  durationSec: number;
  colors: [string, string];
}

export const LIBRARY: LibraryEntry[] = [
  // ── HOOK-friendly: face reactions while playing ──
  { id: "asset_001", file: "reaction-woman-lights-up.mp4", description: "Young woman's face lights up with excitement while playing a mobile game on her phone on the sofa, vertical", tags: ["reaction", "face", "mobile", "phone", "vertical", "purpose:hook"], durationSec: 5, colors: ["0x7c3aed", "0xec4899"] },
  { id: "asset_002", file: "reaction-closeup-smile.mp4", description: "Close-up of a player smiling at a phone screen with colorful reflections, energetic", tags: ["reaction", "close-up", "player", "smiling", "phone", "colorful", "energetic", "purpose:hook"], durationSec: 4, colors: ["0x2563eb", "0x22d3ee"] },
  { id: "asset_003", file: "reaction-friends-laugh.mp4", description: "Two friends laughing and reacting to a mobile game together on a couch", tags: ["reaction", "friends", "laughing", "mobile", "couch", "purpose:hook"], durationSec: 6, colors: ["0xdb2777", "0xf59e0b"] },

  // ── CTA-friendly: winning + download gestures ──
  { id: "asset_004", file: "cta-winner-fist.mp4", description: "Happy player celebrates winning a game level with a genuine smile and a fist pump", tags: ["celebration", "winning", "level", "smile", "fist-pump", "purpose:cta"], durationSec: 5, colors: ["0x16a34a", "0x84cc16"] },
  { id: "asset_005", file: "cta-thumb-download.mp4", description: "Thumb visibly taps the download button area on a smartphone, close-up, upbeat", tags: ["thumb", "taps", "download", "smartphone", "close-up", "purpose:cta"], durationSec: 4, colors: ["0x0891b2", "0x7c3aed"] },
  { id: "asset_006", file: "cta-celebration-smile.mp4", description: "Winner celebration with genuine smile, phone held in hand, closing energy", tags: ["celebration", "winner", "smile", "phone", "closing", "purpose:cta"], durationSec: 5, colors: ["0xea580c", "0xfacc15"] },

  // ── deliberate non-matches for the PROOF scene (transformation/cascade) ──
  { id: "asset_007", file: "city-timelapse.mp4", description: "City night traffic timelapse, vertical", tags: ["city", "timelapse", "night"], durationSec: 6, colors: ["0x1e293b", "0x64748b"] },
  { id: "asset_008", file: "coffee-morning.mp4", description: "Coffee cup on a wooden desk in soft morning light", tags: ["coffee", "desk", "lifestyle", "morning"], durationSec: 5, colors: ["0x78350f", "0xd97706"] },
  { id: "asset_009", file: "cat-toy.mp4", description: "Playful cat batting a toy close-up", tags: ["cat", "pets", "playful", "close-up"], durationSec: 5, colors: ["0x334155", "0xf97316"] },
  { id: "asset_010", file: "typing-laptop.mp4", description: "Hands typing on a laptop in an office", tags: ["hands", "typing", "laptop", "office"], durationSec: 5, colors: ["0x0f172a", "0x38bdf8"] },
  { id: "asset_011", file: "sunset-beach.mp4", description: "Aerial sunset over beach waves, travel vibes", tags: ["sunset", "beach", "travel", "aerial"], durationSec: 6, colors: ["0x7c2d12", "0xfb923c"] },
  { id: "asset_012", file: "street-dance.mp4", description: "Guy dancing on the street, funny energetic moves", tags: ["dance", "street", "funny", "energetic"], durationSec: 5, colors: ["0x4c1d95", "0xf472b6"] },
];

export function buildAssetArgs(entry: LibraryEntry, dest: string): string[] {
  const [c0, c1] = entry.colors;
  const label = `${entry.id} · LIBRARY CLIP`.replace(/([':])/g, "\\$1");
  return [
    "-f", "lavfi",
    "-i", `gradients=size=1080x1920:duration=${entry.durationSec}:speed=0.06:c0=${c0}:c1=${c1}`,
    "-vf",
    `format=yuv420p,drawtext=text='${label}':fontcolor=white:fontsize=48:x=(w-text_w)/2:y=h*0.45:borderw=4:bordercolor=black@0.85`,
    "-r", "30",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    dest,
  ];
}

export function main() {
  const dir = ensureDir(ASSETS_DIR);
  const manifest = LIBRARY.map((entry) => ({
    id: entry.id,
    file: entry.file,
    description: entry.description,
    tags: entry.tags,
    durationSec: entry.durationSec,
  }));

  for (const entry of LIBRARY) {
    const dest = path.join(dir, entry.file);
    process.stdout.write(`rendering ${entry.file}… `);
    runFfmpegSync(buildAssetArgs(entry, dest));
    console.log("ok");
  }

  fs.writeFileSync(path.join(dir, "assets.json"), JSON.stringify(manifest, null, 2));
  console.log(`\nwrote ${LIBRARY.length} clips + assets.json → ${dir}`);
}

// tiny sync wrapper: script-style execution, one clip at a time
function runFfmpegSync(args: string[]): void {
  const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
  const ffmpegStatic = require("ffmpeg-static") as string;
  try {
    execFileSync(ffmpegStatic, ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "pipe" });
  } catch (error) {
    const err = error as { stderr?: string };
    throw new Error((err.stderr ?? "").split("\n").slice(-4).join("\n") || "ffmpeg failed");
  }
}

if (require.main === module) main();
