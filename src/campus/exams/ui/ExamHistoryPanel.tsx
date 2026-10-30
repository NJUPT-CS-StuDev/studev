import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ExamChange, ExamSlot, ExamSource } from '@/academics/facts';
import { observedTime, sourceDays } from '../model/sourceDays';

interface ExamHistoryPanelProps {
    changes: ExamChange[] | null;
    sources: ExamSource[];
    className: string;
    loading: boolean;
    error: string | null;
}

// Format before/after slots for people, without creating another history schema.
const slotColumns: Array<[string, (slot: ExamSlot) => string | number | null]> = [
    ['考试时间', slot => slot.date + ' ' + slot.start + '-' + slot.end],
    ['考试地点', slot => slot.location], ['校区', slot => slot.campus],
    ['教师', slot => slot.teacher], ['考试人数', slot => slot.students],
];
const slotText = (slots: ExamSlot[] | null, value: (slot: ExamSlot) => string | number | null): string =>
    [...new Set((slots ?? []).map(value))].map(v => v === null || v === '' ? '未填写' : String(v)).join('、') || '未填写';
const changeLines = (change: ExamChange): string[] => change.change === 'changed'
    ? slotColumns.flatMap(([label, value]) => {
        const before = slotText(change.before, value), after = slotText(change.after, value);
        return before === after ? [] : [label + '由' + before + '调整为' + after + '。'];
    })
    : [];

function ChangeCard({ change }: { change: ExamChange }) {
    const label = change.change === 'added' ? '新增' : change.change === 'removed' ? '记录已移除' : '调整';
    const color = change.change === 'added'
        ? 'bg-[var(--success-bg)] text-[var(--success)] dark:bg-[var(--success-bg)] dark:text-[var(--success)]'
        : change.change === 'removed'
            ? 'bg-[var(--danger-bg)] text-[var(--danger)] dark:bg-[var(--danger-bg)] dark:text-[var(--danger)]'
            : 'bg-[var(--mark)] text-[var(--brand)] dark:bg-[var(--mark)] dark:text-[var(--brand)]';
    return (
        <li className="rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-3 dark:border-[var(--line)] dark:bg-[var(--paper)]">
            <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[12px] font-medium ${color}`}>{label}</span>
                <span className="font-medium text-[var(--ink)] dark:text-[var(--ink)]">{change.course.name}</span>
                <span className="text-[12px] text-[var(--muted)] dark:text-[var(--muted)]">{change.course.code}</span>
            </div>
            <ul className="mt-2 space-y-1 text-[13px] text-[var(--muted)] dark:text-[var(--muted)]">
                {changeLines(change).map(line => <li key={line}>{line}</li>)}
            </ul>
        </li>
    );
}

function HistoryEvent({ observed, changes, defaultExpanded }: { observed: string; changes: ExamChange[]; defaultExpanded: boolean }) {
    const [expanded, setExpanded] = useState(defaultExpanded);
    return (
        <li className="rounded-lg border border-[var(--line)] dark:border-[var(--line)]">
            <button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)} className="flex w-full items-center gap-2 px-3 py-3 text-left hover:bg-[var(--surface)] dark:hover:bg-[var(--surface)]">
                {expanded ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}
                <span className="text-[14px] font-medium">{observedTime(observed)}</span>
                <span className="rounded-full bg-[var(--surface-sunken)] px-2 py-0.5 text-[12px] text-[var(--muted)] dark:bg-[var(--surface)] dark:text-[var(--muted)]">有调整</span>
            </button>
            {expanded ? <div className="border-t border-[var(--line)] bg-[var(--surface)] px-3 py-3 dark:border-[var(--line)] dark:bg-[var(--surface)]">
                <ul className="space-y-2">{changes.map((change, i) => <ChangeCard key={i} change={change} />)}</ul>
            </div> : null}
        </li>
    );
}

export function ExamHistoryPanel({ changes, sources, className, loading, error }: ExamHistoryPanelProps) {
    const days = sourceDays(sources);
    const observed = [...new Set((changes ?? []).map(c => c.observed))].sort().reverse();
    return (
        <section className="mt-6" aria-labelledby="exam-history-title">
            <h2 id="exam-history-title" className="text-[22px] font-normal text-[var(--ink)] dark:text-[var(--ink)]">考试安排更新记录</h2>
            {loading ? <p className="mt-3 text-[14px] text-[var(--muted)] dark:text-[var(--muted)]">正在读取 {className} 的更新记录…</p> : null}
            {error ? <p className="mt-3 text-[14px] text-[var(--danger)] dark:text-[var(--danger)]">{error}</p> : null}
            {!loading && !error && !changes?.length ? <p className="mt-3 text-[14px] text-[var(--muted)] dark:text-[var(--muted)]">暂时没有这个班级的更新记录。</p> : null}
            {changes?.length ? (
                <div className="mt-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 dark:border-[var(--line)] dark:bg-[var(--surface)]">
                    <p className="text-[14px] text-[var(--muted)] dark:text-[var(--muted)]">
                        系统共更新 {days.length} 次，其中 {observed.length} 次影响本班。
                    </p>
                    {observed[0] ? (
                        <p className="mt-1 text-[13px] text-[var(--muted)] dark:text-[var(--muted)]">最近一次影响本班：{observedTime(observed[0])}。</p>
                    ) : (
                        <p className="mt-1 text-[13px] text-[var(--muted)] dark:text-[var(--muted)]">从本次考试安排开始记录，暂时还没有后续变化。</p>
                    )}
                    <ol className="mt-4 space-y-2">
                        {observed.map((date, index) => (
                            <HistoryEvent key={date} observed={date} changes={changes.filter(c => c.observed === date)} defaultExpanded={index === 0} />
                        ))}
                    </ol>
                </div>
            ) : null}
        </section>
    );
}
