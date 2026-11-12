import { useEffect, useState } from 'react';
import { clusters, dueOn, eventsOn, examDays, layers, nextEvent, type CampusEvent, type EventKind, type Timeline } from '@/world/events';
import { toggleDone, type Task } from '@/world/tasks';
import type { ExamRecord } from '@/world/data';
import { wasChanged } from '@/world/exams';
import { buildingOf, courseName, roomLabel, unplaced } from '@/world/names';
import { addDays, daysBetween, dateLabel, durationText, hm, minutesOf, momentText, startOfWeek, WEEKDAYS, type Moment } from '@/world/time';
import { walkMinutes } from '@/world/walk';
import { Chevron } from '@/world/ui';
import { courseToneStyle, eventTone, timelineTones } from '@/timetable/model/courseColors';

const tileStyle = (event: CampusEvent, tones: Map<string, number>, line: Timeline) => { const tone = eventTone(tones, event, line.courseMeetings ?? line.meetings); return tone !== undefined ? courseToneStyle(tone) : undefined; };
const tileClass = (event: CampusEvent, record: ExamRecord | null) => event.kind === 'exam' ? `exam ${event.exam && wasChanged(record, event.exam) ? 'changed' : ''}` : event.kind === 'class' ? '' : event.kind;
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
                <span className="m">{event.room ? roomLabel(event.room) : '课表没写地点'}{walk !== null && !during ? ` · ${hm(event.start - walk - 2)} 出门，步行 ${walk} 分钟` : ''}</span>
                {exam && <span className="xam"><span className="tag">考试</span>{exam.days === 0 ? '今天' : exam.days === 1 ? '明天' : `${exam.days} 天后`} {exam.exams.map(item => `${courseName(item.course.name)} ${item.start}`).join('、')}</span>}
            </div>
            {placed && <a className="btn go" href={`/map/?nav=${encodeURI(event.room!)}`}>去这里</a>}
        </section>
    );
}

export function DayView({ line, day, now, isMe, record, order, onPick, onOpen, onTask }: { line: Timeline; day: string; now: Moment; isMe: boolean; record: ExamRecord | null; order: readonly EventKind[]; onTask: (task: Task) => void; onPick: (date: string) => void; onOpen: (event: CampusEvent) => void }) {
    const monday = startOfWeek(day);
    const today = day === now.date;
    const events = eventsOn(line, day);
    const tones = timelineTones(line);
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
    // What is due by the end of the day, with no time of its own, is listed above the day's hours.
    const due = dueOn(line, day);
    const dues = due.length > 0 && <div className="dues">
        <h3 className="sh">{day === now.date ? '今天' : dateLabel(day)}截止</h3>
        {due.map(task => <div key={task.id} className={`trow-i p${task.priority ?? 0}`}>
            <button className={`tcheck ${task.done ? 'on' : ''}`} aria-label={task.done ? '标为未完成' : '完成'} onClick={() => toggleDone(task)} />
            <button className="tmain" onClick={() => onTask(task)}><b className={task.done ? 'task-done' : ''}>{task.title}</b><small>{task.due?.time !== undefined ? hm(task.due.time) : '当天结束'}</small></button>
        </div>)}
    </div>;
    if (!events.length) return <>{head}{strip}{dues}{!due.length && <div className="empty">{line.holidays.get(day) ?? '这一天没有安排'}</div>}</>;
    const fold = today && isMe;
    const gone = fold ? events.filter(event => event.end <= now.min) : [];
    const live = fold ? events.filter(event => event.end > now.min) : events;
    if (!live.length) return <>{head}{strip}{dues}{gone.length > 0 && <div className="gone">已结束 {gone.length} 项 · {gone.map(event => event.short).join('、')}</div>}<div className="empty">今天的课都上完了</div></>;
    // The campus day opens with the first period. Before that nobody looks for a room, and the column does not
    // stretch back to midnight: "now" joins it only within the hour before the day's first thing.
    const opens = minutesOf(line.periods[0]!.start);
    const awake = fold && now.min >= Math.min(opens, live[0]!.start) - 60;
    const free = Math.max(now.min, opens);
    const from = (awake ? Math.min(now.min, live[0]!.start) : live[0]!.start) - 14;
    const to = Math.max(Math.max(...live.map(event => event.end)) + 24, awake ? now.min + 20 : 0);
    const y = (minutes: number) => Math.round(minutes - from);
    const hours: number[] = [];
    for (let time = Math.ceil(from / 60) * 60; time <= to; time += 60) hours.push(time);
    const gap = (start: number, end: number, key: string) => <a key={key} className="gapbtn" style={{ top: y((start + end) / 2) }} href={roomsAt(day, start)}>空 {durationText(end - start)} · 看这时的空教室<Chevron /></a>;
    return (
        <>
            {head}{strip}{dues}
            {gone.length > 0 && <div className="gone">已结束 {gone.length} 项 · {gone.map(event => event.short).join('、')}</div>}
            <div className="tl" style={{ height: y(to) }}>
                {hours.map(time => <div key={time}><div className="hl" style={{ top: y(time) }} />{!(awake && Math.abs(time - now.min) < 16) && <div className="hn" style={{ top: y(time) }}>{time / 60}:00</div>}</div>)}
                {awake && live[0]!.start - free >= 45 && gap(free, live[0]!.start, 'first')}
                {/* Everything on, at its own time, back to front: what is behind shows beside what is in front. */}
                {layers(live, order).map(({ event, under, over }) => (
                    <button key={event.id} className={`t ${tileClass(event, record)} ${event.task?.done ? 'done' : ''}`} style={{ top: y(event.start) + 1, height: Math.max(40, y(event.end) - y(event.start) - 2), right: under * 8, ...tileStyle(event, tones, line) }} onClick={() => onOpen(event)}>
                        {event.name}<small>{hm(event.start)}–{hm(event.end)}{event.lab ? ` · ${event.lab.project}` : ''}{event.room ? ` · ${roomLabel(event.room)}` : ''}</small>
                        {over === 0 && under > 0 && <i className="more">同时段另有 {under} 项</i>}
                    </button>
                ))}
                {/* Free time is between runs of things that overlap, not between any two of them. */}
                {clusters(live, order).map((run, index, runs) => {
                    const next = runs[index + 1];
                    const start = Math.max(today ? Math.max(run.end, now.min) : run.end, opens);
                    return next && next.start - start >= 30 && next.start - run.end >= 45 ? gap(start, next.start, `gap${index}`) : null;
                })}
                {awake && <div className="nowl" style={{ top: y(now.min) }}><b>{hm(now.min)}</b></div>}
            </div>
        </>
    );
}
