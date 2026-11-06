import { useEffect, useState } from 'react';
import { eventsOn, runProgress, upcomingExams, type CampusEvent, type Timeline } from '@/world/events';
import { loadCalendar, type CalendarTerm } from '@/world/data';
import { courseName, roomLabel } from '@/world/names';
import { addDays, dateLabel, daysBetween, WEEKDAYS, weekdayOf, type Moment } from '@/world/time';

function RunCard({ line, now }: { line: Timeline; now: Moment }) {
    if (!line.run) return null;
    const { rule, done } = line.run;
    const progress = runProgress(line.run, line.holidays, now);
    return (
        <div className="runc">
            <b>早锻炼 {done} / {rule.required} 次</b>
            <div className="bar"><i style={{ width: `${Math.min(100, done / rule.required * 100)}%` }} /></div>
            距 {dateLabel(rule.end)} 结束还有 {progress.left} 个早锻炼日。
            {progress.need
                ? (progress.reachable ? `还差 ${progress.need} 次，每周跑 ${progress.perWeek} 次，可以提前 ${progress.earlyWeeks} 周完成，给雨天留余量。` : `还差 ${progress.need} 次，剩下的早锻炼日已经不够了，尽快联系体育部。`)
                : `已合格。${progress.nextBonus ? `再跑 ${progress.nextBonus[0] - done} 次，体育成绩 +${progress.nextBonus[1]}。` : ''}`}
        </div>
    );
}

export function TermView({ line, now, isMe, onPick, onOpen }: { line: Timeline; now: Moment; isMe: boolean; onPick: (date: string) => void; onOpen: (event: CampusEvent) => void }) {
    const [terms, setTerms] = useState<CalendarTerm[]>([]);
    useEffect(() => { void loadCalendar().then(setTerms); }, []);
    const calendar = terms.find(term => term.start === line.term.weeks[0]?.start);
    const exams = upcomingExams(line, now.date);
    const ahead = [...(calendar?.holidays ?? []), ...(calendar?.events ?? []), ...(calendar?.break ? [calendar.break] : [])]
        .map(item => ({ name: item.name, start: item.start, text: item.start === item.end ? `${dateLabel(item.start)} ${WEEKDAYS[weekdayOf(item.start)]}` : `${dateLabel(item.start)} – ${dateLabel(item.end)}` })).filter(item => item.start >= now.date).sort((left, right) => left.start.localeCompare(right.start));
    const eventRow = (exam: typeof exams[number]) => {
        const event = eventsOn(line, exam.exam.date).find(item => item.exam?.id === exam.exam.id);
        return <button key={exam.exam.id} className="xrow" onClick={() => event && onOpen(event)}>
            <span className="cd">{exam.days === 0 ? '今天' : `${exam.days} 天后`}</span>
            <span className="m">{courseName(exam.exam.course.name)}<small>{dateLabel(exam.exam.date)} {WEEKDAYS[weekdayOf(exam.exam.date)]} {exam.exam.start}{exam.exam.room ? ` · ${roomLabel(exam.exam.room)}` : ''}</small></span>
        </button>;
    };
    return (
        <div className="termg">
            <div>
                <div className="term">
                    <div />
                    {WEEKDAYS.slice(1).map(name => <div key={name} className="th">{name.slice(1)}</div>)}
                    {line.term.weeks.map(week => [
                        <div key={week.week} className={`wn ${week.start <= now.date && now.date <= week.end ? 'cur' : ''}`}>{week.week}</div>,
                        ...Array.from({ length: 7 }, (_, index) => {
                            const date = addDays(week.start, index);
                            const events = eventsOn(line, date);
                            const holiday = line.holidays.get(date);
                            const level = Math.min(4, events.filter(event => event.kind === 'class').length);
                            const kind = events.some(event => event.kind === 'exam') ? 'exam' : holiday ? 'hol' : level ? `lv${level}` : '';
                            return <button key={date} className={`dc ${kind} ${date < now.date ? 'past' : ''} ${date === now.date ? 'today' : ''}`} title={`${date}${holiday ? ` ${holiday}` : ''}`} aria-label={`${dateLabel(date)}${holiday ? ` ${holiday}` : ''}，${events.length} 项`} onClick={() => onPick(date)} />;
                        }),
                    ])}
                </div>
                <div className="legend"><span><i className="k-class" />课</span><span><i className="k-exam" />考试</span><span><i className="k-hol" />放假</span></div>
            </div>
            <div>
                {isMe && <RunCard line={line} now={now} />}
                {exams.length > 0 && <><h3 className="sh">还有 {exams.length} 场考试</h3>{exams.map(eventRow)}</>}
                {ahead.length > 0 && <><h3 className="sh">校历</h3>{ahead.map(item => <div key={item.name + item.start} className="xrow"><span className="cd">{daysBetween(now.date, item.start)} 天后</span><span className="m">{item.name}<small>{item.text}</small></span></div>)}</>}
            </div>
        </div>
    );
}
