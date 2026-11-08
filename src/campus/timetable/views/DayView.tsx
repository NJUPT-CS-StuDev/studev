import { useEffect, useState } from 'react';
import { eventsOn, examDays, nextEvent, type CampusEvent, type Timeline } from '@/world/events';
import type { ExamRecord } from '@/world/data';
import { wasChanged } from '@/world/exams';
import { buildingOf, courseName, roomLabel, unplaced } from '@/world/names';
import { addDays, daysBetween, dateLabel, durationText, hm, momentText, startOfWeek, WEEKDAYS, type Moment } from '@/world/time';
import { walkMinutes } from '@/world/walk';
import { Chevron } from '@/world/ui';
import { courseToneIndex, courseToneStyle } from '@/timetable/model/courseColors';

const tileStyle = (event: CampusEvent) => event.meeting ? courseToneStyle(courseToneIndex(event.meeting)) : undefined;
const tileClass = (event: CampusEvent, record: ExamRecord | null) => event.kind === 'exam' ? `exam ${event.exam && wasChanged(record, event.exam) ? 'changed' : ''}` : event.kind === 'run' ? 'run' : '';
/** Free rooms are the rooms dimension of search, at a moment. */
const roomsAt = (date: string, min: number) => `/search/?scope=room&t=${momentText({ date, min })}`;

function NextBlock({ line, now }: { line: Timeline; now: Moment }) {
    const event = nextEvent(line, now);
    const placed = event && !unplaced(event.room);
    const [walk, setWalk] = useState<number | null>(null);
    useEffect(() => {
        if (!placed) return;
        let live = true;
        void walkMinutes(event!.room!).then(value => { if (live) setWalk(value); });
        return () => { live = false; };
    }, [event?.room, placed]); // eslint-disable-line
    if (!event) return null;
    const today = event.date === now.date;
    const during = today && event.start <= now.min;
    const caption = during ? `正在上，到 ${hm(event.end)}` : today ? `下一节 · 还有 ${durationText(event.start - now.min)}`
        : `下一节 · ${daysBetween(now.date, event.date) === 1 ? '明天' : dateLabel(event.date)}`;
    const exam = examDays(line, now.date)[0];
    return (
        <section className="next">
            <div className="l">
                <span className="cap">{caption}</span>
                <b>{hm(event.start)} {event.name}</b>
                <span className="m">{event.room ? roomLabel(event.room) : '教室未排定'}{walk !== null && !during ? ` · ${hm(event.start - walk - 2)} 出门，步行 ${walk} 分钟` : ''}</span>
                {exam && <span className="xam"><span className="tag">考试</span>{exam.days === 0 ? '今天' : exam.days === 1 ? '明天' : `${exam.days} 天后`} {exam.exams.map(item => `${courseName(item.course.name)} ${item.start}`).join('、')}</span>}
            </div>
            {placed && <a className="btn go" href={`/map/?nav=${encodeURI(event.room!)}`}>去这里</a>}
        </section>
    );
}

export function DayView({ line, day, now, isMe, record, onPick, onOpen }: { line: Timeline; day: string; now: Moment; isMe: boolean; record: ExamRecord | null; onPick: (date: string) => void; onOpen: (event: CampusEvent) => void }) {
    const monday = startOfWeek(day);
    const today = day === now.date;
    const events = eventsOn(line, day);
    const strip = (
        <div className="days">
            {Array.from({ length: 7 }, (_, index) => {
                const date = addDays(monday, index);
                return <button key={date} className={`${date === day ? 'on' : ''} ${date === now.date ? 'today' : ''}`} onClick={() => onPick(date)}>
                    {WEEKDAYS[index + 1]!.slice(1)}<b>{Number(date.slice(8))}</b>{line.exams.some(exam => exam.date === date) && <i />}
                </button>;
            })}
        </div>
    );
    const head = isMe && today ? <NextBlock line={line} now={now} /> : null;
    if (!events.length) return <>{head}{strip}<div className="empty">{line.holidays.get(day) ?? '这一天没有安排'}</div></>;
    const fold = today && isMe;
    const gone = fold ? events.filter(event => event.end <= now.min) : [];
    const live = fold ? events.filter(event => event.end > now.min) : events;
    if (!live.length) return <>{head}{strip}{gone.length > 0 && <div className="gone">已结束 {gone.length} 项 · {gone.map(event => event.short).join('、')}</div>}<div className="empty">今天的课都上完了</div></>;
    const from = (fold ? Math.min(now.min, live[0]!.start) : live[0]!.start) - 14;
    const to = Math.max(live.at(-1)!.end + 24, today ? now.min + 20 : 0);
    const y = (minutes: number) => Math.round(minutes - from);
    const hours: number[] = [];
    for (let time = Math.ceil(from / 60) * 60; time <= to; time += 60) hours.push(time);
    const gap = (start: number, end: number, key: string) => <a key={key} className="gapbtn" style={{ top: y((start + end) / 2) }} href={roomsAt(day, start)}>空 {durationText(end - start)} · 看这时的空教室<Chevron /></a>;
    return (
        <>
            {head}{strip}
            {gone.length > 0 && <div className="gone">已结束 {gone.length} 项 · {gone.map(event => event.short).join('、')}</div>}
            <div className="tl" style={{ height: y(to) }}>
                {hours.map(time => <div key={time}><div className="hl" style={{ top: y(time) }} />{!(today && Math.abs(time - now.min) < 16) && <div className="hn" style={{ top: y(time) }}>{time / 60}:00</div>}</div>)}
                {today && live[0]!.start - now.min >= 25 && gap(now.min, live[0]!.start, 'first')}
                {live.map((event, index) => {
                    const next = live[index + 1];
                    const start = today ? Math.max(event.end, now.min) : event.end;
                    return <div key={event.id}>
                        <button className={`t ${tileClass(event, record)}`} style={{ top: y(event.start) + 1, height: Math.max(40, y(event.end) - y(event.start) - 2), ...tileStyle(event) }} onClick={() => onOpen(event)}>
                            {event.name}<small>{hm(event.start)}–{hm(event.end)}{event.room ? ` · ${roomLabel(event.room)}` : ''}</small>
                        </button>
                        {next && next.start - start >= 30 && next.start - event.end >= 45 && gap(start, next.start, `gap${index}`)}
                    </div>;
                })}
                {today && <div className="nowl" style={{ top: y(now.min) }}><b>{hm(now.min)}</b></div>}
            </div>
        </>
    );
}
