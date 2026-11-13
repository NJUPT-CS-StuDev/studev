import { PRODUCT_CONFIG } from '@/world/product';
import { CAMPUS_CENTRE, type Place } from './space';
import type { Position } from 'wayfind';

export type OpenState = 'open' | 'closing' | 'closed' | 'unknown';
export const openingLabel: Record<OpenState, string> = { open: '营业中', closing: '即将关闭', closed: '已关闭', unknown: '' };
export interface CampusTime { day: number; hour: number; minute: number }
export interface HoursStatus { state: OpenState; today: string; closesAt?: string }

/** Campus presentation always uses China time, including visitors abroad. */
export function campusTime(date = new Date()): CampusTime {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: PRODUCT_CONFIG.TIME_ZONE, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
    const get = (type: string) => parts.find(part => part.type === type)!.value;
    return { day: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(get('weekday')) + 1, hour: Number(get('hour')), minute: Number(get('minute')) };
}

/** Half-open intervals, closing 30 minutes before the end. Android passes the same golden cases. */
export function openingStatus(hours: Place['hours'], now: CampusTime): HoursStatus {
    if (!hours) return { state: 'unknown', today: '' };
    const minutes = (value: string) => { const [h = 0, m = 0] = value.split(':').map(Number); return h * 60 + m; };
    const today = hours.week[String(now.day)] ?? [];
    const minute = now.hour * 60 + now.minute;
    const intervals: [number, number][] = today.map(([a, b]) => { const start = minutes(a), end = minutes(b); return [start, end <= start ? end + 1440 : end]; });
    for (const [a, b] of hours.week[String(now.day === 1 ? 7 : now.day - 1)] ?? []) {
        const start = minutes(a), end = minutes(b);
        if (end < start) intervals.push([start - 1440, end]);
    }
    for (const [a, b] of hours.week[String(now.day === 7 ? 1 : now.day + 1)] ?? []) {
        const start = minutes(a), end = minutes(b);
        intervals.push([start + 1440, end + (end <= start ? 2880 : 1440)]);
    }
    let end = Math.max(...intervals.filter(([a, b]) => minute >= a && minute < b).map(([, b]) => b));
    if (Number.isFinite(end)) {
        let previous: number;
        do { previous = end; end = Math.max(previous, ...intervals.filter(([a, b]) => a <= previous && b > minute).map(([, b]) => b)); } while (previous !== end);
    }
    return {
        state: !Number.isFinite(end) ? 'closed' : end - minute <= 30 ? 'closing' : 'open',
        today: today.length ? today.map(pair => pair.join('–')).join(' · ') : '今日不开放',
        ...(Number.isFinite(end) ? { closesAt: `${String(Math.floor((end % 1440) / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}` } : {}),
    };
}

/** Where people on campus go at each part of the day, most likely first, as categories of the map's vocabulary. */
export const momentAt = (hour: number): readonly string[] =>
    hour >= 5 && hour <= 10 ? ['教学楼', '图书馆', '食堂']
        : hour >= 11 && hour <= 13 ? ['食堂', '超市便利']
            : hour >= 14 && hour <= 16 ? ['教学楼', '图书馆', '体育']
                : hour >= 17 && hour <= 18 ? ['食堂', '超市便利']
                    : hour >= 19 && hour <= 21 ? ['图书馆', '教学楼', '体育']
                        : ['宿舍', '超市便利'];
/** What closes and is then no use to suggest. */
const CLOSES = ['食堂', '超市便利'];
const onCampus = (place: Place) => place.id.startsWith(`${PRODUCT_CONFIG.CAMPUS.id}/`);

export function distance(a: Position, b: Position): number {
    const rad = Math.PI / 180;
    const h = Math.sin((b[1] - a[1]) * rad / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin((b[0] - a[0]) * rad / 2) ** 2;
    return 6371008.8 * 2 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, h))));
}

export function recommendations(places: Place[], now: CampusTime, position?: Position | null, category?: string | null) {
    const stateOrder = { open: 0, closing: 0, unknown: 1, closed: 2 };
    const shown = new Map<string | undefined, number>();
    const order = momentAt(now.hour);
    return places.filter(p => (p.kind === 'building' || p.kind === 'place') && p.centre && (category ? p.category === category : onCampus(p) && order.includes(p.category ?? '')))
        .map(place => ({ place, distance: distance(position ?? CAMPUS_CENTRE, place.centre!), status: openingStatus(place.hours, now) }))
        .filter(item => category || !(CLOSES.includes(item.place.category ?? '') && item.status.state === 'closed'))
        .sort((a, b) => (category ? 0 : order.indexOf(a.place.category!) - order.indexOf(b.place.category!)) || stateOrder[a.status.state] - stateOrder[b.status.state] || a.distance - b.distance || (a.place.id < b.place.id ? -1 : a.place.id > b.place.id ? 1 : 0))
        .filter(({ place }) => { if (category) return true; const count = shown.get(place.category) ?? 0; shown.set(place.category, count + 1); return count < 3; });
}
