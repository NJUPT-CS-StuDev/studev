// What is known about exams beyond the timetable: how each came to be and which published sheet it
// is from. Nothing about an exam moves silently.
import type { ExamRecord } from './data';
import type { Exam, ExamChange, ExamSlot, ExamVersion, TeachingMeeting, TeachingTerm } from './facts';
import { addDays, weekdayOf, type Moment } from './time';

/** Public versions with the selected class's complete impact, independent of personal attendance. */
export const examHistory = (record: ExamRecord) => record.history.map(version => ({
    ...version,
    changes: record.changes.filter(change => change.version === version.id),
})).reverse();

export const examImpact = (baseline: boolean, changes: ExamChange[]) => baseline ? '首次记录' : changes.length ? `本班 ${changes.length} 门考试有变动` : '本次更新未影响本班';

/** Old publications may have only a known date; never invent a time for them. */
export const examTime = (iso: string) => iso.length === 10
    ? `${Number(iso.slice(5, 7))}月${Number(iso.slice(8, 10))}日`
    : new Date(iso).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).replace('/', '月').replace(' ', '日 ');
/** Every version is named the same way, by the office's publication; when it was first seen is a second line. */
export const examVersionTime = (version: ExamVersion) => `${examTime(version.published)} 官方发布`;
export const examVersionSeen = (version: ExamVersion) => version.observed ? `${examTime(version.observed)} 收录` : null;
export const examFileName = (file: string) => file.replace(/^\d{4}-\d{2}-\d{2}-/, '');

const sameCourse = (change: ExamChange, exam: Exam) => (change.course.code ?? change.course.name) === (exam.course.code ?? exam.course.name);

/** The changes that led to this sitting, oldest first: what it was before and when that was seen. */
export const changesOf = (record: ExamRecord | null, exam: Exam) =>
    (record?.changes ?? []).filter(change => change.change !== 'removed' && sameCourse(change, exam)
        && (change.after ?? []).some(slot => slot.date === exam.date && slot.start === exam.start));

/** A sitting whose time or place the office changed after first publishing it. */
export const wasChanged = (record: ExamRecord | null, exam: Exam) => changesOf(record, exam).some(change => change.change === 'changed');

/** The day a sheet was published: its file name starts with it. */
export const publishedOn = (file: string) => file.slice(0, 10);

/** A sheet's name as people would say it: no date, no school year, no file type. */
export const sheetName = (file: string) => file.replace(/\.[a-z]+$/i, '').replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\d{4}-\d{4}学年第[一二]学期/, '').replace(/-学生用表$/, '');

/** The course behind an exam or a lab, as the timetable knows it: credits and whether it is required. */
export const courseOf = (meetings: TeachingMeeting[], exam: Pick<Exam, 'course'>) => meetings.find(meeting => (meeting.course.code ?? meeting.course.name) === (exam.course.code ?? exam.course.name))?.course ?? null;

/** "1–16 周", "1–17 周（单）", "2、5、9 周": the weeks of a lesson or of coursework off the timetable. */
export function weeksText(weeks: number[]) {
    if (!weeks.length) return '';
    const sorted = [...weeks].sort((left, right) => left - right);
    const first = sorted[0]!, last = sorted.at(-1)!;
    if (sorted.length === 1) return `第 ${first} 周`;
    if (last - first + 1 === sorted.length) return `${first}–${last} 周`;
    if (sorted.every((week, index) => index === 0 || week - sorted[index - 1]! === 2)) return `${first}–${last} 周（${first % 2 ? '单' : '双'}）`;
    return `${sorted.join('、')} 周`;
}

/** How many times a lesson still meets from now: the weeks it is on, less public holidays. */
export function lessonsLeft(term: TeachingTerm, meeting: TeachingMeeting, holidays: Map<string, string>, now: Moment, end: number) {
    let left = 0;
    for (const week of meeting.weeks) {
        const start = term.weeks.find(item => item.week === week)?.start;
        if (!start) continue;
        const date = addDays(start, meeting.weekday - weekdayOf(start));
        if (holidays.has(date)) continue;
        if (date > now.date || (date === now.date && end > now.min)) left++;
    }
    return left;
}

const slotText = (slots: ExamSlot[] | null, read: (slot: ExamSlot) => string | number | null) => [...new Set((slots ?? []).map(read))].map(value => value === null || value === '' ? '未填写' : String(value)).join('、') || '未填写';
const SLOT_FIELDS: [string, (slot: ExamSlot) => string | number | null][] = [
    ['时间', slot => `${slot.date} ${slot.start}–${slot.end}`], ['地点', slot => slot.location], ['校区', slot => slot.campus], ['老师', slot => slot.teacher], ['人数', slot => slot.students], ['备注', slot => slot.note ?? null],
];
/** What one change did, in words: "时间：2026-11-19 13:30–15:20 → 2026-11-20 09:00–10:50". */
export const changeLines = (change: ExamChange) => change.change === 'changed'
    ? SLOT_FIELDS.flatMap(([label, read]) => { const [before, after] = [slotText(change.before, read), slotText(change.after, read)]; return before === after ? [] : [`${label}：${before} → ${after}`]; })
    : change.change === 'added' ? [`${slotText(change.after, SLOT_FIELDS[0]![1])} · ${slotText(change.after, SLOT_FIELDS[1]![1])}`]
        : [`原定 ${slotText(change.before, SLOT_FIELDS[0]![1])}`];
export const CHANGE_NAMES = { added: '新增', changed: '调整', removed: '已移除' } as const;

