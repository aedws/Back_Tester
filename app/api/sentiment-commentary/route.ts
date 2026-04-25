import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { callAnthropic, isAnthropicAvailable } from "@/lib/anthropic";
import { kvGetJson, kvSetJson } from "@/lib/cache";
import type { SentimentResult } from "@/lib/sentiment";
import { fetchYahooHeadlines, type NewsHeadline } from "@/lib/yahooNews";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Refresh cadence — 30 minutes. Inside this window we always serve the
 * cached commentary even if the request rate is much higher.
 */
const REFRESH_MS = 30 * 60_000;
const REFRESH_S = Math.ceil(REFRESH_MS / 1000);
const KV_KEY = "sentiment:commentary:v1";
const NO_CHANGE_TOKEN = "NO_CHANGE";

interface StoredEntry {
  /** Last time we ran a refresh (Claude call or signature-skip). */
  ts: number;
  /** Last published commentary. */
  commentary: string;
  /** SHA1 of the input bundle that produced `commentary`. */
  signature: string;
  /** F&G score that produced `commentary` — exposed for debugging. */
  score: number;
  /** Number of headlines used. */
  headlineCount: number;
  /** Approximate token usage of the *last* live LLM call (0 for skip). */
  inputTokens: number;
  outputTokens: number;
  /**
   * "live"    — fresh from Claude
   * "no-sig"  — signature unchanged, served prior commentary
   * "no-chg"  — Claude said NO_CHANGE, kept prior commentary
   * "off"     — ANTHROPIC_API_KEY missing
   */
  mode: "live" | "no-sig" | "no-chg" | "off";
}

interface SentimentApiPayload extends Partial<SentimentResult> {
  cached?: boolean;
  ageMs?: number;
  ttlMs?: number;
}

export async function GET(req: Request) {
  if (!isAnthropicAvailable()) {
    return NextResponse.json(
      {
        available: false,
        commentary: null,
        reason: "ANTHROPIC_API_KEY 환경 변수가 설정되지 않았습니다.",
      },
      { status: 200 },
    );
  }

  const now = Date.now();
  const stored = await kvGetJson<StoredEntry>(KV_KEY);

  // Inside the refresh window: just serve stored commentary, no work.
  if (stored && now - stored.ts < REFRESH_MS) {
    return NextResponse.json({
      available: true,
      commentary: stored.commentary,
      asOf: new Date(stored.ts).toISOString(),
      ageMs: now - stored.ts,
      nextRefreshMs: REFRESH_MS - (now - stored.ts),
      mode: stored.mode,
      score: stored.score,
      headlineCount: stored.headlineCount,
    });
  }

  // Need a refresh. Pull sentiment + headlines in parallel.
  const origin = new URL(req.url).origin;
  const [sentiment, headlines] = await Promise.all([
    fetchSentiment(origin).catch(() => null),
    fetchYahooHeadlines(8).catch(() => [] as NewsHeadline[]),
  ]);

  if (!sentiment || typeof sentiment.score !== "number") {
    // Fall back to whatever we had cached; never error out the page.
    if (stored) {
      return NextResponse.json({
        available: true,
        commentary: stored.commentary,
        asOf: new Date(stored.ts).toISOString(),
        ageMs: now - stored.ts,
        mode: "no-sig",
        score: stored.score,
        headlineCount: stored.headlineCount,
        warning: "공포탐욕지수 새로고침 실패 — 이전 코멘트 유지",
      });
    }
    return NextResponse.json(
      { available: true, commentary: null, reason: "지표 데이터 없음" },
      { status: 200 },
    );
  }

  const signature = buildSignature(sentiment, headlines);

  // Skip the LLM entirely when nothing meaningful has moved since the last
  // refresh. This is the cheap path.
  if (stored && stored.signature === signature) {
    const updated: StoredEntry = {
      ...stored,
      ts: now,
      mode: "no-sig",
    };
    void kvSetJson(KV_KEY, updated, REFRESH_S * 4).catch(() => undefined);
    return NextResponse.json({
      available: true,
      commentary: stored.commentary,
      asOf: new Date(now).toISOString(),
      ageMs: 0,
      nextRefreshMs: REFRESH_MS,
      mode: "no-sig",
      score: stored.score,
      headlineCount: stored.headlineCount,
    });
  }

  // Signature changed → ask Claude. Include the previous commentary so it
  // can compare and answer NO_CHANGE if the new state isn't materially
  // different.
  const llm = await callClaudeForCommentary({
    sentiment,
    headlines,
    previousCommentary: stored?.commentary ?? null,
  });

  if (!llm) {
    if (stored) {
      // Live call failed — keep last commentary.
      const updated: StoredEntry = { ...stored, ts: now, mode: "no-sig" };
      void kvSetJson(KV_KEY, updated, REFRESH_S * 4).catch(() => undefined);
      return NextResponse.json({
        available: true,
        commentary: stored.commentary,
        asOf: new Date(now).toISOString(),
        ageMs: 0,
        mode: "no-sig",
        score: stored.score,
        headlineCount: stored.headlineCount,
        warning: "Claude 호출 실패 — 이전 코멘트 유지",
      });
    }
    return NextResponse.json(
      {
        available: true,
        commentary: null,
        reason: "Claude 호출에 실패했습니다.",
      },
      { status: 200 },
    );
  }

  // Claude responded NO_CHANGE → keep prior commentary, do NOT overwrite.
  const cleaned = llm.text.trim();
  const isNoChange =
    !cleaned ||
    new RegExp(`^${NO_CHANGE_TOKEN}\\b`, "i").test(cleaned) ||
    cleaned.toUpperCase().includes(NO_CHANGE_TOKEN);

  if (isNoChange && stored) {
    const updated: StoredEntry = {
      ts: now,
      commentary: stored.commentary,
      signature,
      score: sentiment.score,
      headlineCount: headlines.length,
      inputTokens: llm.inputTokens,
      outputTokens: llm.outputTokens,
      mode: "no-chg",
    };
    void kvSetJson(KV_KEY, updated, REFRESH_S * 4).catch(() => undefined);
    return NextResponse.json({
      available: true,
      commentary: stored.commentary,
      asOf: new Date(now).toISOString(),
      ageMs: 0,
      nextRefreshMs: REFRESH_MS,
      mode: "no-chg",
      score: sentiment.score,
      headlineCount: headlines.length,
      tokenUsage: {
        input: llm.inputTokens,
        output: llm.outputTokens,
      },
    });
  }

  const finalCommentary = isNoChange ? cleaned : cleaned;
  const entry: StoredEntry = {
    ts: now,
    commentary: finalCommentary,
    signature,
    score: sentiment.score,
    headlineCount: headlines.length,
    inputTokens: llm.inputTokens,
    outputTokens: llm.outputTokens,
    mode: "live",
  };
  void kvSetJson(KV_KEY, entry, REFRESH_S * 4).catch(() => undefined);

  return NextResponse.json({
    available: true,
    commentary: finalCommentary,
    asOf: new Date(now).toISOString(),
    ageMs: 0,
    nextRefreshMs: REFRESH_MS,
    mode: "live",
    score: sentiment.score,
    headlineCount: headlines.length,
    tokenUsage: {
      input: llm.inputTokens,
      output: llm.outputTokens,
    },
  });
}

