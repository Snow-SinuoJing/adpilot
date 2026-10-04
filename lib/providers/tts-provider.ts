/**
 * TTSProvider abstraction (design doc §4.3). v1 real provider: MiniMax;
 * offline provider: macOS `say` with an ffmpeg silent-track fallback.
 */
import { MiniMaxTtsProvider } from "./minimax-tts-provider";
import { FakeTtsProvider } from "./fake-tts-provider";

export interface TtsInput {
  text: string;
  /** e.g. "pt-BR" — passed through to providers that localize voice choice */
  locale?: string;
  outPath: string; // .mp3
}

export interface TTSProvider {
  readonly name: string;
  synthesize(input: TtsInput): Promise<void>;
}

export function getTtsProvider(): TTSProvider | null {
  const kind = (process.env.TTS_PROVIDER ?? "fake").toLowerCase();
  if (kind === "none") return null;
  if (kind === "minimax") return new MiniMaxTtsProvider();
  return new FakeTtsProvider();
}
