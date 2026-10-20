import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { githubConfigured, STATE_COOKIE } from "@/lib/session";

/** Step 1 of the OAuth dance: send the browser to GitHub with a one-time state. */
export async function GET(req: Request) {
  if (!githubConfigured()) {
    return NextResponse.json({ error: "github_not_configured", message: "Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET" }, { status: 503 });
  }
  const origin = process.env.APP_URL?.replace(/\/+$/, "") || new URL(req.url).origin;
  const state = randomBytes(16).toString("hex");
  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID!,
    redirect_uri: `${origin}/api/auth/github/callback`,
    scope: "read:user",
    state,
    allow_signup: "false",
  });
  const res = NextResponse.redirect(`https://github.com/login/oauth/authorize?${params}`);
  res.cookies.set(STATE_COOKIE, state, { httpOnly: true, sameSite: "lax", secure: origin.startsWith("https"), path: "/", maxAge: 600 });
  return res;
}
