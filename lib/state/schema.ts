import { z } from "zod";

/**
 * The single source of truth for ProjectState (design doc §6).
 * Agents read slices of this via selectors; every mutation goes through
 * the store, which schema-validates before persisting.
 */

// ─── Enums ───────────────────────────────────────────────────────────────────

export const DirectorActionSchema = z.enum([
  "CREATE_STRATEGY",
  "RETRIEVE_ASSET",
  "PLAN_ASSETS",
  "GENERATE_VIDEO",
  "GENERATE_VOICE",
  "EVALUATE_SCENE",
  "REPAIR_SCENE",
  "COMPOSE_VIDEO",
  "FINISH",
]);
export type DirectorAction = z.infer<typeof DirectorActionSchema>;

export const ProjectStatusSchema = z.enum([
  "IDLE",
  "PLANNING",
  "EXECUTING",
  "EVALUATING",
  "REPAIRING",
  "COMPOSING",
  "COMPLETED",
  "FAILED",
]);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

export const SceneStatusSchema = z.enum([
  "PLANNED",
  "SEARCHING",
  "GENERATING",
  "EVALUATING",
  "REPAIRING",
  "READY",
  "FAILED",
]);
export type SceneStatus = z.infer<typeof SceneStatusSchema>;

export const SourceStrategySchema = z.enum([
  "EXISTING_ASSET",
  "GENERATED_VIDEO",
  "REUSE",
  "FALLBACK",
]);
export type SourceStrategy = z.infer<typeof SourceStrategySchema>;

export const SceneIdSchema = z.enum(["S1", "S2", "S3"]);
export type SceneId = z.infer<typeof SceneIdSchema>;

export const ScenePurposeSchema = z.enum(["HOOK", "PROOF", "CTA"]);
export type ScenePurpose = z.infer<typeof ScenePurposeSchema>;

// ─── Brief ───────────────────────────────────────────────────────────────────

export const AdBriefSchema = z.object({
  productName: z.string().min(1),
  productDescription: z.string().min(1),
  market: z.string().min(1),
  audience: z.string().min(1),
  platform: z.enum(["TikTok", "Reels", "Shorts"]),
  durationSec: z.union([z.literal(15), z.literal(20)]),
  aspectRatio: z.enum(["9:16", "16:9"]).optional(),
  additionalRequirement: z.string().optional(),
});
export type AdBrief = z.infer<typeof AdBriefSchema>;

// ─── Strategy (output of the Strategy Agent, §7.2) ──────────────────────────

export const StrategySceneSchema = z.object({
  id: SceneIdSchema,
  purpose: ScenePurposeSchema,
  durationSec: z.number().int().min(2).max(20),
  visualIntent: z.string().min(1),
  voiceover: z.string().min(1),
});

export const CreativeStrategySchema = z.object({
  concept: z.string().min(1),
  hook: z.string().min(1),
  targetEmotion: z.string().min(1),
  scenes: z.tuple([StrategySceneSchema, StrategySceneSchema, StrategySceneSchema]),
});
export type CreativeStrategy = z.infer<typeof CreativeStrategySchema>;

// ─── Assets (§8.1) ───────────────────────────────────────────────────────────

export const AssetCandidateSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  description: z.string(),
  tags: z.array(z.string()),
  durationSec: z.number().positive(),
  score: z.number().min(0).max(1),
  /** Segment candidates: cut window inside the parent video file */
  startTime: z.number().min(0).optional(),
  endTime: z.number().min(0).optional(),
});
export type AssetCandidate = z.infer<typeof AssetCandidateSchema>;

// ─── Critic (§6.4) ───────────────────────────────────────────────────────────

export const CriticDimensionsSchema = z.object({
  intentAlignment: z.number().min(0).max(100),
  visualQuality: z.number().min(0).max(100),
  productVisibility: z.number().min(0).max(100),
  localization: z.number().min(0).max(100),
  safetyAndText: z.number().min(0).max(100),
});
export type CriticDimensions = z.infer<typeof CriticDimensionsSchema>;

export const CriticIssueSchema = z.object({
  type: z.string().min(1),
  severity: z.enum(["low", "medium", "high"]),
  description: z.string().min(1),
});
export type CriticIssue = z.infer<typeof CriticIssueSchema>;

export const CriticResultSchema = z.object({
  score: z.number().min(0).max(100),
  decision: z.enum(["PASS", "REPAIR"]),
  dimensions: CriticDimensionsSchema,
  issues: z.array(CriticIssueSchema),
  repair: z
    .object({
      strategy: z.enum(["REGENERATE", "FALLBACK"]),
      promptDelta: z.string(),
    })
    .optional(),
});
export type CriticResult = z.infer<typeof CriticResultSchema>;

// ─── Scene runtime state (§6.3) ──────────────────────────────────────────────

