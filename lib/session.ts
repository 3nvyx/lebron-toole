import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { connection } from "next/server";

/**
 * GitHub-backed identity. A signed, HTTP-only cookie carries the GitHub login;
 * no database table is needed. Configure GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET
 * (and optionally GITHUB_ALLOWED_USERS, SESSION_SECRET) to turn it on.
 */

export const SESSION_COOKIE = "readme_session";
export const STATE_COOKIE = "readme_oauth_state";
const SESSION_DAYS = 30;

export type User = {
  login: string;
  name: string;
  avatarUrl: string;
};

export function githubConfigured(): boolean {
  return Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
}

export function allowedUsers(): string[] | null {
  const raw = process.env.GITHUB_ALLOWED_USERS?.trim();
  if (!raw) return null;
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowed(login: string): boolean {
  const list = allowedUsers();
  return !list || list.includes(login.toLowerCase());
}

function secret(): string {
  const s = process.env.SESSION_SECRET || process.env.GITHUB_CLIENT_SECRET;
  if (!s) throw new Error("SESSION_SECRET (or GITHUB_CLIENT_SECRET) must be set to sign sessions");
  return s;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function encodeSession(user: User, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ ...user, exp: now + SESSION_DAYS * 86_400_000 })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function decodeSession(token: string | undefined, now = Date.now()): User | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let expected: string;
  try {
    expected = sign(payload);
  } catch {
    return null;
  }
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as Partial<User> & { exp?: number };
    if (!data.login || typeof data.exp !== "number" || data.exp < now) return null;
    if (!isAllowed(data.login)) return null;
    return { login: data.login, name: data.name || data.login, avatarUrl: data.avatarUrl || "" };
  } catch {
    return null;
  }
}

/** The signed-in GitHub user for this request, or null. */
export async function getUser(): Promise<User | null> {
  // Explicitly request-time: with Cache Components, the clock check below must
  // never run inside a prerender attempt.
  await connection();
  if (!githubConfigured()) return null;
  const jar = await cookies();
  return decodeSession(jar.get(SESSION_COOKIE)?.value);
}

export function sessionCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  };
}
