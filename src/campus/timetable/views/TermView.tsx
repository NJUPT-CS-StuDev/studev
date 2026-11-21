import { useEffect, useMemo, useState } from 'react';
import { eventsOn, examDays, lastLesson, planRuns, runDates, runGone, runTally, toggleRun, type CampusEvent, type RunPlan, type Timeline } from '@/world/events';
import { updateRun, writePreferences } from '@/world/preferences';
import { usePreferences } from '@/world/usePreferences';
import { loadCalendar, type CalendarTerm, type ExamRecord } from '@/world/data';
import type { Exam, Practice } from '@/world/facts';
import { wasChanged, weeksText } from '@/world/exams';
import { outsideTimetable } from '@/timetable/model/examAttendance';
import { practiceName, practiceProgress } from '@/world/practice';
import { PracticeSheet } from '../PracticeSheet';
import { ExamHistory } from '../ExamHistory';
import { courseName, courseShort, roomLabel } from '@/world/names';
import { addDays, dateLabel, daysBetween, WEEKDAYS, weekdayOf, type Moment } from '@/world/time';
import { Chevron, TextAction } from '@/world/ui';

/** The term in three pages: the grid with everything on it, the exams as a list, and 早锻炼 to plan. */
/** The academic year's two terms (this one, with everything on it, and the other one's calendar), 早锻炼 planned on
 * this term's grid, and the exams, which are a page of their own. */
type TermMode = 'course' | 'other' | 'run';

const lead = (days: number) => days === 0 ? '今天' : days === 1 ? '明天' : `${days} 天后`;
const dayHead = (date: string) => `${dateLabel(date)} ${WEEKDAYS[weekdayOf(date)]}`;
type Span = { name: string; start: string; end: string };

/** A term of the year by its number, as the school calendar names it. */
const termLabel = (number: number) => `第${'一二三'[number - 1]}学期`;
type DayMark = { kind: '' | 'brk' | 'hol' | 'event' | 'term' | 'out'; name?: string };

/** What a day is on the school calendar, outside the term being shown: a break day, a holiday, an event, a term day. */
function dayMark(date: string, rest: Span | null, holidays: Span[], next: CalendarTerm | null): DayMark {
    const holiday = holidays.find(item => item.start <= date && date <= item.end);
    if (holiday) return { kind: 'hol', name: holiday.name };
    const event = next?.events.find(item => item.start <= date && date <= item.end);
    if (event) return { kind: 'event', name: event.name };
    if (rest && rest.start <= date && date <= rest.end) return { kind: 'brk' };
    if (next && next.start <= date && date <= next.end) return { kind: 'term' };
    return { kind: 'out' };
}

/** Whole weeks, Monday first, covering a span of the calendar: the same grid as the term's, for what lies beyond it. */
function CalendarWeeks({ from, to, now, numbered, inBand, marks }: { from: string; to: string; now: string; numbered?: boolean; inBand?: boolean; marks: (date: string) => DayMark }) {
    const first = addDays(from, -(weekdayOf(from) - 1));
    const weeks: string[] = [];
    for (let monday = first; monday <= to; monday = addDays(monday, 7)) weeks.push(monday);
    return (
        <div className={inBand ? 'term tband-grid' : 'term'}>
            <div />
            {WEEKDAYS.slice(1).map(name => <div key={name} className="th">{name.slice(1)}</div>)}
            {weeks.flatMap((monday, index) => [
                <div key={`w${monday}`} className="wn">{numbered ? index + 1 : ''}</div>,
                ...Array.from({ length: 7 }, (_, day) => {
                    const date = addDays(monday, day);
                    const mark = date < from || date > to ? { kind: 'out' as const } : marks(date);
                    const label = date.slice(8) === '01' ? `${Number(date.slice(5, 7))}月` : String(Number(date.slice(8)));
                    return <span key={date} className={`dc ${mark.kind} ${date === now ? 'today' : ''}`} title={mark.name}>{mark.kind === 'out' ? '' : label}</span>;
                }),
            ])}
        </div>
    );
}

