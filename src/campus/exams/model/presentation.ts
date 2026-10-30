import type { Exam } from '@/academics/facts';
import { examTimestamp, examDuration } from '../ui/examDateTime';
import { nowInShanghai } from '@/classrooms/model/campusDay';

/** Academic status is independent of the device's calendar-export history. */
export function examPresentation(exam: Exam, now = new Date()) {
    const date = Date.parse(`${exam.date}T00:00:00Z`);
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(exam.date) && Number.isFinite(date) && new Date(date).toISOString().slice(0, 10) === exam.date;
    const validClock = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
    const timestamp = (edge: 'start' | 'end') => validDate && validClock(exam[edge]) ? Date.parse(examTimestamp(exam, edge)) : NaN;
    const start = timestamp('start');
    const end = timestamp('end');
    const days = validDate ? Math.round((date - Date.parse(`${nowInShanghai(now).date}T00:00:00Z`)) / 86_400_000) : 0;
    const state = !Number.isFinite(start) || !Number.isFinite(end) ? 'unknown'
        : now.getTime() >= end ? 'ended' : now.getTime() >= start ? 'ongoing' : 'upcoming';
    return { id: exam.id, course: exam.course.name, date: exam.date, start: exam.start, end: exam.end,
        room: exam.location || exam.room || '待定', state, days,
        countdown: state === 'unknown' ? '时间待定' : state === 'ended' ? '已结束' : state === 'ongoing' ? '正在考试'
            : days === 0 ? '今天' : days === 1 ? '明天' : `还有 ${days} 天`,
        duration: validClock(exam.start) && validClock(exam.end) ? examDuration(exam) : 0, note: exam.note ?? '' };
}
