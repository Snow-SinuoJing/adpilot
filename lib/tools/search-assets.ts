import fs from "node:fs";
import path from "node:path";
import { AssetCandidateSchema, type AssetCandidate } from "@/lib/state/schema";
import { ASSETS_DIR } from "@/lib/paths";

/**
 * search_assets (design doc §8.1).
 * Small local library, explainable scoring: tag overlap + lexical overlap
 * between the scene intent and asset metadata. Deliberately no vector DB.
 */

interface AssetMetadata {
  id: string;
  file: string;
  description: string;
  tags: string[];
  durationSec: number;
}

/** CJK-aware tokenizer: latin words (≥3 chars) + every CJK char as a token,
 *  so Chinese scene intents still match a bilingual tag library. */
function tokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const word of text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []) {
    tokens.add(word);
  }
  for (const char of text.match(/[\u4e00-\u9fff]/g) ?? []) {
    tokens.add(char);
  }
  return tokens;
}

function scoreAsset(query: { intent: string; purpose: string }, asset: AssetMetadata): number {
  const queryTokens = tokenize(`${query.intent} ${query.purpose}`);
  const assetTokens = tokenize(`${asset.description} ${asset.tags.join(" ")}`);
  if (queryTokens.size === 0) return 0;

  let overlap = 0;
  for (const token of queryTokens) {
    if (assetTokens.has(token)) overlap += 1;
  }
  const lexical = overlap / queryTokens.size;

  const purposeTag = `purpose:${query.purpose.toLowerCase()}`;
  const tagBonus = asset.tags.includes(purposeTag) ? 0.25 : 0;

  const durationIdeal = 5;
  const durationPenalty = Math.min(Math.abs(asset.durationSec - durationIdeal) / 20, 0.15);

  return Math.max(0, Math.min(1, lexical * 0.8 + tagBonus - durationPenalty));
}

export function searchAssets(input: { query: string; purpose: string; topK?: number }): AssetCandidate[] {
  const libraryFile = path.join(ASSETS_DIR, "assets.json");
  if (!fs.existsSync(libraryFile)) return [];

  const raw: unknown = JSON.parse(fs.readFileSync(libraryFile, "utf8"));
  const library = (Array.isArray(raw) ? raw : []).map((entry) =>
    AssetCandidateSchema.parse({
      ...(entry as AssetMetadata),
      path: path.join(ASSETS_DIR, (entry as AssetMetadata).file),
      score: 0,
    }),
  );

  const scored = library.map((asset) => ({
    asset,
    score: scoreAsset({ intent: input.query, purpose: input.purpose }, {
      id: asset.id,
      file: path.basename(asset.path),
      description: asset.description,
      tags: asset.tags,
      durationSec: asset.durationSec,
    }),
  }));

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, input.topK ?? 3)
    .map(({ asset, score }) => AssetCandidateSchema.parse({ ...asset, score: Math.round(score * 100) / 100 }));
}
