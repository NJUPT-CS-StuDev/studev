import { useEffect, useMemo, useState } from 'react';
import { eventsOn, examDays, lastLesson, planRuns, runDates, runGone, runTally, toggleRun, type CampusEvent, type RunPlan, type Timeline } from '@/world/events';
import { updateRun, writePreferences } from '@/world/preferences';
import { usePreferences } from '@/world/usePreferences';
import { loadCalendar, type CalendarTerm, type ExamRecord } from '@/world/data';
import type { Exam, ExamChange, Practice } from '@/world/facts';
import { CHANGE_NAMES, changeLines, wasChanged, weeksText } from '@/world/exams';
import { courseName, courseShort, roomLabel } from '@/world/names';
import { addDays, dateLabel, daysBetween, WEEKDAYS, weekdayOf, type Moment } from '@/world/time';
import { Chevron } from '@/world/ui';

/** The term in three pages: the grid with everything on it, the exams as a list, and 早锻炼 to plan. */
export type TermMode = 'course' | 'exam' | 'run';

const lead = (days: number) => days === 0 ? '今天' : days === 1 ? '明天' : `${days} 天后`;
const dayHead = (date: string) => `${dateLabel(date)} ${WEEKDAYS[weekdayOf(date)]}`;
const placeOf = (exam: Exam) => exam.room ? roomLabel(exam.room) : exam.location;
const clock = (iso: string) => new Date(iso).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).replace(/\//, '月').replace(/ /, '日 ');

function RunPanel({ plan, line, now }: { plan: RunPlan; line: Timeline; now: Moment }) {
    const { rule, adjust } = plan;
    const tally = runTally(plan, now);
    return (
        <div className="runpanel">
            <div className="runhead"><b>{tally.count}</b><span>/ {rule.required} 次</span></div>
            <div className="meta">已跑 {tally.done}{adjust ? ` · 奖惩 ${adjust > 0 ? '+' : ''}${adjust}` : ''} · 排上 {tally.planned} · {tally.need ? `还差 ${tally.need}` : '够了'}{tally.nextBonus ? ` · 跑到 ${tally.nextBonus[0]} 次加 ${tally.nextBonus[1]} 分` : ''}</div>
            <p className="meta">排上的日子过了就算跑过；哪天没跑，点一下去掉。</p>
            <div className="btns"><button className="btn go" disabled={!tally.need && !tally.planned} onClick={() => updateRun({ days: planRuns(plan, line, now) })}>自动排好剩下的</button></div>
            <div className="kv"><span className="v">奖惩次数<small>对照南邮小程序的奖惩记录</small></span><span className="stepper"><button className="ib" aria-label="减一次" onClick={() => updateRun({ adjust: adjust - 1 })}>−</button>{adjust > 0 ? `+${adjust}` : adjust}<button className="ib" aria-label="加一次" onClick={() => updateRun({ adjust: adjust + 1 })}>+</button></span></div>
        </div>
    );
}

/**
 * Why the list can be trusted, said as something one can check: every sheet the office published has
 * been read, and when its site was last looked at; then every change seen, on request. The office
 * withdraws old notices, so nothing here links to them.
 */
function ExamRecordNote({ record, changes }: { record: ExamRecord; changes: ExamChange[] }) {
    const days = [...new Set(changes.map(change => change.observed))].sort().reverse();
    return (
        <div className="xtrust">
            {record.checked && <p>已核对教务处发布的全部考试安排表 · 最近检查 {clock(record.checked)}</p>}
            {days.length > 0 && <details className="xhist">
                <summary>变动 {changes.length} 处 · 最近 {dateLabel(days[0]!)}</summary>
                {days.map(day => changes.filter(change => change.observed === day).map((change, at) => (
                    <div key={`${day}-${at}`} className="xchange">
                        <span className={`xk ${change.change}`}>{CHANGE_NAMES[change.change]}</span>
                        <span className="m">{courseName(change.course.name)}<small>{dateLabel(day)} 发现</small>{changeLines(change).map(text => <small key={text}>{text}</small>)}</span>
                    </div>
                )))}
            </details>}
        </div>
    );
}

export function TermView({ line, now, isMe, record, practice, mode, onMode, onPick, onOpen }: {
    line: Timeline; now: Moment; isMe: boolean; record: ExamRecord | null; practice: Practice[]; mode: TermMode;
    onMode: (mode: TermMode) => void; onPick: (date: string) => void; onOpen: (event: CampusEvent) => void;
}) {
    const [terms, setTerms] = useState<CalendarTerm[]>([]);
    const { prefs } = usePreferences();
    const seen = prefs.examsSeen;
    useEffect(() => { void loadCalendar().then(setTerms); }, []);
    const codes = useMemo(() => new Set(line.meetings.map(meeting => meeting.course.code ?? '')), [line.meetings]);
    const changes = (record?.changes ?? []).filter(change => !isMe || codes.has(change.course.code ?? ''));
    const latest = changes.map(change => change.observed).sort().at(-1) ?? null;
    useEffect(() => {
        // Someone arriving for the first time has nothing new to be told about.
        if (isMe && latest && seen !== latest && (mode === 'exam' || seen === undefined)) writePreferences(current => ({ ...current, examsSeen: latest }));
    }, [isMe, latest, mode, seen]);
    const fresh = Boolean(isMe && latest && seen && latest > seen && mode !== 'exam');
    const plan = isMe ? line.run : null;
    const ahead = examDays(line, now.date);
    const taken = useMemo(() => line.exams.filter(exam => exam.date < now.date).sort((left, right) => right.date.localeCompare(left.date) || right.start.localeCompare(left.start)), [line.exams, now.date]);
    const hasExams = line.exams.length > 0 || changes.length > 0;
    const showing: TermMode = mode === 'exam' && hasExams ? 'exam' : mode === 'run' && plan ? 'run' : 'course';
    const modes: [TermMode, string][] = [['course', '课程'], ...(hasExams ? [['exam', '考试'] as [TermMode, string]] : []), ...(plan ? [['run', '早锻炼'] as [TermMode, string]] : [])];
    const runnable = useMemo(() => new Set(plan ? runDates(plan.rule, line.holidays) : []), [plan, line.holidays]);
    const calendar = terms.find(term => term.start === line.term.weeks[0]?.start);
    const termEnd = calendar?.end ?? line.term.weeks.at(-1)!.end;
    const last = useMemo(() => lastLesson(line), [line]);
    const courses = new Set(line.exams.map(exam => exam.course.code ?? exam.course.name)).size;
    const offGrid = [...new Map(practice.map(item => [`${item.name}|${item.weeks.join()}`, item])).values()].sort((left, right) => left.weeks[0]! - right.weeks[0]! || left.name.localeCompare(right.name));
    const when = (item: { start: string; end: string }) => item.start === item.end ? dayHead(item.start) : `${dateLabel(item.start)} – ${dateLabel(item.end)}`;
    const calendarAhead = [
        ...(calendar?.holidays ?? []).map(item => ({ ...item, text: when(item) })),
        ...(calendar?.events ?? []).map(item => ({ ...item, text: `${when(item)} · 按惯例全天停课` })),
        ...(calendar?.break ? [{ ...calendar.break, text: when(calendar.break) }] : []),
    ]
        .filter(item => item.start >= now.date).sort((left, right) => left.start.localeCompare(right.start));
    const eventOf = (exam: Exam) => eventsOn(line, exam.date).find(item => item.exam?.id === exam.id);
    const examRow = (exam: Exam, lead: string) => (
        <button key={exam.id} className="xrow" onClick={() => { const event = eventOf(exam); if (event) onOpen(event); }}>
            <span className="cd">{lead}</span>
            <span className="m">{courseName(exam.course.name)}{wasChanged(record, exam) && <span className="xk changed">改过</span>}<small>{lead === exam.start ? `到 ${exam.end}` : `${exam.start}–${exam.end}`} · {placeOf(exam)}</small></span>
            <Chevron />
        </button>
    );
    const present = new Set<string>();
    const cell = (date: string) => {
        const label = date.slice(8) === '01' ? `${Number(date.slice(5, 7))}月` : String(Number(date.slice(8)));
        const today = date === now.date ? 'today' : '';
        if (today) present.add('today');
        if (date > termEnd || date < line.term.weeks[0]!.start) return <span key={date} className="dc out" />;
        const past = date < now.date;
        if (showing === 'run' && plan) {
            if (!runnable.has(date)) return <span key={date} className={`dc none ${today}`}>{label}</span>;
            const planned = plan.days.includes(date);
            const state = planned ? (runGone(plan.rule, date, now) ? 'rdone' : 'rplan') : past ? 'rgone' : 'ropen';
            present.add(state);
            return <button key={date} className={`dc ${state} ${today}`} aria-label={`${dateLabel(date)} ${state === 'rdone' ? '已跑，点一下去掉' : state === 'rplan' ? '排上了，点一下去掉' : '点一下排上'}`} onClick={() => updateRun({ days: toggleRun(plan.days, date) })}>{label}</button>;
        }
        const events = eventsOn(line, date);
        const exam = events.some(event => event.kind === 'exam');
        const holiday = line.holidays.get(date);
        // An exam outranks a lesson: it is rarer, and it matters more. The term is shown whole: a lesson or exam already gone by looks the same as one to come; today is marked on its own.
        const kind = exam ? 'exam' : holiday ? 'hol' : events.some(event => event.kind === 'class' || event.kind === 'lab') ? 'has' : '';
        if (kind) present.add(kind);
        return <button key={date} className={`dc ${kind} ${today}`} title={holiday ?? undefined} aria-label={`${dateLabel(date)}${holiday ? ` ${holiday}` : ''}${exam ? ' 有考试' : ''}`}
            onClick={() => { const first = events.find(event => event.kind === 'exam'); if (first) onOpen(first); else onPick(date); }}>{label}</button>;
    };
    const rows = line.term.weeks.flatMap(week => {
        const out = [
            <div key={`w${week.week}`} className={`wn ${week.start <= now.date && now.date <= week.end ? 'cur' : ''}`}>{week.week}</div>,
            ...Array.from({ length: 7 }, (_, index) => cell(addDays(week.start, index))),
        ];
        if (showing === 'course' && last && week.start <= last && last <= week.end && week.week < line.term.weeks.length) out.push(<div key="end" className="phase">课程结束 · {dayHead(last)}</div>);
        return out;
    });
    if (calendar?.break && calendar.break.start <= addDays(line.term.weeks.at(-1)!.end, 1)) rows.push(<div key="break" className="phase">{calendar.break.name} {dateLabel(calendar.break.start)}起</div>);
    const LEGEND: [string, string, string][] = showing === 'run'
        ? [['rdone', 'k-done', '已跑'], ['rplan', 'k-plan', '排上'], ['ropen', 'k-open', '可跑，点一下排上'], ['today', 'k-today', '今天']]
        : [['has', 'k-has', '上课'], ['exam', 'k-exam', '考试'], ['hol', 'k-hol', '不上课'], ['today', 'k-today', '今天']];
    const legend = LEGEND.filter(([state]) => present.has(state));
    const grid = (
        <div>
            <div className="term">
                <div />
                {WEEKDAYS.slice(1).map(name => <div key={name} className="th">{name.slice(1)}</div>)}
                {rows}
            </div>
            <div className="legend">{legend.map(([state, swatch, text]) => <span key={state}><i className={swatch}>{state === 'hol' ? '休' : ''}</i>{text}</span>)}</div>
        </div>
    );
    const tabs = modes.length > 1 && <div className="choice termmode" role="tablist">{modes.map(([key, label]) => <button key={key} role="tab" aria-selected={showing === key} className={showing === key ? 'on' : ''} onClick={() => onMode(key)}>{label}{key === 'exam' && fresh && <i className="dot" aria-label="有新变动" />}</button>)}</div>;

    if (showing === 'exam') return (
        <>
            {tabs}
            <div className="xlist">
                {/* The first thing to know: how soon, and what. */}
                <div className="xhead">{ahead[0] ? <><b>{lead(ahead[0].days)}考试</b><span>{ahead[0].exams.map(exam => courseShort(exam.course.name)).join('、')}</span></> : <b>后面没有考试了</b>}</div>
                {ahead.map((day, at) => <section key={day.date} className="xgroup">
                    <div className={`xdate ${at === 0 ? 'next' : ''}`}><small>{Number(day.date.slice(5, 7))}月</small><b>{Number(day.date.slice(8))}</b><small>{WEEKDAYS[weekdayOf(day.date)]}</small></div>
                    <div className="xitems">{day.exams.map(exam => (
                        <button key={exam.id} className="xitem" onClick={() => { const event = eventOf(exam); if (event) onOpen(event); }}>
                            <span className="m"><b>{courseName(exam.course.name)}</b>{wasChanged(record, exam) && <span className="xk changed">改过</span>}<small>{exam.start}–{exam.end} · {placeOf(exam)}</small></span>
                            <Chevron />
                        </button>
                    ))}</div>
                </section>)}
                {taken.length > 0 && <details className="xhist"><summary>已考 {taken.length} 场</summary>{taken.map(exam => examRow(exam, dateLabel(exam.date)))}</details>}
                {record && <ExamRecordNote record={record} changes={changes} />}
            </div>
        </>
    );
    return (
        <>
            {tabs}
            <div className={`termg ${showing === 'run' ? 'running' : ''}`}>
                {grid}
                <div>
                    {showing === 'run' && plan && <RunPanel plan={plan} line={line} now={now} />}
                    {showing === 'course' && <>
                        {plan && (() => { const tally = runTally(plan, now); return (
                            <button className="runc" onClick={() => onMode('run')}>
                                <b>早锻炼 {tally.count} / {plan.rule.required} 次</b>
                                <div className="bar"><i style={{ width: `${Math.min(100, tally.count / plan.rule.required * 100)}%` }} /></div>
                                已跑 {tally.done}，排上 {tally.planned}，{tally.need ? `还差 ${tally.need} 次` : '够了'}
                            </button>
                        ); })()}
                        {hasExams && <button className="runc xcard" onClick={() => onMode('exam')}>
                            <b>考试 · 已发现 {courses} 门{fresh && <i className="dot" aria-label="有新变动" />}</b>
                            {ahead[0] ? <>
                                <span className="xday">{dayHead(ahead[0].date)} · {lead(ahead[0].days)}</span>
                                {ahead[0].exams.map(exam => <span key={exam.id} className="xline"><span>{courseName(exam.course.name)}</span><span>{exam.start} · {placeOf(exam)}</span></span>)}
                            </> : <span className="xday">都考完了</span>}
                        </button>}
                        {offGrid.length > 0 && <>
                            <h3 className="sh">不在课表里的课</h3>
                            {offGrid.map(item => <div key={`${item.name}|${item.weeks.join()}`} className="xrow"><span className="m">{item.name}<small>{weeksText(item.weeks)}</small></span></div>)}
                        </>}
                        {calendarAhead.length > 0 && <><h3 className="sh">校历</h3>{calendarAhead.map(item => <div key={item.name + item.start} className="xrow"><span className="cd">{lead(daysBetween(now.date, item.start))}</span><span className="m">{item.name}<small>{item.text}</small></span></div>)}</>}
                    </>}
                </div>
            </div>
        </>
    );
}
