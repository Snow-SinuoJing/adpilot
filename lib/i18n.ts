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
  STOPPED: "已停止",
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
  EXISTING_ASSET: "道具间",
  GENERATED_VIDEO: "AI 生成",
  REUSE: "复用",
  FALLBACK: "降级道具",
};

export const ACTOR_ZH: Record<RuntimeActor, string> = {
  DIRECTOR: "导演",
  STRATEGY: "编剧",
  ASSET: "道具师",
  CRITIC: "审片员",
  TOOL: "AI 摄影师",
  SYSTEM: "制片",
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

export const LANGUAGE_ZH: Record<string, string> = {
  zh: "中文普通话",
  yue: "粤语",
  en: "英语",
  pt: "葡萄牙语",
  es: "西班牙语",
};

export const DIMENSION_ZH: Record<string, string> = {
  intentAlignment: "意图一致性",
  visualQuality: "画面质量",
  productVisibility: "产品可见度",
  localization: "本地化",
  safetyAndText: "安全与文字",
};

export const ERROR_CATEGORY_ZH: Record<string, string> = {
  VALIDATION: "简报校验未通过",
  MODEL: "决策模型异常",
  VIDEO_PROVIDER: "视频生成服务异常",
  TIMEOUT: "生成超时",
  MEDIA_PROCESSING: "媒体处理异常",
  STATE: "运行状态异常",
  UNKNOWN: "未知错误",
};

/** 常见市场.en → .zh；未收录的市场原样展示。 */
export const MARKET_ZH: Record<string, string> = {
  Brazil: "巴西",
  China: "中国",
  "United States": "美国",
  US: "美国",
  USA: "美国",
  UK: "英国",
  "United Kingdom": "英国",
  Japan: "日本",
  Korea: "韩国",
  Indonesia: "印尼",
  Thailand: "泰国",
  Vietnam: "越南",
  "Southeast Asia": "东南亚",
  Europe: "欧洲",
  Germany: "德国",
  France: "法国",
  Spain: "西班牙",
  Mexico: "墨西哥",
  Argentina: "阿根廷",
  India: "印度",
  Global: "全球",
};

export const marketLabel = (market?: string): string =>
  market ? (MARKET_ZH[market] ?? market) : "—";

/** 短素材用「N 秒」，满一分钟用「M:SS」。 */
export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "—";
  if (sec < 60) return `${Math.round(sec)} 秒`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
