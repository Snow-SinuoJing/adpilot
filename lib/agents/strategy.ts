import { CreativeStrategySchema, type AdBrief, type CreativeStrategy } from "@/lib/state/schema";
import { isMockMode, runStructured } from "./llm";

/**
 * Strategy Agent (design doc §7.2).
 * Always returns exactly 3 scenes (HOOK / PROOF / CTA) whose durations sum
 * to the brief duration. Business rules are enforced in code after the
 * model answers — the model proposes, the runtime disposes.
 */

const SYSTEM = `你是一位效果广告创意策略专家，方法论是"平台优先的成功元素重组"。
为竖版信息流广告规划一个三段式方案：
- S1 钩子（HOOK，让人停下划动）、S2 证明（PROOF，展示产品真实价值）、S3 行动号召（CTA，引导下载）。
- 每个场景时长为不小于 2 秒的整数，且三个场景时长之和必须精确等于 Brief 总时长。
- visualIntent 写成具体、可拍摄的画面（动作/情绪/状态），便于匹配现有素材或 AI 生成，用简体中文。
- voiceover 要短、口语化、符合目标市场语言（巴西市场用葡萄牙语，其他默认英语）。
- 禁止出现与现实奖励、金钱相关的字眼（合规要求）。
- 创意必须深度契合目标市场的文化、审美与网络语境。
- concept、hook、targetEmotion 用简体中文。`;

function splitDuration(total: number): [number, number, number] {
  return total === 15 ? [4, 6, 5] : [6, 7, 7];
}

/** Deterministic strategy used in mock mode and as a last-resort fallback. */
export function mockStrategy(brief: AdBrief): CreativeStrategy {
  const [d1, d2, d3] = splitDuration(brief.durationSec);
  return CreativeStrategySchema.parse({
    concept: `共鸣 → 证明 → 邀请：三段式叙事展现 ${brief.productName} 如何把 ${brief.audience} 的碎片时间变成小胜利。`,
    hook: `从 ${brief.audience} 最熟悉的"无聊瞬间"切入，用色彩与节奏瞬间打破。`,
    targetEmotion: "玩心勃勃的怕错过感——现在就想来一局",
    scenes: [
      {
        id: "S1",
        purpose: "HOOK",
        durationSec: d1,
        visualIntent: `年轻玩家玩手机游戏 ${brief.productName} 时脸上绽放惊喜笑容的特写，明快的休闲游戏色彩映在脸上，节奏轻快有感染力`,
        voiceover: `Tired of boring breaks? ${brief.productName} changes the game.`,
      },
      {
        id: "S2",
        purpose: "PROOF",
        durationSec: d2,
        visualIntent: `${brief.productName} 关卡推进的丝滑蜕变过程：磁砖连锁消除、连击链式爆发的爽快瞬间，难度逐步升级的核心玩法演示`,
        voiceover: `Every level is short, smart and surprisingly satisfying.`,
      },
      {
        id: "S3",
        purpose: "CTA",
        durationSec: d3,
        visualIntent: `玩家赢得关卡后真诚庆祝、笑容灿烂，拇指明显点击手机上的下载区域，收尾充满活力，留出品牌标露出空间`,
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
