import { Skeleton, SkeletonRows } from "@/components/ui/Empty";

/**
 * The loading state.
 *
 * Reproduces the shell's real geometry — 216px rail, 48px bar, the panel the
 * content will occupy — so the first paint lands where the loaded page will and
 * nothing shifts underneath the pointer. No spinner: a spinner says "wait",
 * where this says "here is the shape of what is arriving".
 */
export function ShellSkeleton({
  rows = 8,
  cols = 5,
}: {
  rows?: number;
  cols?: number;
}) {
  return (
    <div className="flex min-h-screen w-full" aria-busy="true" aria-label="Loading">
      <div className="hidden w-sidebar shrink-0 flex-col border-r border-line sm:flex">
        <div className="flex h-topbar items-center gap-2 rule-b px-4">
          <Skeleton className="h-3.5 w-3.5" />
          <Skeleton className="h-3 w-16" />
        </div>
        <div className="flex flex-col gap-2 p-3">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2.5">
              <Skeleton className="h-3 w-3" />
              <Skeleton
                className="h-[7px]"
                style={{ width: `${[54, 46, 38, 42, 34, 50, 40][i]}%` }}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-topbar items-center gap-3 border-b border-line px-4">
          <Skeleton className="h-3 w-24" />
          <div className="ml-auto flex items-center gap-3">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-[22px] w-[22px] rounded-full" />
          </div>
        </div>

        <div className="mx-auto w-full max-w-work px-6 py-6">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="mt-2.5 h-3 w-80" />

          <div className="mt-8 flex gap-12">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i}>
                <Skeleton className="h-6 w-10" />
                <Skeleton className="mt-2 h-[7px] w-20" />
              </div>
            ))}
          </div>

          <div className="surface mt-8 overflow-hidden">
            <div className="flex h-8 items-center rule-b px-3">
              <Skeleton className="h-[7px] w-20" />
            </div>
            <SkeletonRows rows={rows} cols={cols} />
          </div>
        </div>
      </div>
    </div>
  );
}
