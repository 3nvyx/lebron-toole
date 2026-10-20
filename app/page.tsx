import { Suspense } from "react";
import type { Metadata } from "next";
import { listEvents, loadPage } from "@/lib/store";
import { PAGE_SLUG } from "@/lib/template";
import { ReadmePage } from "@/components/readme-page";
import { PageSkeleton } from "@/components/skeletons";
import { SignIn } from "@/components/sign-in";
import { SetupGitHub } from "@/components/setup-github";
import { getUser, githubConfigured } from "@/lib/session";
import { headers } from "next/headers";

export const metadata: Metadata = { title: "Lebron Toole" };

export default function Page({ searchParams }: PageProps<"/">) {
  return (
    <main className="mx-auto w-full max-w-[760px] px-6 pb-40 pt-16 sm:px-10 sm:pt-20">
      <Suspense fallback={<PageSkeleton />}>
        <LoadedPage searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function LoadedPage({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  // GitHub is the only identity: no login, no page.
  if (!githubConfigured()) {
    const h = await headers();
    const proto = h.get("x-forwarded-proto") ?? "http";
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
    return <SetupGitHub origin={process.env.APP_URL?.replace(/\/+$/, "") || `${proto}://${host}`} />;
  }
  const user = await getUser();
  if (!user) {
    const params = await searchParams;
    const err = params.auth_error;
    return <SignIn error={typeof err === "string" ? err : undefined} />;
  }
  const initial = await loadPage(PAGE_SLUG);
  const events = initial.source === "db" ? await listEvents(PAGE_SLUG, 30) : [];
  return <ReadmePage initial={initial} initialEvents={events} user={user} />;
}
