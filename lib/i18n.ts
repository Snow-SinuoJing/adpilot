/** Central Chinese label maps — the UI never hardcodes these twice. */
import type { DirectorAction, ProjectStatus, RuntimeActor, ScenePurpose, SceneStatus, SourceStrategy } from "@/lib/state/schema";

export const PROJECT_STATUS_ZH: Record<ProjectStatus, string> = {
  IDLE: "待启动",
  PLANNING: "规划中",
  EXECUTING: "执行中",
  EVALUATING: "评审中",
  REPAIRING: "修复中",
  COMPOSING: "合成中",
  COMPLETED: "已完成",
  FAILED: "失败",
};

export const SCENE_STATUS_ZH: Record<SceneStatus, string> = {
  PLANNED: "已规划",
  SEARCHING: "检索中",
  GENERATING: "生成中",
  EVALUATING: "评审中",
  REPAIRING: "修复中",
  READY: "就绪",
  FAILED: "失败",
};

export const SOURCE_ZH: Record<SourceStrategy, string> = {
  EXISTING_ASSET: "素材库",
  GENERATED_VIDEO: "AI 生成",
  REUSE: "复用",
  FALLBACK: "降级素材",
};

export const ACTOR_ZH: Record<RuntimeActor, string> = {
  DIRECTOR: "导演",
  STRATEGY: "策略",
  ASSET: "素材",
  CRITIC: "评审",
  TOOL: "工具",
  SYSTEM: "系统",
};

export const ACTION_ZH: Record<DirectorAction, string> = {
  CREATE_STRATEGY: "创建策略",
  RETRIEVE_ASSET: "检索素材",
  PLAN_ASSETS: "规划素材来源",
  GENERATE_VIDEO: "生成视频",
  EVALUATE_SCENE: "评审场景",
  REPAIR_SCENE: "修复场景",
  GENERATE_VOICE: "生成配音",
  COMPOSE_VIDEO: "合成视频",
  FINISH: "收尾",
};

export const PURPOSE_ZH: Record<ScenePurpose, string> = {
  HOOK: "钩子",
  PROOF: "证明",
  CTA: "行动号召",
};

export const DEMO_MODE_ZH: Record<string, string> = {
  live: "实时",
  cache: "缓存加速",
  replay: "回放（真实运行录制）",
};

export const DIMENSION_ZH: Record<string, string> = {
  intentAlignment: "意图一致性",
  visualQuality: "画面质量",
  productVisibility: "产品可见度",
  localization: "本地化",
  safetyAndText: "安全与文字",
};
