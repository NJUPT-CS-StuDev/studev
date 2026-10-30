import { SkeletonBlock } from '@/shared/ui/SkeletonBlock';

export function SearchResultsSkeleton() {
    const tabWidths = ['w-12', 'w-16', 'w-16', 'w-16', 'w-16'];

    return (
        <div className="w-full">
            <div className="flex gap-4 mb-1 border-b border-[var(--line)] dark:border-[var(--line)] overflow-hidden whitespace-nowrap">
                {tabWidths.map((width, item) => (
                    <SkeletonBlock key={item} className={`h-5 ${width} mb-2 rounded shrink-0`} />
                ))}
            </div>

            <SkeletonBlock className="mt-2 h-4 w-64 max-w-full rounded" />

            <div className="mt-3 rounded-md border border-[var(--line)] dark:border-[var(--line)] bg-[var(--surface)] dark:bg-[var(--surface)] px-3 py-2">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2">
                        <SkeletonBlock className="h-4 w-4 rounded-full shrink-0" />
                        <SkeletonBlock className="h-4 w-48 max-w-full rounded" />
                    </div>
                    <SkeletonBlock className="h-4 w-20 rounded" />
                </div>
            </div>

            <div className="mt-4">
                {[0, 1, 2, 3].map(item => (
                    <div key={item} className="max-w-[692px] py-4 border-b border-[var(--line)] dark:border-[var(--line)]">
                        <div className="flex items-center gap-2 mb-2">
                            <SkeletonBlock className="h-3 w-32 rounded" />
                        </div>
                        <SkeletonBlock className="h-6 w-3/4 rounded mb-3" />
                        <SkeletonBlock className="h-3.5 w-full rounded mb-3" />
                        <div className="space-y-2">
                            <SkeletonBlock className="h-3.5 w-full rounded" />
                            <SkeletonBlock className="h-3.5 w-5/6 rounded" />
                        </div>
                        <div className="flex gap-2 mt-3">
                            <SkeletonBlock className="h-6 w-28 rounded" />
                            <SkeletonBlock className="h-6 w-20 rounded" />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
