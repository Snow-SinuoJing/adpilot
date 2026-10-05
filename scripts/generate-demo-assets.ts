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
  // ── 适合 HOOK：玩游戏的真实反应 ──
  { id: "asset_001", file: "reaction-woman-lights-up.mp4", description: "Young woman's face lights up with excitement while playing a mobile game on her phone on the sofa, vertical 年轻女性玩手机游戏时表情惊喜发光", tags: ["reaction", "face", "mobile", "phone", "vertical", "purpose:hook", "反应", "表情", "手机", "游戏", "女性", "笑容"], durationSec: 5, colors: ["0x7c3aed", "0xec4899"] },
  { id: "asset_002", file: "reaction-closeup-smile.mp4", description: "Close-up of a player smiling at a phone screen with colorful reflections, energetic 玩家看手机屏幕微笑特写，色彩明快", tags: ["reaction", "close-up", "player", "smiling", "phone", "colorful", "energetic", "purpose:hook", "反应", "特写", "微笑", "手机", "色彩", "玩家"], durationSec: 4, colors: ["0x2563eb", "0x22d3ee"] },
  { id: "asset_003", file: "reaction-friends-laugh.mp4", description: "Two friends laughing and reacting to a mobile game together on a couch 两个朋友在沙发上一起玩手机游戏大笑", tags: ["reaction", "friends", "laughing", "mobile", "couch", "purpose:hook", "朋友", "大笑", "一起", "沙发", "反应"], durationSec: 6, colors: ["0xdb2777", "0xf59e0b"] },

  // ── 适合 CTA：胜利庆祝 + 下载手势 ──
  { id: "asset_004", file: "cta-winner-fist.mp4", description: "Happy player celebrates winning a game level with a genuine smile and a fist pump 玩家赢得游戏关卡后真诚庆祝握拳", tags: ["celebration", "winning", "level", "smile", "fist-pump", "purpose:cta", "庆祝", "获胜", "关卡", "笑容", "拳头"], durationSec: 5, colors: ["0x16a34a", "0x84cc16"] },
  { id: "asset_005", file: "cta-thumb-download.mp4", description: "Thumb visibly taps the download button area on a smartphone, close-up, upbeat 拇指明显点击手机下载按钮特写", tags: ["thumb", "taps", "download", "smartphone", "close-up", "purpose:cta", "拇指", "点击", "下载", "手机", "特写"], durationSec: 4, colors: ["0x0891b2", "0x7c3aed"] },
  { id: "asset_006", file: "cta-celebration-smile.mp4", description: "Winner celebration with genuine smile, phone held in hand, closing energy 胜利者手持手机真诚庆祝，收尾氛围", tags: ["celebration", "winner", "smile", "phone", "closing", "purpose:cta", "庆祝", "胜利", "笑容", "手机", "收尾"], durationSec: 5, colors: ["0xea580c", "0xfacc15"] },

  // ── 对 PROOF 场景（消除连击/蜕变过程）刻意不匹配 ──
  { id: "asset_007", file: "city-timelapse.mp4", description: "City night traffic timelapse, vertical 城市夜景车流延时", tags: ["city", "timelapse", "night", "城市", "夜景", "车流"], durationSec: 6, colors: ["0x1e293b", "0x64748b"] },
  { id: "asset_008", file: "coffee-morning.mp4", description: "Coffee cup on a wooden desk in soft morning light 晨光中木桌上的咖啡杯", tags: ["coffee", "desk", "lifestyle", "morning", "咖啡", "桌", "晨光"], durationSec: 5, colors: ["0x78350f", "0xd97706"] },
  { id: "asset_009", file: "cat-toy.mp4", description: "Playful cat batting a toy close-up 猫咪玩玩具特写", tags: ["cat", "pets", "playful", "close-up", "猫", "宠物", "玩耍"], durationSec: 5, colors: ["0x334155", "0xf97316"] },
  { id: "asset_010", file: "typing-laptop.mp4", description: "Hands typing on a laptop in an office 办公室里双手敲笔记本电脑", tags: ["hands", "typing", "laptop", "office", "双手", "打字", "电脑", "办公"], durationSec: 5, colors: ["0x0f172a", "0x38bdf8"] },
  { id: "asset_011", file: "sunset-beach.mp4", description: "Aerial sunset over beach waves, travel vibes 海滩日落航拍", tags: ["sunset", "beach", "travel", "aerial", "日落", "海滩", "航拍"], durationSec: 6, colors: ["0x7c2d12", "0xfb923c"] },
  { id: "asset_012", file: "street-dance.mp4", description: "Guy dancing on the street, funny energetic moves 街头舞蹈，搞笑有活力", tags: ["dance", "street", "funny", "energetic", "舞蹈", "街头", "搞笑"], durationSec: 5, colors: ["0x4c1d95", "0xf472b6"] },
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
    origin: "builtin" as const,
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
