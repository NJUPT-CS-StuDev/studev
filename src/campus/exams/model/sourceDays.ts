import type { ExamSource } from '@/academics/facts';
/** Observation dates in published source filenames, for history headings. */
export const sourceDays = (sources: ExamSource[]): string[] => [...new Set(sources.map(s => s.file.slice(0, 10)))].sort();
export const observedTime = (date: string): string => new Date(date + 'T00:00:00+08:00').toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
});
