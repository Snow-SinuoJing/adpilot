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

function scoreAsset(
  query: { intent: string; purpose: string; product?: string },
  asset: AssetEntry,
): number {
  const queryTokens = tokenize(`${query.intent} ${query.purpose}`);
  const assetTokens = tokenize(`${asset.description} ${asset.tags.join(" ")}`);
  if (queryTokens.size === 0) return 0;

  let overlap = 0;
  for (const token of queryTokens) {
    if (assetTokens.has(token)) overlap += 1;
  }
  const lexical = overlap / queryTokens.size;

  // 产品主体优先（用户反馈 #4）：素材描述命中产品名过半 → 强加成，
  // 让"元气森林切片"压过任何标签凑巧匹配的无关素材
  let productBonus = 0;
  if (query.product) {
    const productTokens = [...tokenize(query.product)];
    if (productTokens.length > 0) {
      const hits = productTokens.filter((t) => assetTokens.has(t)).length;
      if (hits / productTokens.length >= 0.5) productBonus = 0.35;
    }
  }

  const purposeTag = `purpose:${query.purpose.toLowerCase()}`;
  const tagBonus = asset.tags.includes(purposeTag) ? 0.25 : 0;

  // duration is a soft preference, never a gate (compose trims or pads)
  const distance = Math.abs(asset.durationSec - 5);
  const durationPenalty = Math.min(distance / 60, 0.08);

  return Math.max(0, Math.min(1, lexical * 0.8 + productBonus + tagBonus - durationPenalty));
}

export function searchAssets(input: { query: string; purpose: string; topK?: number; product?: string; priorityIds?: string[] }): AssetCandidate[] {
  const libraryFile = path.join(ASSETS_DIR, "assets.json");
  if (!fs.existsSync(libraryFile)) return [];

  const raw: unknown = JSON.parse(fs.readFileSync(libraryFile, "utf8"));
  const entries = (Array.isArray(raw) ? raw : []) as AssetEntry[];
  const searchable = entries.filter((e) => !e.hasSegments);

  // 子切片继承父素材描述的词元（用户常用产品名命名文件 → 传导给切片）
  const parentTokens = new Map<string, Set<string>>();
  for (const entry of entries) {
    if (!entry.parentFile) parentTokens.set(entry.file, tokenize(entry.description));
  }
  const tokensOf = (asset: AssetEntry): Set<string> => {
    const own = tokenize(`${asset.description} ${asset.tags.join(" ")}`);
    const inherited = parentTokens.get(asset.file);
    if (!inherited) return own;
    return new Set([...own, ...inherited]);
  };

  // 产品锚定的两半（用户反馈 #4）：命中产品名的素材强加成；只要库里存在
  // 产品命中的素材，产品不符的素材再强惩罚。Tile Blitz 演示库没有产品
  // 命中素材 → 惩罚不启用，演示剧本不受影响。
  const productHit = (asset: AssetEntry): boolean => {
    if (!input.product) return false;
    const productTokens = [...tokenize(input.product)];
    if (productTokens.length === 0) return false;
    const assetTokens = tokensOf(asset);
    const hits = productTokens.filter((t) => assetTokens.has(t)).length;
    return hits / productTokens.length >= 0.5;
  };
  const anyProductHit = searchable.some((asset) => productHit(asset));

  const priority = new Set(input.priorityIds ?? []);
  const scored = searchable
    .map((asset) => ({
      asset,
      score: Math.min(
        1,
        scoreAsset({ intent: input.query, purpose: input.purpose, product: input.product }, asset) *
          (anyProductHit && !productHit(asset) ? 0.35 : 1) +
          (priority.has(asset.id) ? 0.2 : 0), // 本次上传的素材优先（用户反馈 #2）
      ),
    }))
    .filter(({ score }) => score >= 0.15); // 弱分候选是噪声，宁缺毋滥交给规划器

  // topK 内同源限额：同一原始视频（含其切片）最多占 2 席，
  // 避免"一个视频的相似片段包揽全部候选"（用户反馈：同质化严重）
  const MAX_PER_SOURCE = 2;
  const perSource = new Map<string, number>();
  const diversified: typeof scored = [];
  for (const item of [...scored].sort((a, b) => b.score - a.score)) {
    const source = item.asset.parentFile ?? item.asset.file;
    const used = perSource.get(source) ?? 0;
    if (used >= MAX_PER_SOURCE) continue;
    perSource.set(source, used + 1);
    diversified.push(item);
    if (diversified.length >= (input.topK ?? 3)) break;
  }

  return diversified.map(({ asset, score }) =>
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
      parentFile: asset.parentFile ?? asset.file,
    }),
  );
}
