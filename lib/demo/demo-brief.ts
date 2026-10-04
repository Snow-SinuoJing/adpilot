import type { AdBrief } from "@/lib/state/schema";

/**
 * The standard interview demo case (design doc §15 / §25).
 * The demo asset library is intentionally curated so that S1 and S3 hit
 * library clips while S2 (PROOF — the transformation scene) does not,
 * guaranteeing every standard run shows BOTH retrieval and generation.
 */
export const DEMO_BRIEF: AdBrief = {
  productName: "Tile Blitz",
  productDescription:
    "A hyper-casual tile-matching puzzle game with 60-second levels, satisfying combo cascades and daily challenges.",
  market: "Brazil",
  audience: "casual mobile players aged 18-34 who play in short breaks",
  platform: "TikTok",
  durationSec: 15,
  additionalRequirement: "Emphasize the satisfying combo feeling; vibrant colors fit Brazilian taste.",
};
