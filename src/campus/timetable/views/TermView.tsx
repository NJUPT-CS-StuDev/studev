import { useEffect, useMemo, useState } from 'react';
import { eventsOn, nextRunMark, planRuns, runDates, runTally, upcomingExams, type CampusEvent, type RunPlan, type Timeline } from '@/world/events';
import { updateRun } from '@/world/preferences';
import { loadCalendar, type CalendarTerm } from '@/world/data';
import { courseName, roomLabel } from '@/world/names';
import { addDays, dateLabel, daysBetween, WEEKDAYS, weekdayOf, type Moment } from '@/world/time';

function RunSummary({ line, onPlan }: { line: Timeline; onPlan: () => void }) {
    if (!line.run) return null;
    const { rule } = line.run;
    const tally = runTally(line.run);
    return (
        <button className="runc" onClick={onPlan}>
            <b>早锻炼 {tally.count} / {rule.required} 次</b>
            <div className="bar"><i style={{ width: `${Math.min(100, tally.count / rule.required * 100)}%` }} /></div>
            已跑 {tally.done}，计划 {tally.planned}，{tally.need ? `还差 ${tally.need} 次` : '够了'}
        </button>
    );
}

function RunPanel({ plan, line, now }: { plan: RunPlan; line: Timeline; now: Moment }) {
    const { rule, adjust } = plan;
    const tally = runTally(plan);
    return (
        <div className="runpanel">
            <div className="runhead"><b>{tally.count}</b><span>/ {rule.required} 次</span></div>
            <div className="meta">已跑 {tally.done}{adjust ? ` · 奖惩 ${adjust > 0 ? '+' : ''}${adjust}` : ''} · 计划 {tally.planned} · {tally.need ? `还差 ${tally.need}` : '够了'}{tally.nextBonus ? ` · 跑到 ${tally.nextBonus[0]} 次加 ${tally.nextBonus[1]} 分` : ''}</div>
            <div className="btns"><button className="btn go" disabled={!tally.need && !tally.planned} onClick={() => updateRun({ days: planRuns(plan, line, now) })}>自动排好剩下的</button></div>
            <div className="kv"><span className="v">奖惩次数<small>对照南邮小程序的奖惩记录</small></span><span className="stepper"><button className="ib" aria-label="减一次" onClick={() => updateRun({ adjust: adjust - 1 })}>−</button>{adjust > 0 ? `+${adjust}` : adjust}<button className="ib" aria-label="加一次" onClick={() => updateRun({ adjust: adjust + 1 })}>+</button></span></div>
        </div>
    );
}

export function TermView({ line, now, isMe, running, onMode, onPick, onOpen }: { line: Timeline; now: Moment; isMe: boolean; running: boolean; onMode: (running: boolean) => void; onPick: (date: string) => void; onOpen: (event: CampusEvent) => void }) {
    const [terms, setTerms] = useState<CalendarTerm[]>([]);
    useEffect(() => { void loadCalendar().then(setTerms); }, []);
    const plan = isMe ? line.run : null;
    const run = running && plan ? plan : null;
    const open = useMemo(() => new Set(plan ? runDates(plan.rule, line.holidays) : []), [plan, line.holidays]);
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
    const runCell = (date: string, active: RunPlan) => {
        if (!open.has(date)) return <span key={date} className="dc rnone">{Number(date.slice(8))}</span>;
        const mark = active.days[date];
        const state = mark === 'done' ? 'rdone' : mark === 'plan' ? 'rplan' : date < now.date ? 'rgone' : 'ropen';
        return <button key={date} className={`dc ${state} ${date === now.date ? 'today' : ''}`} aria-label={`${dateLabel(date)} ${mark === 'done' ? '已跑' : mark === 'plan' ? '计划' : '可跑'}`} onClick={() => updateRun({ days: nextRunMark(active.days, date, now.date) })}>{Number(date.slice(8))}</button>;
    };
    return (
        <>
        {plan && <div className="choice termmode" role="tablist"><button role="tab" aria-selected={!run} className={run ? '' : 'on'} onClick={() => onMode(false)}>课程</button><button role="tab" aria-selected={!!run} className={run ? 'on' : ''} onClick={() => onMode(true)}>早锻炼</button></div>}
        <div className={`termg ${run ? 'running' : ''}`}>
            <div>
                <div className={`term ${run ? 'run' : ''}`}>
                    <div />
                    {WEEKDAYS.slice(1).map(name => <div key={name} className="th">{name.slice(1)}</div>)}
                    {line.term.weeks.map(week => [
                        <div key={week.week} className={`wn ${week.start <= now.date && now.date <= week.end ? 'cur' : ''}`}>{week.week}</div>,
                        ...Array.from({ length: 7 }, (_, index) => {
                            const date = addDays(week.start, index);
                            if (run) return runCell(date, run);
                            const events = eventsOn(line, date);
                            const holiday = line.holidays.get(date);
                            const level = Math.min(4, events.filter(event => event.kind === 'class').length);
                            const kind = events.some(event => event.kind === 'exam') ? 'exam' : holiday ? 'hol' : level ? `lv${level}` : '';
                            return <button key={date} className={`dc ${kind} ${date < now.date ? 'past' : ''} ${date === now.date ? 'today' : ''}`} title={`${date}${holiday ? ` ${holiday}` : ''}`} aria-label={`${dateLabel(date)}${holiday ? ` ${holiday}` : ''}，${events.length} 项`} onClick={() => onPick(date)} />;
                        }),
                    ])}
                </div>
                {run
                    ? <div className="legend"><span><i className="k-done" />已跑</span><span><i className="k-plan" />计划</span><span><i className="k-open" />可跑，点一下排上</span></div>
                    : <div className="legend"><span><i className="k-class" />课</span><span><i className="k-exam" />考试</span><span><i className="k-hol" />放假</span></div>}
            </div>
            <div>
                {run ? <RunPanel plan={run} line={line} now={now} /> : plan && <RunSummary line={line} onPlan={() => onMode(true)} />}
                {!run && exams.length > 0 && <><h3 className="sh">还有 {exams.length} 场考试</h3>{exams.map(eventRow)}</>}
                {!run && ahead.length > 0 && <><h3 className="sh">校历</h3>{ahead.map(item => <div key={item.name + item.start} className="xrow"><span className="cd">{daysBetween(now.date, item.start)} 天后</span><span className="m">{item.name}<small>{item.text}</small></span></div>)}</>}
            </div>
        </div>
        </>
    );
}
