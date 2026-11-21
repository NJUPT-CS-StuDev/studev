import { useEffect, useMemo, useState } from 'react';
import { eventsOn, examDays, lastLesson, planRuns, runDates, runGone, runTally, toggleRun, type CampusEvent, type RunPlan, type Timeline } from '@/world/events';
import { updateRun, writePreferences } from '@/world/preferences';
import { usePreferences } from '@/world/usePreferences';
import { loadCalendar, type CalendarTerm, type ExamRecord } from '@/world/data';
import type { Exam, Practice } from '@/world/facts';
import { wasChanged, weeksText } from '@/world/exams';
import { outsideTimetable } from '@/timetable/model/examAttendance';
import { ExamHistory } from '../ExamHistory';
import { courseName, courseShort, roomLabel } from '@/world/names';
import { addDays, dateLabel, daysBetween, WEEKDAYS, weekdayOf, type Moment } from '@/world/time';
import { Chevron, TextAction } from '@/world/ui';

/** The term in three pages: the grid with everything on it, the exams as a list, and 早锻炼 to plan. */
export type TermMode = 'course' | 'exam' | 'run';

const lead = (days: number) => days === 0 ? '今天' : days === 1 ? '明天' : `${days} 天后`;
const dayHead = (date: string) => `${dateLabel(date)} ${WEEKDAYS[weekdayOf(date)]}`;
const placeOf = (exam: Exam) => exam.room ? roomLabel(exam.room) : exam.location;

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

export function TermView({ line, now, isMe, record, recordFailed, onRecordRetry, practice, mode, onMode, onPick, onOpen, onExamChoices }: {
    line: Timeline; now: Moment; isMe: boolean; record: ExamRecord | null; practice: Practice[]; mode: TermMode;
    recordFailed: boolean; onRecordRetry: () => void;
    onMode: (mode: TermMode) => void; onPick: (date: string) => void; onOpen: (event: CampusEvent) => void;
    /** Takes exams away from one's own line (false) or brings them back (true). */
    onExamChoices: (choices: Record<string, boolean>) => void;
}) {
    const [terms, setTerms] = useState<CalendarTerm[]>([]);
    const { prefs } = usePreferences();
    const seen = prefs.examsSeen;
    useEffect(() => { void loadCalendar().then(setTerms); }, []);
    const changes = record?.changes ?? [];
    const latest = record?.history.filter(version => changes.some(change => change.version === version.id)).at(-1)?.id ?? null;
    const seenIndex = record?.history.findIndex(version => version.id === seen) ?? -1;
    useEffect(() => {
        // Someone arriving for the first time has nothing new to be told about.
        if (isMe && latest && seen !== latest && (mode === 'exam' || seenIndex < 0)) writePreferences(current => ({ ...current, examsSeen: latest }));
    }, [isMe, latest, mode, seen, seenIndex]);
    const fresh = Boolean(isMe && latest && seenIndex >= 0 && latest !== seen && mode !== 'exam');
    const plan = isMe ? line.run : null;
    const ahead = examDays(line, now.date);
    const taken = useMemo(() => line.exams.filter(exam => exam.date < now.date).sort((left, right) => right.date.localeCompare(left.date) || right.start.localeCompare(left.start)), [line.exams, now.date]);
    const hasExams = line.exams.length > 0 || (record?.history.length ?? 0) > 0 || recordFailed;
    const showing: TermMode = mode === 'exam' ? 'exam' : mode === 'run' && plan ? 'run' : 'course';
    const modes: [TermMode, string][] = [['course', '课程'], ...(hasExams || mode === 'exam' ? [['exam', '考试'] as [TermMode, string]] : []), ...(plan ? [['run', '早锻炼'] as [TermMode, string]] : [])];
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
    // What one has taken away stays listed, greyed; exams of courses not on one's timetable can be taken away at once.
    const skipped = useMemo(() => [...(line.skippedExams ?? [])].sort((left, right) => left.date.localeCompare(right.date) || left.start.localeCompare(right.start)), [line.skippedExams]);
    const outside = useMemo(() => line.ownCodes ? outsideTimetable(line.exams, line.ownCodes) : [], [line.exams, line.ownCodes]);
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
                <div className="xhead">{ahead[0] ? <><b>{lead(ahead[0].days)}考试</b><span>{ahead[0].exams.map(exam => courseShort(exam.course.name)).join('、')}</span></> : <b>暂未查到待考安排</b>}</div>
                {ahead.map((day, at) => <section key={day.date} className="xgroup">
                    <div className={`xdate ${at === 0 ? 'next' : ''}`}><small>{Number(day.date.slice(5, 7))}月</small><b>{Number(day.date.slice(8))}</b><small>{WEEKDAYS[weekdayOf(day.date)]}</small></div>
                    <div className="xitems">{day.exams.map(exam => (
                        <button key={exam.id} className="xitem" onClick={() => { const event = eventOf(exam); if (event) onOpen(event); }}>
                            <span className="m"><b>{courseName(exam.course.name)}</b>{wasChanged(record, exam) && <span className="xk changed">改过</span>}<small>{exam.start}–{exam.end} · {placeOf(exam)}</small></span>
                            <Chevron />
                        </button>
                    ))}</div>
                </section>)}
                {isMe && outside.length > 0 && <div className="xtidy">
                    <button onClick={() => onExamChoices(Object.fromEntries(outside.map(exam => [exam.id, false])))}>去掉课表里没有的课的考试（{outside.length}）</button>
                </div>}
                {taken.length > 0 && <details className="xhist"><summary><span>已考</span><span className="xcount">{taken.length} 场<Chevron /></span></summary>{taken.map(exam => examRow(exam, dateLabel(exam.date)))}</details>}
                {/* Taken away: out of the way, folded at the bottom, each one a tap from coming back. */}
                {skipped.length > 0 && <details className="xhist xskipped">
                    <summary><span>已去掉<small>不提醒</small></span><span className="xcount">{skipped.length} 场<Chevron /></span></summary>
                    <div className="xtidy"><button onClick={() => onExamChoices(Object.fromEntries(skipped.map(exam => [exam.id, true])))}>全部恢复</button></div>
                    {skipped.map(exam => <div key={exam.id} className="xrow off">
                        <span className="cd">{dateLabel(exam.date)}</span>
                        <span className="m">{courseName(exam.course.name)}<small>{exam.start}–{exam.end} · {placeOf(exam)}</small></span>
                        <button className="ib" onClick={() => onExamChoices({ [exam.id]: true })}>恢复</button>
                    </div>)}
                </details>}
                {record && <ExamHistory record={record} />}
                {recordFailed && <div className="xtrust"><p>更新记录暂时无法加载</p><TextAction onClick={onRecordRetry}>重试</TextAction></div>}
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
                            <b>{courses ? `考试 · 已发现 ${courses} 门` : '考试 · 最新安排与更新记录'}{fresh && <i className="dot" aria-label="有新变动" />}</b>
                            {ahead[0] ? <>
                                <span className="xday">{dayHead(ahead[0].date)} · {lead(ahead[0].days)}</span>
                                {ahead[0].exams.map(exam => <span key={exam.id} className="xline"><span>{courseName(exam.course.name)}</span><span>{exam.start} · {placeOf(exam)}</span></span>)}
                            </> : <span className="xday">{courses ? '都考完了' : '暂无待考安排'}</span>}
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
