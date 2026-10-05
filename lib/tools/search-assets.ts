import fs from "node:fs";
import path from "node:path";
import { AssetCandidateSchema, type AssetCandidate } from "@/lib/state/schema";
import { ASSETS_DIR } from "@/lib/paths";
import { readLibrary, type AssetEntry } from "@/lib/assets-library";

/**
 * search_assets（设计文档 §8.1，按用户反馈 #2 放宽）：
 * - 检索池 = 未拆分的完整素材 + 全部自动切片（切片有时长与内容双重精度）
 * - 时长不作为硬性门槛：系统会自动裁剪/补帧，仅轻微偏好接近的片段
 * - 词法重叠（中英双语）+ 用途标签加成决定内容匹配
 */

/** Content threshold: below this the planner treats retrieval as a real miss.
 *  Deliberately lenient — reuse beats generation on cost, speed and realism. */
export const MATCH_THRESHOLD = 0.22;

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

function scoreAsset(query: { intent: string; purpose: string }, asset: AssetEntry): number {
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

  // duration is a soft preference, never a gate (compose trims or pads)
  const distance = Math.abs(asset.durationSec - 5);
  const durationPenalty = Math.min(distance / 60, 0.08);

  return Math.max(0, Math.min(1, lexical * 0.8 + tagBonus - durationPenalty));
}

export function searchAssets(input: { query: string; purpose: string; topK?: number }): AssetCandidate[] {
  const libraryFile = path.join(ASSETS_DIR, "assets.json");
  if (!fs.existsSync(libraryFile)) return [];

  const raw: unknown = JSON.parse(fs.readFileSync(libraryFile, "utf8"));
  const entries = (Array.isArray(raw) ? raw : []) as AssetEntry[];
  const searchable = entries.filter((e) => !e.hasSegments);

  const scored = searchable
    .map((asset) => ({ asset, score: scoreAsset({ intent: input.query, purpose: input.purpose }, asset) }))
    .filter(({ score }) => score > 0.01);

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, input.topK ?? 3)
    .map(({ asset, score }) =>
      AssetCandidateSchema.parse({
        id: asset.id,
        path: path.join(ASSETS_DIR, asset.file),
        description: asset.description,
        tags: asset.tags,
        durationSec: asset.durationSec,
        score: Math.round(score * 100) / 100,
        ...(asset.startTime !== undefined && asset.endTime !== undefined
          ? { startTime: asset.startTime, endTime: asset.endTime }
          : {}),
      }),
    );
}
