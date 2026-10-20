import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";

export async function POST(req: Request) {
  const origin = process.env.APP_URL?.replace(/\/+$/, "") || new URL(req.url).origin;
  const res = NextResponse.redirect(`${origin}/`, { status: 303 });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
