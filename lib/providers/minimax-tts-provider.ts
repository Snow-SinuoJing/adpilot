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

export function miniMaxTtsBody(input: TtsInput): Record<string, unknown> {
  const model = process.env.MINIMAX_TTS_MODEL?.trim() || "speech-02-hd";
  const voice = process.env.MINIMAX_TTS_VOICE?.trim() || "male-qn-qingse";
  return {
    model,
    text: input.text,
    stream: false,
    voice_setting: { voice, speed: 1.0, pitch: 0.0 },
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
