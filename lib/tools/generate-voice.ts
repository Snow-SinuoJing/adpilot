import { mediaFile, urlForMedia } from "@/lib/media";
import { getTtsProvider } from "@/lib/providers/tts-provider";

/**
 * generate_voice (design doc §8): one voiceover track per scene, written
 * into the project media dir and referenced by URL in ProjectState.
 */

export async function generateSceneVoice(input: {
  projectId: string;
  sceneId: string;
  text: string;
  locale?: string;
}): Promise<string> {
  const provider = getTtsProvider();
  if (!provider) throw new Error("no tts provider configured");

  const outPath = mediaFile(input.projectId, `${input.sceneId}-voice.mp3`);
  await provider.synthesize({
    text: input.text,
    locale: input.locale,
    outPath,
  });
  return urlForMedia(outPath);
}
