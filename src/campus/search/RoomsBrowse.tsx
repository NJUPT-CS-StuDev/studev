// Every classroom at a moment: with no words, the rooms dimension of search lists them all,
// and being complete it falls into buildings and floors by itself.
import { useEffect, useMemo, useState } from 'react';
import type { Room, RoomDay, TeachingPeriod } from '@/world/facts';
import { loadPeriods, loadRoomDay, loadRoomIndex } from '@/world/data';
import { isClassroom, makeRoomReader } from '@/world/rooms';
import { addDays, dateLabel, hm, minutesOf, momentNow, momentText, parseMoment, WEEKDAYS, weekdayOf } from '@/world/time';
import { useUrl } from '@/world/useUrl';
import { Back, Chevron } from '@/world/ui';

const byNumber = new Intl.Collator('zh-CN', { numeric: true });

export function RoomsBrowse() {
    const { params, set } = useUrl();
    const [rooms, setRooms] = useState<Room[] | null>(null);
    const [periods, setPeriods] = useState<TeachingPeriod[]>([]);
    const [day, setDay] = useState<{ date: string; file: RoomDay | null } | null>(null);
    const now = momentNow();
    const moment = parseMoment(params.get('t'), now);
    const building = params.get('in');
    const everything = params.get('all') === '1';
    useEffect(() => { void Promise.all([loadRoomIndex(), loadPeriods()]).then(([index, list]) => { setRooms(index.rooms.filter(isClassroom)); setPeriods(list); }); }, []);
    useEffect(() => { let live = true; void loadRoomDay(moment.date).then(file => { if (live) setDay({ date: moment.date, file }); }); return () => { live = false; }; }, [moment.date]);
    const read = useMemo(() => periods.length ? makeRoomReader(periods) : null, [periods]);
    const file = day?.date === moment.date ? day.file : null;
    const groups = useMemo(() => {
        if (!rooms || !read) return [];
        const buildings = new Map<string, Map<string, { room: Room; state: ReturnType<typeof read> }[]>>();
        for (const room of rooms) {
            const floors = buildings.get(room.building) ?? new Map();
            buildings.set(room.building, floors);
            floors.set(room.floor, [...(floors.get(room.floor) ?? []), { room, state: read(file, room.id, moment.min) }]);
        }
        return [...buildings.entries()].sort(([left], [right]) => byNumber.compare(left, right)).map(([name, floors]) => {
            const all = [...floors.values()].flat();
            return { name, total: all.length, free: all.filter(row => !row.state.busy).length,
                floors: [...floors.entries()].sort(([left], [right]) => byNumber.compare(left, right)).map(([floor, rows]) => ({ floor, rows: rows.sort((left, right) => byNumber.compare(left.room.number, right.room.number)) })) };
        });
    }, [file, moment.min, read, rooms]);
    if (!rooms || !read || !day) return <div className="empty" aria-busy="true" />;
    const go = (patch: Record<string, string | null>) => set(patch);
    const at = (date: string, min: number) => go({ t: date === now.date && min === now.min ? null : momentText({ date, min }) });
    const running = periods.find(period => minutesOf(period.start) <= moment.min && moment.min < minutesOf(period.end));
    const shown = groups.filter(group => !building || group.name === building);
    return (
        <div className="rooms">
            <div className="rooms-when">
                <button className="ib" aria-label="前一天" onClick={() => at(addDays(moment.date, -1), moment.min)}><Back /></button>
                <b>{hm(moment.min)}</b><span>{moment.date === now.date ? '今天' : WEEKDAYS[weekdayOf(moment.date)]} {dateLabel(moment.date)}</span>
                <button className="ib" aria-label="后一天" onClick={() => at(addDays(moment.date, 1), moment.min)}><Chevron /></button>
                {(moment.date !== now.date || moment.min !== now.min) && <button className="ib" onClick={() => go({ t: null })}>现在</button>}
            </div>
            <div className="rooms-periods" role="group" aria-label="第几节">
                {periods.map(period => <button key={period.period} className={running?.period === period.period ? 'on' : ''} title={`${period.start}–${period.end}`} onClick={() => at(moment.date, minutesOf(period.start))}>{period.period}</button>)}
            </div>
            <div className="since">
                <button className={!building ? 'on' : ''} onClick={() => go({ in: null })}>全部的楼</button>
                {groups.map(group => <button key={group.name} className={building === group.name ? 'on' : ''} onClick={() => go({ in: group.name })}>{group.name}</button>)}
                <button className={`rooms-all ${everything ? 'on' : ''}`} onClick={() => go({ all: everything ? null : '1' })}>{everything ? '显示全部' : '只看空的'}</button>
            </div>
            {!file ? <div className="empty">这一天没有排课数据</div> : shown.map(group => (
                <section key={group.name}>
                    <h3 className="rooms-b">{group.name}<span><b>{group.free}</b> / {group.total} 间空闲</span></h3>
                    {group.floors.map(({ floor, rows }) => {
                        const visible = everything ? rows : rows.filter(row => !row.state.busy);
                        return visible.length > 0 && <div className="rooms-f" key={floor}>
                            <span className="rooms-fn">{floor}</span>
                            <div className="rooms-g">{visible.map(({ room, state }) => (
                                <a key={room.id} className={`rt ${state.tier}`} href={`/map/?place=${encodeURI(room.id)}&t=${momentText(moment)}`}>
                                    <b>{room.number}</b><small>{state.busy ? '有课' : `到 ${hm(state.until)}`}</small>
                                </a>
                            ))}</div>
                        </div>;
                    })}
                </section>
            ))}
        </div>
    );
}
