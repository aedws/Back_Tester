/**
 * Lightweight Yahoo Finance RSS reader.
 *
 * Yahoo exposes a free, unauthenticated RSS feed for top stories. We pull a
 * handful of headlines and feed them (titles only — no body) into the
 * Claude commentary so it can mention market context. No third-party RSS
 * library: a pure-regex parser keeps the bundle small and avoids vendoring
 * a full XML stack into our serverless functions.
 */

import { kvGetJson, kvSetJson } from "./cache";

export interface NewsHeadline {
  title: string;
  link: string;
  pubDate: string;
}

const FEED_URL = "https://finance.yahoo.com/news/rssindex";
const KV_KEY = "yahoo:news:v1";
const TTL_MS = 15 * 60_000;
const TTL_S = Math.ceil(TTL_MS / 1000);

interface CacheEntry {
  ts: number;
  items: NewsHeadline[];
}

let MEM_CACHE: CacheEntry | null = null;

/**
 * Fetch the latest top headlines from Yahoo Finance. Returns at most
 * `limit` items (default 8). Two-tier cached (memory + KV) to keep the
 * dependency on Yahoo's CDN minimal.
 */
export async function fetchYahooHeadlines(limit = 8): Promise<NewsHeadline[]> {
  const now = Date.now();
  if (MEM_CACHE && now - MEM_CACHE.ts < TTL_MS) {
    return MEM_CACHE.items.slice(0, limit);
  }
  const persisted = await kvGetJson<CacheEntry>(KV_KEY);
  if (persisted && now - persisted.ts < TTL_MS) {
    MEM_CACHE = persisted;
    return persisted.items.slice(0, limit);
  }

  let xml: string;
  try {
    const res = await fetch(FEED_URL, {
      // Yahoo's RSS endpoint is friendly to anonymous fetches but rejects
      // requests without a User-Agent.
      headers: { "User-Agent": "Mozilla/5.0 (compatible; BackTesterBot/1.0)" },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Yahoo RSS HTTP ${res.status}`);
    xml = await res.text();
  } catch {
    // On fetch failure, return any stale cache rather than empty.
    if (MEM_CACHE) return MEM_CACHE.items.slice(0, limit);
    return [];
  }

  const items = parseRss(xml).slice(0, 20);
  const entry: CacheEntry = { ts: now, items };
  MEM_CACHE = entry;
  void kvSetJson(KV_KEY, entry, TTL_S).catch(() => undefined);
  return items.slice(0, limit);
}

/* ───────────────────── parser ───────────────────── */

function parseRss(xml: string): NewsHeadline[] {
  const out: NewsHeadline[] = [];
  // Match each <item>...</item> block.
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml))) {
    const block = m[1];
    const title = extractTag(block, "title");
    const link = extractTag(block, "link");
    const pubDate = extractTag(block, "pubDate");
    if (!title) continue;
    out.push({
      title: stripHtml(title),
      link: link ?? "",
      pubDate: pubDate ?? "",
    });
  }
  return out;
}

function extractTag(block: string, tag: string): string | null {
  // Try CDATA first.
  const cdata = new RegExp(
    `<${tag}\\b[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*<\\/${tag}>`,
    "i",
  );
  const cm = block.match(cdata);
  if (cm) return cm[1].trim();

  const plain = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const pm = block.match(plain);
  if (pm) return decodeEntities(pm[1].trim());
  return null;
}

function stripHtml(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim());
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}
