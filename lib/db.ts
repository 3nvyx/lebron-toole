/**
 * Lazy Neon HTTP client. Server-only by construction (reads process.env);
 * never import from a client component.
 *
 * jsonb parameters are passed as `${JSON.stringify(x)}::jsonb`.
 */
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

export type Sql = NeonQueryFunction<false, false>;

let cached: { url: string; sql: Sql } | null = null;

export function hasDb(): boolean {
  const url = process.env.DATABASE_URL;
  return typeof url === "string" && url.trim().length > 0;
}

/** Returns the shared tagged-template client, or null when DATABASE_URL is unset. */
export function getSql(): Sql | null {
  if (!hasDb()) return null;
  const url = process.env.DATABASE_URL!.trim();
  if (!cached || cached.url !== url) cached = { url, sql: neon(url) };
  return cached.sql;
}
