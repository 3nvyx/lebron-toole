/** Shown instead of the page until GitHub sign-in is configured. */
export function SetupGitHub({ origin }: { origin: string }) {
  const callback = `${origin}/api/auth/github/callback`;
  const code = "rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[13px] dark:bg-neutral-800";
  return (
    <div className="mt-10 max-w-xl">
      <h1 className="text-[32px] font-bold tracking-tight">Live README</h1>
      <p className="mt-2 text-[15px] text-neutral-500">
        Everyone signs in with GitHub, so every change on the page shows a real name and avatar. Finish this one-time setup first.
      </p>
      <ol className="mt-6 list-decimal space-y-3 pl-5 text-[15px]">
        <li>
          Create an OAuth app at{" "}
          <a href="https://github.com/settings/applications/new" target="_blank" rel="noreferrer" className="underline underline-offset-2">
            github.com/settings/applications/new
          </a>
          . Homepage URL <span className={code}>{origin}</span>, callback URL <span className={code}>{callback}</span>.
        </li>
        <li>
          Generate a client secret, then put both values in <span className={code}>.env.local</span>:
          <pre className="mt-2 overflow-x-auto rounded-md bg-neutral-100 p-3 font-mono text-[13px] dark:bg-neutral-800">{`GITHUB_CLIENT_ID=...\nGITHUB_CLIENT_SECRET=...\n# optional: only these GitHub logins may sign in\nGITHUB_ALLOWED_USERS=your-login,friend-login`}</pre>
        </li>
        <li>
          Restart the dev server. This screen is replaced by a <span className="font-medium">Sign in with GitHub</span> button.
        </li>
      </ol>
      <p className="mt-6 text-[13px] text-neutral-400">Agents never sign in; they use README_TOKEN with the API or MCP server.</p>
    </div>
  );
}