export const RepairRecordSchema = z.object({
  attempt: z.number().int().min(1),
  at: z.string(),
  promptDelta: z.string(),
  previousScore: z.number(),
  newScore: z.number().optional(),
  outcome: z.enum(["PENDING", "IMPROVED", "FALLBACK", "NO_IMPROVEMENT"]),
  /** Version-comparison data: the rejected cut and why (design doc §13, transparent repair) */
  previousVideoUrl: z.string().optional(),
  issues: z.array(CriticIssueSchema).optional(),
  previousDimensions: CriticDimensionsSchema.optional(),
});
export type RepairRecord = z.infer<typeof RepairRecordSchema>;

export const SceneStateSchema = z.object({
  id: SceneIdSchema,
  order: z.number().int(),
  purpose: ScenePurposeSchema,
  durationSec: z.number().int().min(2).max(20),

  visualIntent: z.string(),
  voiceover: z.string().optional(),

  sourceStrategy: SourceStrategySchema.optional(),
  sourceReason: z.string().optional(),
  assetCandidates: z.array(AssetCandidateSchema).optional(),
  selectedAsset: AssetCandidateSchema.optional(),

  generationPrompt: z.string().optional(),
  videoJobId: z.string().optional(),
  videoUrl: z.string().optional(),
  audioUrl: z.string().optional(),
  qualityWarning: z.boolean().optional(),

  qa: CriticResultSchema.optional(),
  /** existing-asset scenes: candidates already rejected by the critic */
  rejectedAssetIds: z.array(z.string()).optional(),
  repairHistory: z.array(RepairRecordSchema),
  retryCount: z.number().int().min(0),
  status: SceneStatusSchema,
});
export type SceneState = z.infer<typeof SceneStateSchema>;

// ─── Events (§11) ────────────────────────────────────────────────────────────

export const RuntimeEventTypeSchema = z.enum([
  "PROJECT_STARTED",
  "AGENT_STARTED",
  "AGENT_COMPLETED",
  "DECISION_MADE",
  "TOOL_STARTED",
  "TOOL_PROGRESS",
  "TOOL_COMPLETED",
  "SCENE_UPDATED",
  "CRITIC_COMPLETED",
  "REPAIR_STARTED",
  "PROJECT_COMPLETED",
  "ERROR",
]);
export type RuntimeEventType = z.infer<typeof RuntimeEventTypeSchema>;

export const RuntimeActorSchema = z.enum([
  "DIRECTOR",
  "STRATEGY",
  "ASSET",
  "CRITIC",
  "TOOL",
  "SYSTEM",
]);
export type RuntimeActor = z.infer<typeof RuntimeActorSchema>;

export const RuntimeEventSchema = z.object({
  id: z.string().min(1),
  timestamp: z.string(),
  type: RuntimeEventTypeSchema,
  actor: RuntimeActorSchema,
  sceneId: z.string().optional(),
  title: z.string().min(1),
  detail: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});
export type RuntimeEvent = z.infer<typeof RuntimeEventSchema>;

export const DecisionEventSchema = RuntimeEventSchema.extend({
  type: z.literal("DECISION_MADE"),
  data: z.object({
    action: DirectorActionSchema,
    sceneId: z.string().optional(),
    reason: z.string(),
  }),
});
export type DecisionEvent = z.infer<typeof DecisionEventSchema>;

// ─── Errors ──────────────────────────────────────────────────────────────────

export const ErrorCategorySchema = z.enum([
  "VALIDATION",
  "MODEL",
  "VIDEO_PROVIDER",
  "TIMEOUT",
  "MEDIA_PROCESSING",
  "STATE",
  "UNKNOWN",
]);
export type ErrorCategory = z.infer<typeof ErrorCategorySchema>;

export const PublicErrorSchema = z.object({
  category: ErrorCategorySchema,
  message: z.string(),
  hint: z.string().optional(),
});
export type PublicError = z.infer<typeof PublicErrorSchema>;

// ─── ProjectState (§6.1) ─────────────────────────────────────────────────────

export const ProjectStateSchema = z.object({
  projectId: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),

  brief: AdBriefSchema,
  strategy: CreativeStrategySchema.optional(),
  scenes: z.array(SceneStateSchema).max(3),

  status: ProjectStatusSchema,
  currentAction: DirectorActionSchema.optional(),

  decisions: z.array(z.object({
    at: z.string(),
    action: DirectorActionSchema,
    sceneId: z.string().optional(),
    reason: z.string(),
  })),
  events: z.array(RuntimeEventSchema),

  runtime: z.object({
    totalVideoGenerations: z.number().int().min(0),
    totalRepairs: z.number().int().min(0),
    directorSteps: z.number().int().min(0),
    startedAt: z.string().optional(),
    completedAt: z.string().optional(),
    demoMode: z.enum(["live", "cache", "replay"]).optional(),
  }),

  finalVideoUrl: z.string().optional(),
  error: PublicErrorSchema.optional(),
});
export type ProjectState = z.infer<typeof ProjectStateSchema>;
