import { CalendarDays } from 'lucide-react';
import { lazy, Suspense, useEffect, useState } from 'react';
import type { ExamSnapshotClient } from './model/ExamSnapshotClient';
import type { ExamHistoryClient } from './model/ExamHistoryClient';
import { ProductLandingCard } from '@/shared/ui/ProductLandingCard';

const ExamHistoryLanding = lazy(() => import('./ExamHistoryLanding').then(module => ({
    default: module.ExamHistoryLanding,
})));

interface ExamLandingProps {
    savedClass: string | null;
    onSubmit: (value: string) => void;
    onOpenClass: (className: string) => void;
    client: ExamSnapshotClient;
    historyClient: ExamHistoryClient | null;
}

export function ExamLanding({ savedClass, onSubmit, onOpenClass, client, historyClient }: ExamLandingProps) {
    const [classInput, setClassInput] = useState('');
    useEffect(() => {
        const controller = new AbortController();
        void client.initialize(controller.signal).catch(() => {
            // The detail route reports artifact failures if the user submits a class.
        });
        return () => controller.abort();
    }, [client]);
    return (
        <main className="mx-auto flex-1 w-full max-w-6xl px-4 pb-6 pt-2 sm:pt-3">
            <section className="mt-4 sm:mt-8">
                <ProductLandingCard
                    icon={<CalendarDays className="h-7 w-7" aria-hidden="true" />}
                    title="查询考试安排"
                    description="输入班级号，查看考试时间、地点和考场。"
                >
                    <form
                        className="mx-auto mt-5 grid max-w-[440px] grid-cols-[minmax(0,1fr)_88px] gap-2 sm:mt-6 sm:grid-cols-[minmax(0,1fr)_96px] sm:gap-3"
                        onSubmit={(event) => {
                            event.preventDefault();
                            if (classInput.trim()) onSubmit(classInput);
                        }}
                    >
                        <label className="sr-only" htmlFor="exam-class-input">班级号</label>
                        <input
                            id="exam-class-input"
                            value={classInput}
                            onChange={event => setClassInput(event.target.value)}
                            placeholder="输入班级号"
                            autoComplete="off"
                            className="h-12 min-w-0 w-full rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 text-[15px] text-[var(--ink)] outline-none focus:border-[var(--brand)] dark:border-[var(--line)] dark:bg-[var(--paper)] dark:text-[var(--ink)] sm:h-11"
                        />
                        <button
                            type="submit"
                            className="h-12 w-full rounded-lg bg-[var(--brand)] px-3 text-[14px] font-medium text-[var(--on-brand)] hover:bg-[var(--brand)] sm:h-11"
                        >
                            查询
                        </button>
                    </form>
                    <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-[13px]">
                        <button
                            type="button"
                            onClick={() => onSubmit('B240402')}
                            className="inline-flex h-9 items-center rounded-full px-3 text-[var(--muted)] hover:bg-[var(--paper)] dark:text-[var(--muted)] dark:hover:bg-[var(--surface-sunken)]"
                        >
                            试一试&nbsp;<span className="font-mono text-[var(--brand)] dark:text-[var(--brand)]">B240402</span>
                        </button>
                        {savedClass ? (
                            <button
                                type="button"
                                onClick={() => onOpenClass(savedClass)}
                                className="inline-flex h-9 items-center rounded-full border border-[var(--brand-container)] bg-[var(--paper)] px-3 font-medium text-[var(--brand)] hover:bg-[var(--mark)] dark:border-[var(--brand-container)] dark:bg-[var(--paper)] dark:text-[var(--brand)] dark:hover:bg-[var(--mark)]"
                            >
                                继续查看 {savedClass}
                            </button>
                        ) : null}
                    </div>
                </ProductLandingCard>
                {historyClient ? (
                    <Suspense fallback={null}>
                        <ExamHistoryLanding client={historyClient} />
                    </Suspense>
                ) : null}
            </section>
        </main>
    );
}