/** Small marks for the three kinds of thing ahead, drawn like the site's other line icons. */
const ICONS = {
    exam: <svg viewBox="0 0 24 24"><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v4h4M10 12h5M10 16h5" /></svg>,
    calendar: <svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M9 3v4M15 3v4" /></svg>,
    practice: <svg viewBox="0 0 24 24"><path d="M6 21V4M6 4h10l-2 4 2 4H6" /></svg>,
};
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

export function TermView({ line, now, isMe, record, recordFailed, onRecordRetry, practice, examPage, mode, onMode, onExams, onPick, onOpen, onExamChoices }: {
    line: Timeline; now: Moment; isMe: boolean; record: ExamRecord | null; practice: Practice[]; examPage: boolean; mode: TermMode;
    recordFailed: boolean; onRecordRetry: () => void;
    onMode: (mode: TermMode) => void; onExams: () => void; onPick: (date: string) => void; onOpen: (event: CampusEvent) => void;
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
        if (isMe && latest && seen !== latest && (examPage || seenIndex < 0)) writePreferences(current => ({ ...current, examsSeen: latest }));
    }, [isMe, latest, examPage, seen, seenIndex]);
    const fresh = Boolean(isMe && latest && seenIndex >= 0 && latest !== seen && !examPage);
    const plan = isMe ? line.run : null;
    const ahead = examDays(line, now.date);
    const taken = useMemo(() => line.exams.filter(exam => exam.date < now.date).sort((left, right) => right.date.localeCompare(left.date) || right.start.localeCompare(left.start)), [line.exams, now.date]);
    const hasExams = line.exams.length > 0 || (record?.history.length ?? 0) > 0 || recordFailed;
    const calendar = terms.find(term => term.start === line.term.weeks[0]?.start);
    // The school calendar covers the year: the break after this term, and the term after it, can be seen already.
    const ordered = [...terms].sort((left, right) => left.start.localeCompare(right.start));
    const termAt = calendar ? ordered.indexOf(calendar) : -1;
    // The term after this one, for the break's "开学"; the other term of this academic year, for its own tab.
    const nextTerm = termAt >= 0 ? ordered[termAt + 1] ?? null : null;
    const otherTerm = calendar ? (calendar.number === 1 ? (nextTerm?.number === 2 ? nextTerm : null) : (ordered[termAt - 1]?.number === 1 ? ordered[termAt - 1]! : null)) : null;
    const calendarHolidays = [...(calendar?.holidays ?? []), ...(otherTerm?.holidays ?? []), ...(nextTerm && nextTerm !== otherTerm ? nextTerm.holidays : [])];
    const otherDays = otherTerm ? daysBetween(now.date, otherTerm.start) : 0;
    const showing: TermMode = mode === 'run' && plan ? 'run' : mode === 'other' && otherTerm ? 'other' : 'course';
    const ahead_ = (date: string) => { const days = daysBetween(now.date, date); return days < 0 ? '已过' : lead(days); };
    const runnable = useMemo(() => new Set(plan ? runDates(plan.rule, line.holidays) : []), [plan, line.holidays]);
    const termEnd = calendar?.end ?? line.term.weeks.at(-1)!.end;
    const last = useMemo(() => lastLesson(line), [line]);
    const courses = new Set(line.exams.map(exam => exam.course.code ?? exam.course.name)).size;
    const [openPractice, setOpenPractice] = useState<Practice | null>(null);
    const nowWeek = line.term.weeks.find(week => week.start <= now.date && now.date <= week.end)?.week ?? null;
    const offGrid = [...new Map(practice.filter(item => item.weeks.length > 0).map(item => [`${item.name}|${item.weeks.join()}`, item])).values()].sort((left, right) => left.weeks[0]! - right.weeks[0]! || left.name.localeCompare(right.name));
    const when = (item: { start: string; end: string }) => item.start === item.end ? dayHead(item.start) : `${dateLabel(item.start)} – ${dateLabel(item.end)}`;
    // The whole term's calendar: what is still to come leads, and what has passed (运动会, 校庆) folds beneath it.
    const calendarItems = [
        ...(calendar?.holidays ?? []).map(item => ({ ...item, text: when(item) })),
        ...(calendar?.events ?? []).map(item => ({ ...item, text: `${when(item)} · 按惯例全天停课` })),
        ...(calendar?.break ? [{ ...calendar.break, text: when(calendar.break) }] : []),
    ].sort((left, right) => left.start.localeCompare(right.start));
    const calendarAhead = calendarItems.filter(item => item.end >= now.date);
    const calendarPast = calendarItems.filter(item => item.end < now.date);
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
            onClick={() => { const exams = events.filter(event => event.kind === 'exam'); if (exams.length === 1) onOpen(exams[0]!); else onPick(date); }}>{label}</button>;
    };
    const rows = line.term.weeks.flatMap(week => {
        const out = [
            <div key={`w${week.week}`} className={`wn ${week.start <= now.date && now.date <= week.end ? 'cur' : ''}`}>{week.week}</div>,
            ...Array.from({ length: 7 }, (_, index) => cell(addDays(week.start, index))),
        ];
        if (showing === 'course' && last && week.start <= last && last <= week.end && week.week < line.term.weeks.length) out.push(<div key="end" className="phase">课程结束 · {dayHead(last)}</div>);
        return out;
    });
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
            {showing === 'course' && calendar?.break && <details className="tband">
                <summary>
                    <span className="tband-name">{calendar.break.name}</span>
                    <span className="tband-text">{dateLabel(calendar.break.start)} – {dateLabel(calendar.break.end)} · {daysBetween(calendar.break.start, calendar.break.end) + 1} 天{nextTerm ? ` · ${dateLabel(nextTerm.start)}开学` : ''}</span>
                    <Chevron />
                </summary>
                <CalendarWeeks inBand from={calendar.break.start} to={nextTerm ? addDays(nextTerm.start, 6) : calendar.break.end} now={now.date} marks={date => dayMark(date, calendar.break!, calendarHolidays, nextTerm)} />
            </details>}
        </div>
    );
    // The year's two terms, in the calendar's order, this one marked; 早锻炼 is a switch on this term's grid, not a page.
    const yearTabs = [calendar, otherTerm].filter((item): item is CalendarTerm => Boolean(item)).sort((left, right) => left.number - right.number);
    const tabs = <div className="termbar">
        {yearTabs.length > 1 && <div className="choice termmode" role="tablist">{yearTabs.map(item => { const key: TermMode = item === calendar ? 'course' : 'other'; const on = key === 'other' ? showing === 'other' : showing !== 'other'; return (
            <button key={item.start} role="tab" aria-selected={on} className={on ? 'on' : ''} onClick={() => onMode(key)}>{termLabel(item.number)}{item === calendar && <small className="termnow">本学期</small>}</button>
        ); })}</div>}
        {plan && showing !== 'other' && <button className={`runtoggle ${showing === 'run' ? 'on' : ''}`} aria-pressed={showing === 'run'} onClick={() => onMode(showing === 'run' ? 'course' : 'run')}>{showing === 'run' ? '完成' : '排早锻炼'}</button>}
    </div>;

    if (!examPage && showing === 'other') {
        const items = otherTerm ? [...otherTerm.holidays, ...otherTerm.events].sort((left, right) => left.start.localeCompare(right.start)) : [];
        return (
            <>
                {tabs}
                {otherTerm ? <div className="termg">
                    <div>
                        <CalendarWeeks from={otherTerm.start} to={otherTerm.end} now={now.date} numbered marks={date => dayMark(date, null, calendarHolidays, otherTerm)} />
                        <div className="legend"><span><i className="k-hol">休</i>放假</span>{otherTerm.events.length > 0 && <span><i className="k-event" />校历活动</span>}</div>
                        {otherTerm.break && <details className="tband">
                            <summary>
                                <span className="tband-name">{otherTerm.break.name}</span>
                                <span className="tband-text">{dateLabel(otherTerm.break.start)} – {dateLabel(otherTerm.break.end)} · {daysBetween(otherTerm.break.start, otherTerm.break.end) + 1} 天</span>
                                <Chevron />
                            </summary>
                            <CalendarWeeks inBand from={otherTerm.break.start} to={otherTerm.break.end} now={now.date} marks={date => dayMark(date, otherTerm.break!, calendarHolidays, null)} />
                        </details>}
                    </div>
                    <div>
                        <section className="tcard holiday">
                            <span className="tcard-head"><i className="tcard-icon" aria-hidden="true">{ICONS.calendar}</i><b>{line.term.year}–{line.term.year + 1} 学年{termLabel(otherTerm.number)}</b><span className="tcard-meta">{otherDays > 0 ? `${otherDays} 天后开学` : otherTerm.end < now.date ? '已结束' : ''}</span></span>
                            <span className="tcard-lead"><b>{dateLabel(otherTerm.start)} – {dateLabel(otherTerm.end)}</b><span className="tcard-pill">{otherTerm.weeks} 周</span></span>
                            {items.map(item => <span key={item.name + item.start} className="tcard-row"><span className={`tcard-pill ${otherTerm.events.includes(item) ? 'event' : ''}`}>{ahead_(item.start)}</span><span className="grow">{item.name}<small>{when(item)}</small></span></span>)}
                            {otherTerm.break && <span className="tcard-row"><span className="tcard-pill">{ahead_(otherTerm.break.start)}</span><span className="grow">{otherTerm.break.name}<small>{dateLabel(otherTerm.break.start)} – {dateLabel(otherTerm.break.end)} · {daysBetween(otherTerm.break.start, otherTerm.break.end) + 1} 天</small></span></span>}
                        </section>
                        {otherDays > 0 && <p className="tband-note">这个学期的课表公布后，课程和考试会出现在这里。</p>}
                    </div>
                </div> : null}
            </>
        );
    }
    if (examPage) return (
        <>
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
                        {/* Three kinds of thing ahead, each in the colour the grid gives it: exams, the school calendar, practice. */}
                        {hasExams && <button className="tcard exam" onClick={onExams}>
                            <span className="tcard-head"><i className="tcard-icon" aria-hidden="true">{ICONS.exam}</i><b>考试</b><span className="tcard-meta">{courses ? `${courses} 门` : '更新记录'}{fresh && <i className="dot" aria-label="有新变动" />}<Chevron /></span></span>
                            {ahead[0] ? <>
                                <span className="tcard-lead"><b>{dayHead(ahead[0].date)}</b><span className="tcard-pill">{lead(ahead[0].days)}</span></span>
                                {ahead[0].exams.map(exam => <span key={exam.id} className="tcard-row"><span>{courseName(exam.course.name)}</span><small>{exam.start} · {placeOf(exam)}</small></span>)}
                            </> : <span className="tcard-row"><span className="faint">{courses ? '都考完了' : '暂无待考安排'}</span></span>}
                        </button>}
                        {offGrid.length > 0 && <section className="tcard practice">
                            <span className="tcard-head"><i className="tcard-icon" aria-hidden="true">{ICONS.practice}</i><b>实践课程</b><span className="tcard-meta">不占课表格子</span></span>
                            {offGrid.map(item => { const progress = practiceProgress(item.weeks, nowWeek); return (
                                <button key={`${item.name}|${item.weeks.join()}`} className="tcard-row tcard-link" onClick={() => setOpenPractice(item)}>
                                    <span className="grow">{practiceName(item)}<small className={`progress ${progress.state}`}>{progress.text}</small></span><small>{weeksText(item.weeks)}</small><Chevron />
                                </button>
                            ); })}
                        </section>}
                        {calendarItems.length > 0 && <section className="tcard holiday">
                            <span className="tcard-head"><i className="tcard-icon" aria-hidden="true">{ICONS.calendar}</i><b>校历</b></span>
                            {calendarAhead.map(item => <span key={item.name + item.start} className="tcard-row"><span className="tcard-pill">{item.start <= now.date ? '进行中' : lead(daysBetween(now.date, item.start))}</span><span className="grow">{item.name}<small>{item.text}</small></span></span>)}
                            {calendarPast.length > 0 && <details className="tcard-past">
                                <summary><span>已过</span><span className="xcount">{calendarPast.length} 项<Chevron /></span></summary>
                                {calendarPast.map(item => <span key={item.name + item.start} className="tcard-row past"><span className="tcard-pill">已过</span><span className="grow">{item.name}<small>{item.text}</small></span></span>)}
                            </details>}
                        </section>}
                    </>}
                </div>
            </div>
            {openPractice && <PracticeSheet practice={openPractice} term={line.term} week={nowWeek} onClose={() => setOpenPractice(null)} />}
        </>
    );
}
