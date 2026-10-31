import { PRODUCT_CONFIG } from '@/app/config/product';
import { X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { TeachingPeriod } from '@/academics/timetable';
import type { Room } from '@/academics/space';
import { writePreferences } from '@/shared/lib/preferences';
import { usePreferences } from '@/shared/lib/usePreferences';
import type { ClassroomAvailabilityClient, ClassroomDayFile, ClassroomIndexFile } from './model/ClassroomAvailabilityClient';
import {
    addDays, campusBuildings, clampToTerm, freeRun, isFree, nowInShanghai, occupantsAt, periodAt, roomMatches, termRange, weekOf,
    type DayStatus, type Occupant,
} from './model/campusDay';
import { matchingRooms } from './model/roomSelection';
import { BuildingFilter } from './BuildingFilter';
import { selectedBuilding, readBuildings, saveBuildings } from './model/buildingSelection';
import './classrooms.css';

interface ClassroomsParams {
    campus: string | null;
    date: string | null;
    period: number | null;
    until: number | null;
    room: string | null;
    building: string | null;
}

interface ClassroomsViewProps extends ClassroomsParams {
    client: ClassroomAvailabilityClient;
    /** What is typed in the site header right now; it narrows the rooms shown. */
    filter: string;
    onChange: (params: Record<string, string | null>, replace?: boolean) => void;
}

const WEEKDAYS = '一二三四五六日';
const DEFAULT_CAMPUS = PRODUCT_CONFIG.CAMPUS.id;

function useNow() {
    const [now, setNow] = useState(() => nowInShanghai());
    useEffect(() => {
        const timer = window.setInterval(() => setNow(nowInShanghai()), 60_000);
        return () => window.clearInterval(timer);
    }, []);
    return now;
}

const dayLabel = (date: string, today: string): string => {
    const weekday = WEEKDAYS[(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7];
    const relative = date === today ? '今天' : date === addDays(today, 1) ? '明天' : date === addDays(today, 2) ? '后天' : null;
    return `${relative ? `${relative} · ` : ''}${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日 周${weekday}`;
};

/** "10月25日 14:58" in Nanjing time. */
const checkedText = (iso: string): string => new Intl.DateTimeFormat('zh-CN', {
    timeZone: PRODUCT_CONFIG.TIME_ZONE, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).format(new Date(iso)).replace(/\//, '月').replace(' ', '日 ');

const occupantText = (occupant: Occupant): string => occupant.kind === 'exam'
    ? `考试：${occupant.course}`
    : occupant.course;

const OTHER = '已占用（借用、调课等）';
const SEAT_STEPS = [30, 60, 100, 150];

type Held = Occupant[] | 'other';
type Segment = { from: number; to: number; held: Held };

/** A room's day as runs of periods with the same occupants. */
const segments = (status: DayStatus, room: string, periods: TeachingPeriod[]): Segment[] => {
    const result: Segment[] = [];
    const key = (held: Held) => held === 'other' ? 'other' : held.map(item => item.kind === 'exam' ? `e:${item.id}` : `c:${item.id}`).join('|');
    for (const { period } of periods) {
        const held = occupantsAt(status, room, period);
        const last = result[result.length - 1];
        if (last && last.to === period - 1 && key(last.held) === key(held)) last.to = period;
        else result.push({ from: period, to: period, held });
    }
    return result;
};

export function ClassroomsView({ client, campus: campusParam, date: dateParam, period: periodParam, until: untilParam, room: roomParam, building, filter, onChange }: ClassroomsViewProps) {
    const [index, setIndex] = useState<ClassroomIndexFile | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [day, setDay] = useState<{ date: string; file: ClassroomDayFile | null } | null>(null);
    const { prefs } = usePreferences();
    const now = useNow();
    const returnFocus = useRef<HTMLElement | null>(null);

    useEffect(() => {
        const controller = new AbortController();
        client.initialize(controller.signal).then(setIndex).catch(reason => {
            if (!(reason instanceof DOMException && reason.name === 'AbortError')) setError(reason instanceof Error ? reason.message : '教室数据加载失败');
        });
        return () => controller.abort();
    }, [client]);

    const weeks = index?.weeks ?? [];
    const periods = index?.periods ?? [];
    const campuses = index?.campuses.filter(c => index.buildings.some(b => b.campus === c.id && index.rooms.some(r => r.listed && r.building === b.id))).map(item => item.id) ?? [];
    const campus = [campusParam, prefs.campus, DEFAULT_CAMPUS].find(value => value && campuses.includes(value)) ?? campuses[0] ?? DEFAULT_CAMPUS;
    const today = weeks.length ? clampToTerm(weeks, now.date) : now.date;
    const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) && weeks.length && clampToTerm(weeks, dateParam) === dateParam ? dateParam : today;
    const nowPeriod = date === now.date && periods.length ? periodAt(periods, now.minutes) : null;
    const lastPeriod = periods[periods.length - 1]?.period ?? 12;
    const period = periodParam && periods.some(item => item.period === periodParam) ? periodParam : nowPeriod ?? 1;
    const until = untilParam && untilParam > period && untilParam <= lastPeriod ? untilParam : null;
    const query = filter.trim() || building || '';

    useEffect(() => {
        if (!index) return;
        const controller = new AbortController();
        client.day(date, controller.signal).then(file => setDay({ date, file })).catch(reason => {
            if (!(reason instanceof DOMException && reason.name === 'AbortError')) setError(reason instanceof Error ? reason.message : '教室占用加载失败');
        });
        return () => controller.abort();
    }, [client, date, index]);

    const status = useMemo(() => day?.date === date ? day.file : null, [date, day]);
    const [minSeats, setMinSeats] = useState(0);
    const [everything, setEverything] = useState(false);
    const buildings = useMemo(() => index ? campusBuildings(index, campus, everything) : [], [campus, everything, index]);
    const [buildingIds, setBuildingIds] = useState<string[] | null>(null);
    useEffect(() => { setBuildingIds(readBuildings(campus)); }, [campus]);
    const chooseBuildings = (ids: string[] | null) => { setBuildingIds(ids); saveBuildings(campus, ids); };
    const selectedBuildings = buildings.filter(item => selectedBuilding(buildingIds, item.id));
    const roomById = useMemo(() => new Map(index?.rooms.map(room => [room.id, room]) ?? []), [index]);
    const selectedRoom = roomParam ? roomById.get(roomParam) ?? null : null;

    const set = (params: Record<string, string | null>, replace = true) => onChange({
        campus, date: date === today ? null : date, period: periodParam ? String(period) : null, until: until ? String(until) : null,
        room: roomParam, q: filter.trim() || null, ...params,
    }, replace);
    const chooseCampus = (next: string) => {
        writePreferences(current => ({ ...current, campus: next }));
        set({ campus: next, room: null });
    };
    const openRoom = (room: Room, target: HTMLElement) => {
        returnFocus.current = target;
        set({ room: room.id }, false);
    };
    const closeRoom = () => {
        set({ room: null });
        returnFocus.current?.focus();
    };

    if (error) return <main className="classrooms"><p className="classrooms-error">{error}</p></main>;
    if (!index) return <main className="classrooms" aria-busy="true"><div className="classrooms-skeleton" /></main>;

    const { first, last } = termRange(weeks);
    const position = weekOf(weeks, date);
    const shown = (room: Room) => roomMatches(room, query) && (!minSeats || (room.seats ?? 0) >= minSeats);
    const visibleRooms = matchingRooms(index, {campus, buildings:buildingIds, everything, query, minSeats, from:period, until:until ?? period});
    const freeCount = status ? visibleRooms.filter(room => isFree(status, room.id, period, until ?? period)).length : null;
    const hasSeats = visibleRooms.some(room => room.seats);
    const periodInfo = periods.find(item => item.period === period);
    const untilInfo = until ? periods.find(item => item.period === until) : null;
    const quickDays = [0, 1, 2].map(offset => addDays(today, offset)).filter(value => value <= last);

    return (
        <main className="classrooms">
            <header className="classrooms-head">
                <div>
                    <h1>空教室</h1>
                    <p>{dayLabel(date, now.date)}{position ? ` · 第${position.week}周` : ''}</p>
                </div>
                <div className="classrooms-campus" role="radiogroup" aria-label="校区">
                    {campuses.map(item => <button key={item} type="button" role="radio" aria-checked={item === campus} onClick={() => chooseCampus(item)}>{item}</button>)}
                </div>
            </header>

            <section className="classrooms-controls" aria-label="时间">
                <div className="classrooms-days">
                    {quickDays.map(value => <button key={value} type="button" aria-pressed={value === date} onClick={() => set({ date: value === today ? null : value, period: null, until: null, room: null })}>{value === now.date ? '今天' : value === addDays(now.date, 1) ? '明天' : value === addDays(now.date, 2) ? '后天' : dayLabel(value, now.date)}</button>)}
                    <label className="classrooms-date">
                        <span className="sr-only">选择日期</span>
                        <input type="date" value={date} min={first} max={last} onChange={event => event.target.value && set({ date: event.target.value === today ? null : event.target.value, period: null, until: null, room: null })} />
                    </label>
                </div>
                <div className="classrooms-periods" role="radiogroup" aria-label="节次">
                    {periods.map(item => (
                        <button
                            key={item.period}
                            type="button"
                            role="radio"
                            aria-checked={item.period === period}
                            className={`${item.period === nowPeriod ? 'is-now' : ''} ${until && item.period > period && item.period <= until ? 'is-range' : ''} ${[5, 9].includes(item.period) ? 'ends-part' : ''}`}
                            onClick={() => set({ period: item.period === nowPeriod ? null : String(item.period), until: null })}
                            aria-label={`第${item.period}节 ${item.start}${item.period === nowPeriod ? '，现在' : ''}`}
                        >
                            <strong>{item.period}</strong><span>{item.start}</span>
                        </button>
                    ))}
                </div>
                <BuildingFilter buildings={buildings.map(item => item.id)} allBuildings={campusBuildings(index, campus, true).map(item => item.id)} selected={buildingIds} onChange={chooseBuildings} />
                <div className="classrooms-summary">
                    <label>
                        连续空闲到
                        <select value={until ?? ''} onChange={event => set({ until: event.target.value || null })}>
                            <option value="">只看第{period}节</option>
                            {periods.filter(item => item.period > period).map(item => <option key={item.period} value={item.period}>第{item.period}节（{item.end}）</option>)}
                        </select>
                    </label>
                    <p aria-live="polite">
                        {periodInfo ? `${periodInfo.start}–${(untilInfo ?? periodInfo).end}` : ''}
                        {freeCount !== null ? <> · <strong>{freeCount}</strong> / {visibleRooms.length} 间空闲</> : ' · 正在加载…'}
                        {query ? <> · 筛选「{query}」</> : null}
                    </p>
                    <label>
                        场地
                        <select value={everything ? 'all' : 'classrooms'} onChange={event => setEverything(event.target.value === 'all')}>
                            <option value="classrooms">教室</option>
                            <option value="all">全部场地（含机房、实验室、运动场）</option>
                        </select>
                    </label>
                    {hasSeats || minSeats ? (
                        <label>
                            座位
                            <select value={minSeats} onChange={event => setMinSeats(Number(event.target.value))}>
                                <option value={0}>不限</option>
                                {SEAT_STEPS.map(step => <option key={step} value={step}>至少 {step} 座</option>)}
                            </select>
                        </label>
                    ) : null}
                    <p className="classrooms-checked">{status?.observed_at ? `空闲情况 ${checkedText(status.observed_at)} 更新` : status ? '按课表推算，未计入借用和调课' : ''}</p>
                    <ul className="classrooms-legend" aria-hidden="true"><li className="is-free">空闲</li><li className="is-busy">上课</li><li className="is-exam">考试</li></ul>
                </div>
            </section>

            <div className="classrooms-buildings">
                {selectedBuildings.map(item => {
                    const rooms = item.rooms.filter(shown);
                    if (!rooms.length) return null;
                    const free = status ? rooms.filter(room => isFree(status, room.id, period, until ?? period)).length : null;
                    return (
                        <section key={item.id} className="classrooms-building" aria-labelledby={`building-${item.id}`}>
                            <header><h2 id={`building-${item.id}`}>{item.id}</h2>{free !== null ? <span><strong>{free}</strong> / {rooms.length} 空闲</span> : null}</header>
                            <div className="classrooms-floors">
                                {item.floors.map(floor => {
                                    const floorRooms = floor.rooms.filter(shown);
                                    if (!floorRooms.length) return null;
                                    return (
                                        <div key={floor.level} className="classrooms-floor">
                                            <span className="classrooms-level">{floor.level ? `${floor.level}F` : '其他'}</span>
                                            <div className="classrooms-rooms">
                                                {floorRooms.map(room => {
                                                    const held = status ? occupantsAt(status, room.id, period) : [];
                                                    const free = status ? isFree(status, room.id, period, until ?? period) : null;
                                                    const state = free === null ? 'is-loading' : free ? 'is-free' : held !== 'other' && held.some(o => o.kind === 'exam') ? 'is-exam' : 'is-busy';
                                                    const run = status && free ? freeRun(status, room.id, period, lastPeriod) : 0;
                                                    const why = held === 'other' ? OTHER : held.length ? held.map(occupantText).join('、') : `第${period}到${until}节之间有占用`;
                                                    const label = `${room.id}${room.seats ? `，${room.seats} 座` : ''}，${free === null ? '加载中' : free ? `空闲${run > 1 ? `，连续 ${run} 节` : ''}` : why}`;
                                                    return (
                                                        <button key={room.id} type="button" className={`classrooms-room ${state} ${room.number.length > 5 ? 'is-named' : ''} ${room.id === roomParam ? 'is-selected' : ''}`} onClick={event => openRoom(room, event.currentTarget)} aria-label={label} title={label}>
                                                            {room.number}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </section>
                    );
                })}
                {!visibleRooms.length ? <p className="classrooms-empty">{buildingIds?.length === 0 ? '尚未选择楼栋，请在楼栋筛选中选择。' : query ? `${campus}没有与「${query}」匹配的教室。` : '当前条件下没有匹配的教室。'}</p> : null}
            </div>

            {selectedRoom && status ? (
                <RoomDrawer
                    room={selectedRoom}
                    campus={campus}
                    dateText={dayLabel(date, now.date)}
                    periods={periods}
                    status={status}
                    selected={period}
                    nowPeriod={nowPeriod}
                    onClose={closeRoom}
                />
            ) : null}
        </main>
    );
}

interface RoomDrawerProps {
    room: Room;
    campus: string;
    dateText: string;
    periods: TeachingPeriod[];
    status: DayStatus;
    selected: number;
    nowPeriod: number | null;
    onClose: () => void;
}

function RoomDrawer({ room, campus, dateText, periods, status, selected, nowPeriod, onClose }: RoomDrawerProps) {
    const panel = useRef<HTMLElement>(null);
    useEffect(() => {
        const previous = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        panel.current?.focus();
        const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
        document.addEventListener('keydown', keydown);
        return () => {
            document.removeEventListener('keydown', keydown);
            document.body.style.overflow = previous;
        };
    }, [onClose]);
    const byPeriod = new Map(periods.map(item => [item.period, item]));
    const kinds = room.kinds.filter(kind => kind !== '考场').join('、');
    return (
        <div className="room-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
            <aside ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="room-title" className="room-drawer">
                <div className="room-handle" aria-hidden="true" />
                <header>
                    <div>
                        <p>{campus} · {room.building}{room.floor ? ` · ${room.floor}楼` : ''}{kinds ? ` · ${kinds}` : ''}{room.seats ? ` · ${room.seats} 座` : ''}</p>
                        <h2 id="room-title">{room.id}</h2>
                        <span>{dateText}</span>
                    </div>
                    <button type="button" onClick={onClose} aria-label="关闭教室详情"><X aria-hidden="true" /></button>
                </header>
                <ol className="room-day">
                    {segments(status, room.id, periods).map(segment => {
                        const start = byPeriod.get(segment.from);
                        const end = byPeriod.get(segment.to);
                        const free = segment.held !== 'other' && !segment.held.length;
                        const exam = segment.held !== 'other' && segment.held.some(o => o.kind === 'exam');
                        const current = selected >= segment.from && selected <= segment.to;
                        const live = nowPeriod !== null && nowPeriod >= segment.from && nowPeriod <= segment.to;
                        return (
                            <li key={segment.from} className={`${free ? 'is-free' : exam ? 'is-exam' : 'is-busy'} ${current ? 'is-current' : ''}`}>
                                <div className="room-day-time">
                                    <strong>{segment.from === segment.to ? `第${segment.from}节` : `第${segment.from}–${segment.to}节`}</strong>
                                    <span>{start?.start}–{end?.end}</span>
                                    {live ? <em>现在</em> : null}
                                </div>
                                <div className="room-day-what">
                                    {free ? <strong>空闲</strong> : segment.held === 'other' ? <strong>{OTHER}</strong> : segment.held.map(occupant => (
                                        <div key={occupant.kind === 'exam' ? occupant.id : occupant.id}>
                                            <strong>{occupantText(occupant)}</strong>
                                            <span>{[occupant.teachers.join(','), occupant.classes.slice(0, 4).join('、') + (occupant.classes.length > 4 ? ' 等' : '')].filter(Boolean).join(' · ')}</span>
                                        </div>
                                    ))}
                                </div>
                            </li>
                        );
                    })}
                </ol>
                <p className="room-note">{status.observed_at ? `空闲情况 ${checkedText(status.observed_at)} 更新；占用原因来自课表和考试安排。` : '按课表和考试安排推算，未计入借用和调课。'}</p>
            </aside>
        </div>
    );
}
