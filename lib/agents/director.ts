import { z } from "zod";
import type { DirectorAction } from "@/lib/state/schema";
import { DirectorActionSchema, SceneIdSchema } from "@/lib/state/schema";
import type { DirectorView } from "@/lib/state/selectors";
import { isMockMode, runStructured } from "./llm";

/**
 * Creative Director (design doc §7.1).
 * Decides "what to do next" from a bounded action space; the orchestrator
 * decides "how to do it reliably". The reason is a user-visible, auditable
 * business sentence — never hidden chain-of-thought.
 */

export const DirectorDecisionSchema = z.object({
  action: DirectorActionSchema,
  sceneId: SceneIdSchema.optional(),
  reason: z.string().min(1),
});
export type DirectorDecision = z.infer<typeof DirectorDecisionSchema>;

const SCENE_SCOPED: ReadonlySet<DirectorAction> = new Set([
  "RETRIEVE_ASSET",
  "PLAN_ASSETS",
  "GENERATE_VIDEO",
  "EVALUATE_SCENE",
  "REPAIR_SCENE",
]);

/** Canonical priority used by the deterministic policy (and as the safety
 *  net when a live LLM choice is invalid). */
const PRIORITY: DirectorAction[] = [
  "CREATE_STRATEGY",
  "RETRIEVE_ASSET",
  "PLAN_ASSETS",
  "GENERATE_VIDEO",
  "EVALUATE_SCENE",
  "REPAIR_SCENE",
  "GENERATE_VOICE",
  "COMPOSE_VIDEO",
  "FINISH",
];

function pickScene(view: DirectorView, action: DirectorAction): string | undefined {
  const byAction: Record<string, (s: DirectorView["scenes"][number]) => boolean> = {
    RETRIEVE_ASSET: (s) => s.status === "PLANNED",
    PLAN_ASSETS: (s) =>
      s.status === "SEARCHING" &&
      (!s.sourceStrategy ||
        (s.sourceStrategy === "GENERATED_VIDEO" && !s.hasVideo && !view.generationBudgetLeft)),
    GENERATE_VIDEO: (s) =>
      s.sourceStrategy === "GENERATED_VIDEO" && !s.hasVideo && (s.status === "SEARCHING" || s.status === "REPAIRING"),
    EVALUATE_SCENE: (s) => s.hasVideo && s.qaScore === undefined && s.status !== "READY",
    REPAIR_SCENE: (s) => s.qaDecision === "REPAIR" && s.status === "REPAIRING",
  };
  const matches = byAction[action];
  if (!matches) return undefined;
  return view.scenes.find(matches)?.id;
}

/** Deterministic policy — the mock Director, the fallback for invalid live
 *  decisions, and the reference implementation of legal behaviour. */
export function policyDecision(view: DirectorView): DirectorDecision {
  const action = PRIORITY.find((a) => view.allowedActions.includes(a)) ?? "FINISH";
  const sceneId = pickScene(view, action);
  const allReady = view.scenes.length > 0 && view.scenes.every((s) => s.status === "READY");
  const reason =
    action === "FINISH" && !allReady
      ? "当前状态下没有可执行的下一步。"
      : reasonFor(action, view);
  return DirectorDecisionSchema.parse({ action, sceneId, reason });
}

function reasonFor(action: DirectorAction, view: DirectorView): string {
  const product = view.brief.product;
  switch (action) {
    case "CREATE_STRATEGY":
      return `还没有为 ${product}（${view.brief.market} 市场）建立创意策略。`;
    case "RETRIEVE_ASSET":
      return `场景需要画面：先检索素材库，再决定是否 AI 生成。`;
    case "PLAN_ASSETS":
      return view.generationBudgetLeft
        ? `有场景已取回候选素材但尚未决策来源。`
        : `生成额度已用尽——把等待生成的场景改回素材库方案。`;
    case "GENERATE_VIDEO":
      return `素材库中没有能表达该场景意图的片段——生成专属画面。`;
    case "EVALUATE_SCENE":
      return `生成的画面必须先通过多模态质检才能使用。`;
    case "REPAIR_SCENE":
      return `评审发现该场景有问题；只修复这一个场景。`;
    case "GENERATE_VOICE":
      return `所有场景已就绪——生成本地化配音。`;
    case "COMPOSE_VIDEO":
      return `画面与配音全部就绪——合成最终广告。`;
    case "FINISH":
      return `最终广告已交付——收尾归档。`;
  }
}

const SYSTEM = `你是一个智能体广告工作室的创意导演（Creative Director）。
给定压缩后的项目状态视图，从 "allowedActions" 中选择恰好一个下一步动作。

规则：
- RETRIEVE_ASSET、PLAN_ASSETS、GENERATE_VIDEO、EVALUATE_SCENE、REPAIR_SCENE 必须带 sceneId（S1|S2|S3）；其余动作省略 sceneId。
- "reason" 必须是一句简体中文、用户可见的业务理由，解释为什么这是正确的下一步（例如"素材库中没有能表达消除蜕变场景的片段"）。绝不暴露隐藏推理过程。
- 素材足够匹配时优先复用素材；只有检索无法表达场景时才生成。`;

export async function decideNextAction(view: DirectorView): Promise<DirectorDecision> {
  if (isMockMode()) return policyDecision(view);

  const decision = await runStructured({
    name: "Creative Director",
    system: SYSTEM,
    user: JSON.stringify(view, null, 2),
    schema: DirectorDecisionSchema,
  });

  if (
    view.allowedActions.includes(decision.action) &&
    (!SCENE_SCOPED.has(decision.action) || (decision.sceneId && decision.sceneId === pickScene(view, decision.action)))
  ) {
    return decision;
  }

  console.warn(
    `[director] invalid LLM decision (${decision.action}/${decision.sceneId}) — falling back to policy`,
  );
  return policyDecision(view);
}