/* ───────────────────── helpers ───────────────────── */

async function fetchSentiment(origin: string): Promise<SentimentApiPayload | null> {
  try {
    const res = await fetch(`${origin}/api/sentiment`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as SentimentApiPayload;
  } catch {
    return null;
  }
}

/**
 * Build a stable input signature. We bucket numeric values aggressively so
 * tiny tick-by-tick wobbles don't trigger LLM calls.
 *  - F&G score → bucket of 2
 *  - Each component score → bucket of 5
 *  - Headlines → titles concatenated → SHA1
 */
function buildSignature(
  sentiment: SentimentApiPayload,
  headlines: NewsHeadline[],
): string {
  const score = Math.round((sentiment.score ?? 50) / 2) * 2;
  const components = (sentiment.components ?? [])
    .map(
      (c) =>
        `${c.key}:${
          c.score === null || c.score === undefined
            ? "X"
            : Math.round(c.score / 5) * 5
        }`,
    )
    .sort()
    .join(",");
  const titles = headlines
    .map((h) => h.title.toLowerCase().trim())
    .slice(0, 8)
    .join("|");
  const raw = `${score}|${components}|${titles}`;
  return createHash("sha1").update(raw).digest("hex");
}

interface ClaudeArgs {
  sentiment: SentimentApiPayload;
  headlines: NewsHeadline[];
  previousCommentary: string | null;
}

async function callClaudeForCommentary(args: ClaudeArgs) {
  const { sentiment, headlines, previousCommentary } = args;

  const componentLines = (sentiment.components ?? [])
    .map(
      (c) =>
        `- ${c.label}(${c.key}): ${c.score === null ? "데이터 없음" : c.score} / 100 — ${c.raw}`,
    )
    .join("\n");
  const headlineLines = headlines
    .slice(0, 8)
    .map((h, i) => `${i + 1}. ${h.title}`)
    .join("\n");

  const userPrompt = [
    `현재 공포탐욕지수: ${sentiment.score} / 100 (${sentiment.label})`,
    "",
    "구성 요소:",
    componentLines || "(없음)",
    "",
    "Yahoo Finance 최신 헤드라인 (영문):",
    headlineLines || "(없음)",
    "",
    previousCommentary
      ? `직전 코멘트:\n"${previousCommentary}"`
      : "직전 코멘트 없음.",
    "",
    "위 정보를 바탕으로 한국어로 1~2문장 시장 메모를 작성해주세요.",
    "수치는 구체적으로 인용하고, 영문 헤드라인은 자연스러운 한국어로 옮겨 본문에 녹이세요.",
    "직전 코멘트와 본질적으로 다른 시장 상태가 아니라면 첫 줄에 정확히 'NO_CHANGE'만 출력하고 다른 텍스트는 쓰지 마세요.",
    "서술형 어조, 마크다운/이모지 없음.",
  ].join("\n");

  return callAnthropic({
    system:
      "당신은 한국어 금융 시장 코멘터입니다. 항상 간결하고 구체적인 수치 기반의 한 단락(1~2문장) 답을 합니다. 의미 있는 변화가 없으면 'NO_CHANGE'만 출력합니다.",
    messages: [{ role: "user", content: userPrompt }],
    maxTokens: 200,
    temperature: 0.3,
  });
}
