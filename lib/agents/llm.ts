import { z } from "zod";
import { OpenAI } from "openai";

/**
 * LLM access layer (design doc §4.2 + plan deviation note).
 *
 * - Any OpenAI-compatible endpoint works (default: Zhipu GLM; switch to
 *   DeepSeek / MiniMax / OpenAI via env, no code change).
 * - Preferred path: OpenAI Agents SDK (`Agent` + zod `outputType`) driven
 *   through a custom OpenAI client. If the SDK misbehaves against a
 *   third-party endpoint, we permanently fall back to a direct
 *   chat.completions call — same interface, same schema contract.
 * - LLM_MODE=mock short-circuits everything: agents answer with
 *   deterministic scripted outputs (offline dev / demo safety net).
 */

export interface LlmConfig {
  mode: "live" | "mock";
  baseUrl: string;
  apiKey: string;
  model: string;
  visionModel: string;
}

export function llmConfig(): LlmConfig {
  const apiKey = process.env.LLM_API_KEY?.trim() ?? "";
  const requested = process.env.LLM_MODE?.trim().toLowerCase();
  const mode: "live" | "mock" =
    requested === "mock" || requested === "live"
      ? requested
      : apiKey
        ? "live"
        : "mock";
  return {
    mode,
    baseUrl: process.env.LLM_BASE_URL?.trim() || "https://open.bigmodel.cn/api/paas/v4",
    apiKey,
    model: process.env.LLM_MODEL?.trim() || "glm-4.6",
    visionModel: process.env.LLM_VISION_MODEL?.trim() || "glm-4.5v",
  };
}

export function isMockMode(): boolean {
  return llmConfig().mode === "mock";
}

// ─── shared helpers ──────────────────────────────────────────────────────────

function schemaInstruction(schema: z.ZodType): string {
  try {
    const jsonSchema = z.toJSONSchema(schema);
    return `Respond with a single JSON object exactly matching this schema (no markdown, no extra text):\n${JSON.stringify(jsonSchema)}`;
  } catch {
    return "Respond with a single valid JSON object. No markdown fences, no commentary.";
  }
}

function extractJson(text: string): unknown {
  const stripped = text.replace(/```json\s*/g, "").replace(/```/g, "").trim();
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("no JSON object in model output");
  return JSON.parse(stripped.slice(start, end + 1));
}

let sharedClient: OpenAI | null = null;
function client(config: LlmConfig): OpenAI {
  if (!sharedClient) {
    sharedClient = new OpenAI({
      baseURL: config.baseUrl,
      apiKey: config.apiKey,
      timeout: 90_000,
      maxRetries: 1,
    });
  }
  return sharedClient;
}

// ─── Agents SDK path (preferred) ─────────────────────────────────────────────

let sdkUsable: boolean | null = null;

async function runViaSdk<T>(
  config: LlmConfig,
  opts: { name: string; system: string; user: string; schema: z.ZodType<T> },
): Promise<T> {
  const { Agent, run, setDefaultOpenAIClient, setTracingDisabled, setOpenAIAPI } =
    await import("@openai/agents");

  if (sdkUsable === null) {
    setTracingDisabled(true);
    setDefaultOpenAIClient(client(config));
    try {
      // Third-party OpenAI-compatible endpoints only implement
      // chat/completions, not the Responses API.
      setOpenAIAPI("chat_completions");
    } catch {
      // older SDK versions default to chat completions anyway
    }
  }

  const agent = new Agent({
    name: opts.name,
    instructions: opts.system,
    model: config.model,
    outputType: opts.schema as z.ZodType,
  });
  const result = await run(agent, opts.user);
  sdkUsable = true;
  return opts.schema.parse(result.output);
}

// ─── Direct client path (fallback + vision) ─────────────────────────────────

async function runViaClient<T>(
  config: LlmConfig,
  opts: { system: string; user: string; schema: z.ZodType<T>; model?: string },
): Promise<T> {
  const response = await client(config).chat.completions.create({
    model: opts.model ?? config.model,
    messages: [
      { role: "system", content: `${opts.system}\n\n${schemaInstruction(opts.schema)}` },
      { role: "user", content: opts.user },
    ],
    response_format: { type: "json_object" },
  });
  const raw = response.choices[0]?.message?.content ?? "";
  return opts.schema.parse(extractJson(raw));
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface StructuredRunOptions<T> {
  name: string;
  system: string;
  user: string;
  schema: z.ZodType<T>;
}

/** Run one structured-output agent turn. Retries once on schema/model
 *  failure (design doc §18.2). Throws a MODEL error otherwise. */
export async function runStructured<T>(opts: StructuredRunOptions<T>): Promise<T> {
  const config = llmConfig();
  if (config.mode === "mock") {
    throw new Error("runStructured called in mock mode — agents must handle mock themselves");
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (sdkUsable !== false) {
        try {
          return await runViaSdk(config, opts);
        } catch (sdkError) {
          sdkUsable = false;
          lastError = sdkError;
          console.warn(`[llm] Agents SDK path failed, falling back to direct client:`, sdkError);
        }
      }
      return await runViaClient(config, opts);
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`model call failed after retry: ${String(lastError)}`);
}

/** Multimodal turn with image inputs (frames for the Critic).
 *  model override: 素材分析用高精度模型（ANALYSIS_VISION_MODEL），
 *  评审用快速模型（LLM_VISION_MODEL）——速度与精度分工。 */
export async function runVision<T>(opts: {
  name: string;
  system: string;
  user: string;
  images?: Array<{ dataUrl: string }>;
  videos?: Array<{ dataUrl: string }>;
  schema: z.ZodType<T>;
  model?: string;
}): Promise<T> {
  const config = llmConfig();
  const content: Array<Record<string, unknown>> = [
    { type: "text", text: `${opts.user}\n\n${schemaInstruction(opts.schema)}` },
    ...(opts.videos ?? []).map((video) => ({ type: "video_url", video_url: { url: video.dataUrl } })),
    ...(opts.images ?? []).map((image) => ({ type: "image_url", image_url: { url: image.dataUrl } })),
  ];

  const request = (jsonMode: boolean) =>
    client(config).chat.completions.create({
      model: opts.model ?? config.visionModel,
      messages: [
        { role: "system", content: `${opts.system}${jsonMode ? "" : "\n\nOutput ONLY a valid JSON object."}` },
        { role: "user", content: content as never },
      ],
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
    });

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await request(attempt === 0);
      const raw = response.choices[0]?.message?.content ?? "";
      return opts.schema.parse(extractJson(raw));
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`vision model call failed after retry: ${String(lastError)}`);
}
