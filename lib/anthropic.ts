/**
 * Minimal Anthropic Messages API client. We deliberately avoid pulling in
 * the full @anthropic-ai/sdk to keep the serverless bundle tight; the
 * Messages endpoint is a single JSON POST.
 *
 * Activated when the env-var `ANTHROPIC_API_KEY` is present. Otherwise
 * `isAnthropicAvailable()` returns false and downstream callers gracefully
 * fall back to "no commentary" instead of throwing.
 */

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
/**
 * Default model: Haiku is fast and cheap, perfect for short Korean
 * commentary. Override via `ANTHROPIC_MODEL` if you'd rather use Sonnet
 * for higher-quality output (still cheap at the volumes we run).
 */
const DEFAULT_MODEL = "claude-3-5-haiku-latest";

export function isAnthropicAvailable(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CallAnthropicArgs {
  system?: string;
  messages: AnthropicMessage[];
  /** Max tokens to generate. Keep small — commentary is one short paragraph. */
  maxTokens?: number;
  /** Model override; defaults to Haiku. */
  model?: string;
  /** Temperature; default 0.4 — slightly varied but consistent. */
  temperature?: number;
}

export interface AnthropicResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  stopReason?: string;
}

/**
 * Call Claude. Returns `null` if the API key is missing or the request
 * fails — callers should handle null gracefully.
 */
export async function callAnthropic(
  args: CallAnthropicArgs,
): Promise<AnthropicResult | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;

  const body = {
    model: args.model ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL,
    max_tokens: args.maxTokens ?? 200,
    temperature: args.temperature ?? 0.4,
    system: args.system,
    messages: args.messages,
  };

  let res: Response;
  try {
    res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": API_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch {
    return null;
  }

  if (!res.ok) {
    return null;
  }

  type AnthropicResponse = {
    content?: Array<{ type?: string; text?: string }>;
    stop_reason?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
  };

  let json: AnthropicResponse;
  try {
    json = (await res.json()) as AnthropicResponse;
  } catch {
    return null;
  }

  const text = (json.content ?? [])
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text!)
    .join("\n")
    .trim();

  return {
    text,
    inputTokens: json.usage?.input_tokens ?? 0,
    outputTokens: json.usage?.output_tokens ?? 0,
    stopReason: json.stop_reason,
  };
}
