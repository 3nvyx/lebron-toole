import { connection, NextResponse } from "next/server";
import { authorize } from "@/lib/auth";
import { hasDb } from "@/lib/db";
import { listEvents } from "@/lib/store";
import { PAGE_SLUG } from "@/lib/template";

export async function GET(req: Request) {
  await connection();
  const auth = await authorize(req);
  if (!auth.ok) return NextResponse.json({ error: "unauthorized", message: auth.message }, { status: auth.status });
  if (!hasDb()) {
    return NextResponse.json(
      { error: "not_connected", message: "DATABASE_URL is not set; the page is running on browser localStorage only" },
      { status: 503 },
    );
  }
  const url = new URL(req.url);
  const limitRaw = Number(url.searchParams.get("limit") ?? "30");
  const afterRaw = url.searchParams.get("after");
  const limit = Number.isFinite(limitRaw) ? limitRaw : 30;
  const after = afterRaw !== null && afterRaw !== "" && Number.isFinite(Number(afterRaw)) ? Number(afterRaw) : undefined;
  const events = await listEvents(PAGE_SLUG, limit, after);
  return NextResponse.json({ events });
}
