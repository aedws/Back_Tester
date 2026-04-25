/**
 * Lightweight KV (Redis) wrapper.
 *
 * Activates automatically when either of the two env-var pairs is present:
 *   - KV_REST_API_URL          + KV_REST_API_TOKEN          (Vercel KV / Marketplace Redis)
 *   - UPSTASH_REDIS_REST_URL   + UPSTASH_REDIS_REST_TOKEN   (Upstash standard)
 *
 * If neither is configured, all operations short-circuit to no-ops so the
 * app keeps working in local dev or unconfigured deploys.
 */
import { Redis } from "@upstash/redis";

let client: Redis | null = null;
let initialized = false;

function getClient(): Redis | null {
  if (initialized) return client;
  initialized = true;

  const url =
    process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL ?? "";
  const token =
    process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN ?? "";

  if (!url || !token) {
    client = null;
    return null;
  }
  try {
    client = new Redis({ url, token });
  } catch {
    client = null;
  }
  return client;
}

export function isKvAvailable(): boolean {
  return getClient() !== null;
}

/** Read a JSON value. Returns null on miss / parse error / KV unavailable. */
export async function kvGetJson<T>(key: string): Promise<T | null> {
  const c = getClient();
  if (!c) return null;
  try {
    const v = await c.get<unknown>(key);
    if (v === null || v === undefined) return null;
    // Upstash auto-deserializes JSON when the value was stored as JSON.
    if (typeof v === "string") {
      try {
        return JSON.parse(v) as T;
      } catch {
        return null;
      }
    }
    return v as T;
  } catch {
    return null;
  }
}

/**
 * Write a JSON value with optional TTL (seconds). When ttlSeconds is omitted
 * or non-positive the value is stored without expiry.
 */
export async function kvSetJson(
  key: string,
  value: unknown,
  ttlSeconds?: number,
): Promise<boolean> {
  const c = getClient();
  if (!c) return false;
  try {
    if (ttlSeconds && ttlSeconds > 0) {
      await c.set(key, value, { ex: Math.floor(ttlSeconds) });
    } else {
      await c.set(key, value);
    }
    return true;
  } catch {
    return false;
  }
}

/** Best-effort delete; returns true if KV was reachable. */
export async function kvDel(key: string): Promise<boolean> {
  const c = getClient();
  if (!c) return false;
  try {
    await c.del(key);
    return true;
  } catch {
    return false;
  }
}
