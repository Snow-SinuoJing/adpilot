import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { TtsInput, TTSProvider } from "./tts-provider";
import { runFfmpeg } from "@/lib/ffmpeg";
import { ensureDir } from "@/lib/paths";

const execFileAsync = promisify(execFile);

/**
 * FakeTtsProvider — real speech without any API key.
 * Uses macOS `say` when available (converts aiff → mp3); falls back to a
 * calibrated silent track so composition never breaks.
 */

async function hasSay(): Promise<boolean> {
  try {
    await execFileAsync("say", ["-v", "?"], { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

/** Rough speech duration model (~2.6 words/sec) for the silent fallback. */
export function estimateSpeechSec(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1.5, Math.round((words / 2.6) * 10) / 10);
}

export function silentTrackArgs(durationSec: number, outPath: string): string[] {
  return [
    "-f", "lavfi",
    "-i", `anullsrc=r=44100:cl=mono`,
    "-t", String(durationSec),
    "-c:a", "libmp3lame",
    "-b:a", "128k",
    outPath,
  ];
}

/** macOS `say` 系统语音（缺失时回退系统默认声音）。 */
export const SAY_VOICE_BY_LOCALE: Record<string, string> = {
  zh: "Tingting",
  yue: "Sinji",
  en: "Samantha",
  pt: "Luciana",
  es: "Mónica",
};

export class FakeTtsProvider implements TTSProvider {
  readonly name = "fake";

  async synthesize(input: TtsInput): Promise<void> {
    fs.mkdirSync(path.dirname(input.outPath), { recursive: true });

    if (await hasSay()) {
      const tmpDir = ensureDir(path.join(os.tmpdir(), "adpilot-fake-tts"));
      const aiff = path.join(tmpDir, `${path.basename(input.outPath, ".mp3")}.aiff`);
      const sayVoice = SAY_VOICE_BY_LOCALE[input.locale ?? "en"];
      const sayArgs = sayVoice ? ["-v", sayVoice, "-o", aiff, input.text] : ["-o", aiff, input.text];
      await execFileAsync("say", sayArgs);
      await runFfmpeg(["-i", aiff, "-c:a", "libmp3lame", "-b:a", "128k", input.outPath]);
      return;
    }

    await runFfmpeg(silentTrackArgs(estimateSpeechSec(input.text), input.outPath));
  }
}
