"use server";

/**
 * Server functions the client calls directly. Thin wrappers over lib/store.ts;
 * the client owns rendering, so nothing here refreshes or revalidates.
 */
import type { Op, PageEvent } from "./model";
import { getUser } from "./session";
import { commit, listEvents, loadPage, pollPage, type CommitResult, type LoadResult } from "./store";

export async function loadPageAction(slug: string): Promise<LoadResult> {
  return loadPage(slug);
}

export async function commitAction(
  slug: string,
  ops: Op[],
  by: string,
  expectedNotesVersion?: number,
): Promise<CommitResult> {
  // With GitHub sign-in on, the session decides who made the change; the
  // client-supplied name is only a fallback for the no-auth local mode.
  const user = await getUser();
  return commit(slug, ops, user?.login ?? by, { expectedNotesVersion });
}

export async function pollAction(slug: string, sinceVersion: number) {
  return pollPage(slug, sinceVersion);
}

export async function eventsAction(slug: string, limit?: number): Promise<PageEvent[]> {
  return listEvents(slug, limit);
}
