import fs from "node:fs";
import path from "node:path";
import type { TtsInput, TTSProvider } from "./tts-provider";

/**
 * MiniMax TTS (t2a_v2): non-streaming responses return hex-encoded audio
 * inside JSON. Model / voice / endpoint are env-driven.
 */

interface MiniMaxBaseResp {
  status_code?: number;
  status_msg?: string;
}

/** 语言 → MiniMax 音色（以实测可用的音色为底，env 可整体覆盖或按语言覆盖）。 */
export const VOICE_BY_LOCALE: Record<string, string> = {
  zh: "male-qn-qingse",
  en: "Friendly_Person",
  yue: "Friendly_Person", // 粤语音色以平台列表为准：MINIMAX_TTS_VOICE_yue 覆盖
  pt: "Friendly_Person", // 葡语同上
  es: "Friendly_Person",
};

export function voiceForLocale(locale?: string): string {
  if (!locale) return process.env.MINIMAX_TTS_VOICE?.trim() || "Friendly_Person";
  const perLang = process.env[`MINIMAX_TTS_VOICE_${locale}`]?.trim();
  if (perLang) return perLang;
  return process.env.MINIMAX_TTS_VOICE?.trim() || VOICE_BY_LOCALE[locale] || "Friendly_Person";
}

export function miniMaxTtsBody(input: TtsInput): Record<string, unknown> {
  const model = process.env.MINIMAX_TTS_MODEL?.trim() || "speech-02-hd";
  return {
    model,
    text: input.text,
    stream: false,
    voice_setting: { voice_id: voiceForLocale(input.locale), speed: 1.0 },
    audio_setting: { sample_rate: 32_000, bitrate: 128_000, format: "mp3", channel: 1 },
  };
}

export function decodeMiniMaxAudio(raw: unknown): Buffer {
  const body = raw as { data?: { audio?: string }; base_resp?: MiniMaxBaseResp };
  const code = body.base_resp?.status_code;
  if (code !== undefined && code !== 0) {
    throw new Error(`minimax tts failed: ${body.base_resp?.status_msg ?? `code ${code}`}`);
  }
  const hex = body.data?.audio;
  if (!hex) throw new Error("minimax tts returned no audio payload");
  return Buffer.from(hex, "hex");
}

export class MiniMaxTtsProvider implements TTSProvider {
  readonly name = "minimax";
  private readonly baseUrl = process.env.MINIMAX_BASE_URL?.trim() || "https://api.minimaxi.com";
  private readonly apiKey = process.env.MINIMAX_API_KEY?.trim() ?? "";

  async synthesize(input: TtsInput): Promise<void> {
    const response = await fetch(`${this.baseUrl}/v1/t2a_v2`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(miniMaxTtsBody(input)),
      signal: AbortSignal.timeout(60_000),
    });
    const audio = decodeMiniMaxAudio(await response.json());
    fs.mkdirSync(path.dirname(input.outPath), { recursive: true });
    fs.writeFileSync(input.outPath, audio);
  }
}
