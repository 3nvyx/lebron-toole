import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { encodeSession, githubConfigured, isAllowed, SESSION_COOKIE, sessionCookieOptions, STATE_COOKIE, type User } from "@/lib/session";

/** Step 2: GitHub sends the browser back with a code; trade it for the user's identity. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = process.env.APP_URL?.replace(/\/+$/, "") || url.origin;
  const fail = (reason: string) => NextResponse.redirect(`${origin}/?auth_error=${encodeURIComponent(reason)}`);

  if (!githubConfigured()) return fail("github_not_configured");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const jar = await cookies();
  const expectedState = jar.get(STATE_COOKIE)?.value;
  if (!code || !state || !expectedState || state !== expectedState) return fail("bad_state");

  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${origin}/api/auth/github/callback`,
    }),
  });
  const token = (await tokenRes.json().catch(() => ({}))) as { access_token?: string; error?: string };
  if (!tokenRes.ok || !token.access_token) return fail(token.error || "token_exchange_failed");

  const userRes = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${token.access_token}`, Accept: "application/vnd.github+json", "User-Agent": "live-readme" },
  });
  const gh = (await userRes.json().catch(() => ({}))) as { login?: string; name?: string | null; avatar_url?: string };
  if (!userRes.ok || !gh.login) return fail("user_fetch_failed");
  if (!isAllowed(gh.login)) return fail("not_allowed");

  const user: User = { login: gh.login, name: gh.name || gh.login, avatarUrl: gh.avatar_url || "" };
  const res = NextResponse.redirect(`${origin}/`);
  res.cookies.set(SESSION_COOKIE, encodeSession(user), sessionCookieOptions(origin.startsWith("https")));
  res.cookies.set(STATE_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
