import { Suspense } from "react";
import type { Metadata } from "next";
import { listEvents, loadPage } from "@/lib/store";
import { PAGE_SLUG } from "@/lib/template";
import { ReadmePage } from "@/components/readme-page";
import { PageSkeleton } from "@/components/skeletons";
import { SignIn } from "@/components/sign-in";
import { getUser, githubConfigured } from "@/lib/session";

export const metadata: Metadata = { title: "Live README" };

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
  // Identity comes from the GitHub session cookie when OAuth is configured;
  // otherwise the page falls back to the browser-only name prompt.
  const user = await getUser();
  if (githubConfigured() && !user) {
    const params = await searchParams;
    const err = params.auth_error;
    return <SignIn error={typeof err === "string" ? err : undefined} />;
  }
  const initial = await loadPage(PAGE_SLUG);
  const events = initial.source === "db" ? await listEvents(PAGE_SLUG, 30) : [];
  return <ReadmePage initial={initial} initialEvents={events} user={user} />;
}
