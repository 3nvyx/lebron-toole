const ERRORS: Record<string, string> = {
  bad_state: "The sign-in link expired. Try again.",
  not_allowed: "That GitHub account isn't on the allowed list for this page.",
  token_exchange_failed: "GitHub didn't accept the sign-in. Check GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.",
  user_fetch_failed: "Couldn't read your GitHub profile. Try again.",
  github_not_configured: "GitHub sign-in isn't configured on this server.",
};

export function SignIn({ error }: { error?: string }) {
  return (
    <div className="mt-10 max-w-md">
      <h1 className="text-[32px] font-bold tracking-tight">Live README</h1>
      <p className="mt-2 text-[15px] text-neutral-500">Sign in with GitHub to see and edit the team page. Your GitHub login is what shows next to every change.</p>
      <a
        href="/api/auth/github"
        className="mt-6 inline-flex h-10 items-center gap-2 rounded-md bg-neutral-900 px-4 text-[14px] font-medium text-white hover:bg-neutral-700 dark:bg-neutral-50 dark:text-neutral-950 dark:hover:bg-neutral-100"
      >
        <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
        </svg>
        Sign in with GitHub
      </a>
      {error && <p className="mt-4 text-[13px] text-red-600 dark:text-red-400">{ERRORS[error] ?? `Sign-in failed (${error}).`}</p>}
    </div>
  );
}
