// Dates are plain "YYYY-MM-DD" strings and times are minutes of the day, both in Nanjing.
const pad = (n: number) => String(n).padStart(2, '0');
const utc = (date: string) => new Date(`${date}T00:00:00Z`);
export const addDays = (date: string, days: number): string => {
    const value = utc(date);
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10);
};
/** 1 is Monday, 7 is Sunday. */
export const weekdayOf = (date: string): number => (utc(date).getUTCDay() + 6) % 7 + 1;
export const startOfWeek = (date: string): string => addDays(date, 1 - weekdayOf(date));
export const daysBetween = (from: string, to: string): number => Math.round((utc(to).getTime() - utc(from).getTime()) / 864e5);
export const hm = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
export const minutesOf = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
export const WEEKDAYS = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const;
export const dateLabel = (date: string) => `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`;
/** A day as a list says it, seen from `today`: 今天, 明天, 昨天, 周五 within the week ahead, 11月20日 beyond it. */
export const dayWord = (date: string, today: string) => {
    const days = daysBetween(today, date);
    return days === 0 ? '今天' : days === 1 ? '明天' : days === -1 ? '昨天' : days > 1 && days < 7 ? WEEKDAYS[weekdayOf(date)]! : dateLabel(date);
};
export const durationText = (minutes: number) => minutes >= 60
    ? `${Math.floor(minutes / 60)} 小时${minutes % 60 ? ` ${minutes % 60} 分` : ''}`
    : `${minutes} 分钟`;

export interface Moment { date: string; min: number }
export const momentNow = (now = new Date()): Moment => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(now).map(part => [part.type, part.value]));
    return { date: `${parts.year}-${parts.month}-${parts.day}`, min: Number(parts.hour) * 60 + Number(parts.minute) };
};
export const parseMoment = (value: string | null, fallback: Moment): Moment => {
    const match = value ? /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?$/.exec(value) : null;
    return match ? { date: match[1]!, min: match[2] ? minutesOf(match[2]) : fallback.min } : fallback;
};
export const momentText = (moment: Moment) => `${moment.date}T${hm(moment.min)}`;
