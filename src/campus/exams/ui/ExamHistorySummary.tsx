import type { ExamChange, ExamSource } from '@/academics/facts';
import { sourceDays } from '../model/sourceDays';
interface ExamHistorySummaryProps { sources: ExamSource[]; changes: ExamChange[]; loading: boolean; error: string | null }

const formatTime = (value: string): string => new Date(value).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
});

export function ExamHistorySummary({ sources, changes, loading, error }: ExamHistorySummaryProps) {
    if (loading) {
        return <p className="mt-4 text-center text-[13px] text-[#70757a] dark:text-[#9aa0a6]">正在读取更新记录…</p>;
    }
    if (error) {
        return <p className="mt-4 text-center text-[13px] text-[#b3261e] dark:text-[#f28b82]">{error}</p>;
    }
    const days = sourceDays(sources);
    const latest = days.at(-1);
    if (!latest) return null;
    const own = changes.filter(c => c.observed === latest);
    return (
        <section className="mx-auto mt-4 max-w-[692px] rounded-xl border border-[#dadce0] bg-white px-4 py-4 text-left dark:border-[#323a44] dark:bg-[#14181d] sm:px-5" aria-label="考试安排更新摘要">
            <h2 className="text-[16px] font-medium text-[#202124] dark:text-[#e8edf3]">考试安排更新记录</h2>
            <p className="mt-1 text-[14px] text-[#4d5156] dark:text-[#aeb8c5]">
                考试安排更新于 {formatTime(latest + 'T00:00:00+08:00')}，已记录 {days.length} 次更新。
            </p>
            {days.length === 1 ? (
                <p className="mt-2 text-[13px] text-[#70757a] dark:text-[#9aa0a6]">从本次考试安排开始记录后续变化。</p>
            ) : own.length === 0 ? (
                <p className="mt-2 text-[13px] text-[#70757a] dark:text-[#9aa0a6]">本次更新没有改变考试安排。</p>
            ) : (
                <p className="mt-2 text-[13px] text-[#70757a] dark:text-[#9aa0a6]">
                    本次更新涉及 {new Set(own.map(c => c.class)).size} 个班级：新增 {own.filter(c => c.change === 'added').length} 门、调整 {own.filter(c => c.change === 'changed').length} 门、移除 {own.filter(c => c.change === 'removed').length} 条记录。
                </p>
            )}
        </section>
    );
}
