function Bar({ w, h = "h-4" }: { w: string; h?: string }) {
  return <div className={`${h} ${w} rounded bg-neutral-200/70 dark:bg-neutral-800`} />;
}

export function EditorSkeleton() {
  return (
    <div className="space-y-3 py-2" aria-hidden>
      <Bar w="w-2/3" />
      <Bar w="w-5/6" />
      <Bar w="w-1/2" />
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="animate-pulse" aria-busy aria-label="Loading page">
      <div className="h-12 w-12 rounded-lg bg-neutral-200/70 dark:bg-neutral-800" />
      <div className="mt-5 h-10 w-72 rounded bg-neutral-200/70 dark:bg-neutral-800" />
      <div className="mt-3 h-4 w-80 rounded bg-neutral-200/70 dark:bg-neutral-800" />
      <div className="mt-10 space-y-8">
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-3">
            <Bar w="w-32" h="h-6" />
            <Bar w="w-3/4" />
            <Bar w="w-2/3" />
          </div>
        ))}
      </div>
    </div>
  );
}
