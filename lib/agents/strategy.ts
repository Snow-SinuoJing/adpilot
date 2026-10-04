import { CreativeStrategySchema, type AdBrief, type CreativeStrategy } from "@/lib/state/schema";
import { isMockMode, runStructured } from "./llm";

/**
 * Strategy Agent (design doc §7.2).
 * Always returns exactly 3 scenes (HOOK / PROOF / CTA) whose durations sum
 * to the brief duration. Business rules are enforced in code after the
 * model answers — the model proposes, the runtime disposes.
 */

const SYSTEM = `You are a creative strategist for performance advertising.
Method: "platform-first remix" — recombine proven hooks and beats that work on ${"TikTok / Reels / Shorts"} into a fresh narrative.

Create a 3-scene vertical-video ad plan:
- S1 HOOK (stop the scroll), S2 PROOF (show the product delivering value), S3 CTA (drive install).
- scene durations are integers ≥ 2s and MUST sum exactly to the brief duration.
- visualIntent must be a concrete, filmable image (action / emotion / state), friendly to stock or generated footage.
- voiceover must be short, spoken-style, localized to the target market (write English unless the market language is Spanish or Portuguese — then write in that language).
- Never mention money, payouts, salaries or real-world rewards (ad compliance).
- Deeply respect the target market's culture, humour and aesthetics.`;

function splitDuration(total: number): [number, number, number] {
  return total === 15 ? [4, 6, 5] : [6, 7, 7];
}

/** Deterministic strategy used in mock mode and as a last-resort fallback. */
export function mockStrategy(brief: AdBrief): CreativeStrategy {
  const [d1, d2, d3] = splitDuration(brief.durationSec);
  return CreativeStrategySchema.parse({
    concept: `Relatable frustration → delightful mastery → invitation: a 3-beat narrative showing how ${brief.productName} turns dead time into small victories for ${brief.audience}.`,
    hook: `Open on the exact feeling of boredom ${brief.audience} know too well — then break it with colour and speed.`,
    targetEmotion: "playful FOMO — the itch to try one level right now",
    scenes: [
      {
        id: "S1",
        purpose: "HOOK",
        durationSec: d1,
        visualIntent: `Close-up of a ${brief.audience.split(/[\s,]/)[0] || "player"}'s face lighting up while playing ${brief.productName} on a phone, vibrant casual-game colours reflecting on their face, quick energetic pacing`,
        voiceover: `Tired of boring breaks? ${brief.productName} changes the game.`,
      },
      {
        id: "S2",
        purpose: "PROOF",
        durationSec: d2,
        visualIntent: `Seamless level-progression transformation in ${brief.productName}: satisfying cascade of tiles clearing, combos chaining and rewards bursting as difficulty ramps up, screen-first kinetic gameplay`,
        voiceover: `Every level is short, smart and surprisingly satisfying.`,
      },
      {
        id: "S3",
        purpose: "CTA",
        durationSec: d3,
        visualIntent: `Player celebrates winning a level with a genuine smile, thumb visibly taps the download area of the phone, upbeat closing energy with space for the ${brief.productName} logo`,
        voiceover: `Download ${brief.productName} free — your first win is waiting.`,
      },
    ],
  });
}

/** Deterministic fix-up: rescale scene durations so they sum exactly to the
 *  brief duration. Code owns invariants the model only proposes. */
function normalizeDurations(strategy: CreativeStrategy, brief: AdBrief): CreativeStrategy {
  const sum = strategy.scenes.reduce((acc, s) => acc + s.durationSec, 0);
  if (sum === brief.durationSec) return strategy;
  const scaled = CreativeStrategySchema.parse({
    ...strategy,
    scenes: strategy.scenes.map((s, i) => ({
      ...s,
      durationSec: splitDuration(brief.durationSec)[i],
    })),
  });
  return scaled;
}

export async function createStrategy(brief: AdBrief): Promise<CreativeStrategy> {
  if (isMockMode()) return mockStrategy(brief);

  const strategy = await runStructured({
    name: "Strategy Agent",
    system: SYSTEM,
    user: JSON.stringify(
      {
        brief: {
          productName: brief.productName,
          productDescription: brief.productDescription,
          market: brief.market,
          audience: brief.audience,
          platform: brief.platform,
          durationSec: brief.durationSec,
          additionalRequirement: brief.additionalRequirement,
        },
        requiredScenes: ["S1 HOOK", "S2 PROOF", "S3 CTA"],
      },
      null,
      2,
    ),
    schema: CreativeStrategySchema,
  });

  return normalizeDurations(strategy, brief);
}
