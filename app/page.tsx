import { Suspense } from "react";
import type { Metadata } from "next";
import { listEvents, loadPage } from "@/lib/store";
import { PAGE_SLUG } from "@/lib/template";
import { ReadmePage } from "@/components/readme-page";
import { PageSkeleton } from "@/components/skeletons";

export const metadata: Metadata = { title: "Live README" };

export default function Page() {
  return (
    <main className="mx-auto w-full max-w-[760px] px-6 pb-40 pt-16 sm:px-10 sm:pt-24">
      <Suspense fallback={<PageSkeleton />}>
        <LoadedPage />
      </Suspense>
    </main>
  );
}

async function LoadedPage() {
  const initial = await loadPage(PAGE_SLUG);
  const events = initial.source === "db" ? await listEvents(PAGE_SLUG, 30) : [];
  return <ReadmePage initial={initial} initialEvents={events} />;
}
