/**
 * Bearer-token auth for the HTTP API.
 *
 * Order: README_TOKEN env match -> api_keys row -> localhost (only when no
 * README_TOKEN is configured). Otherwise 401.
 */
import { getSql } from "./db";

export type AuthResult = { ok: true; name: string } | { ok: false; status: 401 | 403; message: string };

const HELP = "Set README_TOKEN and send `Authorization: Bearer <token>` (or an `x-readme-token` header).";

function bearerToken(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth) {
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (m) return m[1].trim();
  }
  const alt = req.headers.get("x-readme-token");
  return alt ? alt.trim() : null;
}

function isLocalHost(req: Request): boolean {
  const host = (req.headers.get("host") ?? "").trim().toLowerCase();
  if (!host) return false;
  // [::1]:3000 | localhost:3000 | 127.0.0.1
  const name = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.replace(/:\d+$/, "");
  return name === "localhost" || name === "127.0.0.1" || name === "[::1]";
}

export async function authorize(req: Request): Promise<AuthResult> {
  const configured = (process.env.README_TOKEN ?? "").trim();
  const token = bearerToken(req);

  if (token) {
    if (configured && token === configured) return { ok: true, name: "token" };

    const sql = getSql();
    if (sql) {
      try {
        const rows = (await sql`
          select name from api_keys where token = ${token} and revoked_at is null limit 1
        `) as { name: string }[];
        if (rows[0]?.name) return { ok: true, name: rows[0].name };
      } catch {
        // Missing table or DB error: treat as "no such key".
      }
    }
  }

  if (!configured && isLocalHost(req)) return { ok: true, name: "localhost" };

  return {
    ok: false,
    status: 401,
    message: token ? `Unknown or revoked token. ${HELP}` : `Missing token. ${HELP}`,
  };
}
