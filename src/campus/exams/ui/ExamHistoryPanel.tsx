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
        ? 'bg-[#e6f4ea] text-[#137333] dark:bg-[#143820] dark:text-[#81c995]'
        : change.change === 'removed'
            ? 'bg-[#fce8e6] text-[#b3261e] dark:bg-[#3b1715] dark:text-[#f28b82]'
            : 'bg-[#e8f0fe] text-[#1967d2] dark:bg-[#1f2d4d] dark:text-[#8ab4f8]';
    return (
        <li className="rounded-lg border border-[#dadce0] bg-white px-3 py-3 dark:border-[#323a44] dark:bg-[#14181d]">
            <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[12px] font-medium ${color}`}>{label}</span>
                <span className="font-medium text-[#202124] dark:text-[#e8edf3]">{change.course.name}</span>
                <span className="text-[12px] text-[#70757a] dark:text-[#9aa0a6]">{change.course.code}</span>
            </div>
            <ul className="mt-2 space-y-1 text-[13px] text-[#4d5156] dark:text-[#aeb8c5]">
                {changeLines(change).map(line => <li key={line}>{line}</li>)}
            </ul>
        </li>
    );
}

function HistoryEvent({ observed, changes, defaultExpanded }: { observed: string; changes: ExamChange[]; defaultExpanded: boolean }) {
    const [expanded, setExpanded] = useState(defaultExpanded);
    return (
        <li className="rounded-lg border border-[#dadce0] dark:border-[#323a44]">
            <button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)} className="flex w-full items-center gap-2 px-3 py-3 text-left hover:bg-[#f8f9fa] dark:hover:bg-[#1c232b]">
                {expanded ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}
                <span className="text-[14px] font-medium">{observedTime(observed)}</span>
                <span className="rounded-full bg-[#f1f3f4] px-2 py-0.5 text-[12px] text-[#5f6368] dark:bg-[#1c232b] dark:text-[#aeb8c5]">有调整</span>
            </button>
            {expanded ? <div className="border-t border-[#dadce0] bg-[#f8fbff] px-3 py-3 dark:border-[#323a44] dark:bg-[#252629]">
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
            <h2 id="exam-history-title" className="text-[22px] font-normal text-[#202124] dark:text-[#e8edf3]">考试安排更新记录</h2>
            {loading ? <p className="mt-3 text-[14px] text-[#70757a] dark:text-[#9aa0a6]">正在读取 {className} 的更新记录…</p> : null}
            {error ? <p className="mt-3 text-[14px] text-[#b3261e] dark:text-[#f28b82]">{error}</p> : null}
            {!loading && !error && !changes?.length ? <p className="mt-3 text-[14px] text-[#70757a] dark:text-[#9aa0a6]">暂时没有这个班级的更新记录。</p> : null}
            {changes?.length ? (
                <div className="mt-3 rounded-xl border border-[#dadce0] bg-[#f8fafc] p-4 dark:border-[#323a44] dark:bg-[#1c232b]">
                    <p className="text-[14px] text-[#4d5156] dark:text-[#aeb8c5]">
                        系统共更新 {days.length} 次，其中 {observed.length} 次影响本班。
                    </p>
                    {observed[0] ? (
                        <p className="mt-1 text-[13px] text-[#70757a] dark:text-[#9aa0a6]">最近一次影响本班：{observedTime(observed[0])}。</p>
                    ) : (
                        <p className="mt-1 text-[13px] text-[#70757a] dark:text-[#9aa0a6]">从本次考试安排开始记录，暂时还没有后续变化。</p>
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
