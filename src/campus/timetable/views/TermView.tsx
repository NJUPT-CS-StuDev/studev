import { useEffect, useMemo, useState } from 'react';
import { eventsOn, nextRunMark, planRuns, runDates, runTally, upcomingExams, type CampusEvent, type RunPlan, type Timeline } from '@/world/events';
import { updateRun, writePreferences } from '@/world/preferences';
import { usePreferences } from '@/world/usePreferences';
import { loadCalendar, loadExamRecord, type CalendarTerm, type ExamRecord } from '@/world/data';
import type { ExamChange, ExamSlot } from '@/world/facts';
import { courseName, roomLabel } from '@/world/names';
import { addDays, dateLabel, daysBetween, WEEKDAYS, weekdayOf, type Moment } from '@/world/time';
import { Chevron } from '@/world/ui';

export type TermMode = 'course' | 'exam' | 'run';

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

const slotText = (slots: ExamSlot[] | null, read: (slot: ExamSlot) => string | number | null) => [...new Set((slots ?? []).map(read))].map(value => value === null || value === '' ? '未填写' : String(value)).join('、') || '未填写';
const SLOT_FIELDS: [string, (slot: ExamSlot) => string | number | null][] = [
    ['时间', slot => `${slot.date} ${slot.start}–${slot.end}`], ['地点', slot => slot.location], ['校区', slot => slot.campus], ['教师', slot => slot.teacher], ['人数', slot => slot.students],
];
const changeLines = (change: ExamChange) => change.change === 'changed'
    ? SLOT_FIELDS.flatMap(([label, read]) => { const [before, after] = [slotText(change.before, read), slotText(change.after, read)]; return before === after ? [] : [`${label}：${before} → ${after}`]; })
    : change.change === 'added' ? [`${slotText(change.after, SLOT_FIELDS[0]![1])} · ${slotText(change.after, SLOT_FIELDS[1]![1])}`]
        : [`原定 ${slotText(change.before, SLOT_FIELDS[0]![1])}`];
const CHANGE_NAMES = { added: '新增', changed: '调整', removed: '已移除' } as const;

/** What the school said and when it changed its mind: nothing about an exam moves silently. */
function ExamHistory({ record, relevant }: { record: ExamRecord; relevant: (change: ExamChange) => boolean }) {
    const changes = record.changes.filter(relevant);
    const days = [...new Set(changes.map(change => change.observed))].sort().reverse();
    return (
        <>
            <h3 className="sh">更新记录</h3>
            {days.length === 0 && <div className="meta">发布以来没有变动</div>}
            {days.map((day, index) => (
                <details key={day} className="xhist" open={index === 0}>
                    <summary>{dateLabel(day)} 发现 {changes.filter(change => change.observed === day).length} 处变动</summary>
                    {changes.filter(change => change.observed === day).map((change, at) => (
                        <div key={at} className="xchange">
                            <span className={`xk ${change.change}`}>{CHANGE_NAMES[change.change]}</span>
                            <span className="m">{courseName(change.course.name)}{changeLines(change).map(text => <small key={text}>{text}</small>)}</span>
                        </div>
                    ))}
                </details>
            ))}
            {record.sources.length > 0 && <>
                <h3 className="sh">来源</h3>
                {record.sources.map(source => <a key={source.url} className="xsource" href={source.url} target="_blank" rel="noopener noreferrer">{source.file.replace(/\.[a-z]+$/i, '').replace(/^\d{4}-\d{2}-\d{2}-/, '')}</a>)}
            </>}
        </>
    );
}

export function TermView({ line, now, isMe, classId, mode, onMode, onPick, onOpen }: { line: Timeline; now: Moment; isMe: boolean; classId: string | null; mode: TermMode; onMode: (mode: TermMode) => void; onPick: (date: string) => void; onOpen: (event: CampusEvent) => void }) {
    const [terms, setTerms] = useState<CalendarTerm[]>([]);
    const [record, setRecord] = useState<ExamRecord | null>(null);
    const { prefs } = usePreferences();
    const seen = prefs.examsSeen;
    useEffect(() => { void loadCalendar().then(setTerms); }, []);
    useEffect(() => { let live = true; setRecord(null); if (classId) void loadExamRecord(classId).then(next => { if (live) setRecord(next); }); return () => { live = false; }; }, [classId]);
    const codes = useMemo(() => new Set(line.meetings.map(meeting => meeting.course.code ?? '')), [line.meetings]);
    const relevant = (change: ExamChange) => !isMe || codes.has(change.course.code ?? '');
    const latest = record?.changes.filter(relevant).map(change => change.observed).sort().at(-1) ?? null;
    useEffect(() => {
        // Someone arriving for the first time has nothing new to be told about.
        if (isMe && latest && seen !== latest && (mode === 'exam' || seen === undefined)) writePreferences(current => ({ ...current, examsSeen: latest }));
    }, [isMe, latest, mode, seen]);
    const fresh = Boolean(isMe && latest && seen && latest > seen && mode !== 'exam');
    const plan = isMe ? line.run : null;
    const run = mode === 'run' && plan ? plan : null;
    const exams = upcomingExams(line, now.date);
    const taken = useMemo(() => line.exams.filter(exam => exam.date < now.date).sort((left, right) => right.date.localeCompare(left.date)), [line.exams, now.date]);
    const hasExams = exams.length + taken.length > 0 || (record?.changes.length ?? 0) > 0;
    const showing: TermMode = mode === 'exam' && hasExams ? 'exam' : run ? 'run' : 'course';
    const modes: [TermMode, string][] = [['course', '课程'], ...(hasExams ? [['exam', '考试'] as [TermMode, string]] : []), ...(plan ? [['run', '早锻炼'] as [TermMode, string]] : [])];
    const open = useMemo(() => new Set(plan ? runDates(plan.rule, line.holidays) : []), [plan, line.holidays]);
    const calendar = terms.find(term => term.start === line.term.weeks[0]?.start);
    const ahead = [...(calendar?.holidays ?? []), ...(calendar?.events ?? []), ...(calendar?.break ? [calendar.break] : [])]
        .map(item => ({ name: item.name, start: item.start, text: item.start === item.end ? `${dateLabel(item.start)} ${WEEKDAYS[weekdayOf(item.start)]}` : `${dateLabel(item.start)} – ${dateLabel(item.end)}` })).filter(item => item.start >= now.date).sort((left, right) => left.start.localeCompare(right.start));
    const examRow = (exam: Timeline['exams'][number], lead: string) => {
        const event = eventsOn(line, exam.date).find(item => item.exam?.id === exam.id);
        const changed = record?.changes.some(change => change.change === 'changed' && change.course.code === exam.course.code);
        return <button key={exam.id} id={`exam-${exam.date}`} className="xrow" onClick={() => event && onOpen(event)}>
            <span className="cd">{lead}</span>
            <span className="m">{courseName(exam.course.name)}{changed && <span className="xk changed">已调整</span>}<small>{dateLabel(exam.date)} {WEEKDAYS[weekdayOf(exam.date)]} {exam.start}{exam.room ? ` · ${roomLabel(exam.room)}` : exam.location ? ` · ${exam.location}` : ''}</small></span>
        </button>;
    };
    const lead = (days: number) => days === 0 ? '今天' : `${days} 天后`;
    const cell = (date: string) => {
        const day = Number(date.slice(8));
        const past = date < now.date;
        const today = date === now.date ? 'today' : '';
        if (run) {
            if (!open.has(date)) return <span key={date} className={`dc none ${today}`}>{day}</span>;
            const mark = run.days[date];
            const state = mark === 'done' ? 'rdone' : mark === 'plan' ? 'rplan' : past ? 'rgone' : 'ropen';
            return <button key={date} className={`dc ${state} ${today}`} aria-label={`${dateLabel(date)} ${mark === 'done' ? '已跑' : mark === 'plan' ? '计划' : past ? '已过' : '可跑'}`} onClick={() => updateRun({ days: nextRunMark(run.days, date, now.date) })}>{day}</button>;
        }
        const events = eventsOn(line, date);
        const exam = events.some(event => event.kind === 'exam');
        const holiday = line.holidays.get(date);
        if (showing === 'exam') return exam
            ? <button key={date} className={`dc exam ${past ? 'taken' : ''} ${today}`} aria-label={`${dateLabel(date)} 有考试`} onClick={() => document.getElementById(`exam-${date}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>{day}</button>
            : <span key={date} className={`dc none ${today}`}>{day}</span>;
        const kind = exam ? 'exam' : holiday ? 'hol' : events.some(event => event.kind === 'class') ? 'has' : '';
        return <button key={date} className={`dc ${kind} ${past ? 'past' : ''} ${today}`} title={holiday ?? undefined} aria-label={`${dateLabel(date)}${holiday ? ` ${holiday}` : ''}，${events.length} 项`} onClick={() => onPick(date)}>{day}</button>;
    };
    const legend = run ? [['k-done', '已跑'], ['k-plan', '计划'], ['k-open', '可跑，点一下排上'], ['k-gone', '已过']]
        : showing === 'exam' ? [['k-exam', '考试'], ['k-taken', '已考'], ['k-today', '今天']]
            : [['k-exam', '考试'], ['k-hol', '放假'], ['k-today', '今天']];
    return (
        <>
        {modes.length > 1 && <div className="choice termmode" role="tablist">{modes.map(([key, label]) => <button key={key} role="tab" aria-selected={showing === key} className={showing === key ? 'on' : ''} onClick={() => onMode(key)}>{label}{key === 'exam' && fresh && <i className="dot" aria-label="有新变动" />}</button>)}</div>}
        <div className={`termg ${run ? 'running' : ''}`}>
            <div>
                <div className="term">
                    <div />
                    {WEEKDAYS.slice(1).map(name => <div key={name} className="th">{name.slice(1)}</div>)}
                    {line.term.weeks.map(week => [
                        <div key={week.week} className={`wn ${week.start <= now.date && now.date <= week.end ? 'cur' : ''}`}>{week.week}</div>,
                        ...Array.from({ length: 7 }, (_, index) => cell(addDays(week.start, index))),
                    ])}
                </div>
                <div className="legend">{legend.map(([kind, label]) => <span key={kind}><i className={kind} />{label}</span>)}</div>
            </div>
            <div>
                {run && <RunPanel plan={run} line={line} now={now} />}
                {showing === 'exam' && <>
                    {exams.length > 0 ? <><h3 className="sh">还有 {exams.length} 场</h3>{exams.map(({ exam, days }) => examRow(exam, lead(days)))}</> : <div className="meta">后面没有考试了</div>}
                    {taken.length > 0 && <details className="xhist"><summary>已考 {taken.length} 场</summary>{taken.map(exam => examRow(exam, '已考'))}</details>}
                    {record && <ExamHistory record={record} relevant={relevant} />}
                </>}
                {showing === 'course' && <>
                    {plan && (() => { const tally = runTally(plan); return (
                        <button className="runc" onClick={() => onMode('run')}>
                            <b>早锻炼 {tally.count} / {plan.rule.required} 次</b>
                            <div className="bar"><i style={{ width: `${Math.min(100, tally.count / plan.rule.required * 100)}%` }} /></div>
                            已跑 {tally.done}，计划 {tally.planned}，{tally.need ? `还差 ${tally.need} 次` : '够了'}
                        </button>
                    ); })()}
                    {exams.length > 0 && <>
                        <h3 className="sh">考试</h3>
                        {exams.slice(0, 2).map(({ exam, days }) => examRow(exam, lead(days)))}
                        <button className="kv xmore" onClick={() => onMode('exam')}><span className="v">全部 {exams.length} 场和更新记录</span><Chevron /></button>
                    </>}
                    {ahead.length > 0 && <><h3 className="sh">校历</h3>{ahead.map(item => <div key={item.name + item.start} className="xrow"><span className="cd">{daysBetween(now.date, item.start)} 天后</span><span className="m">{item.name}<small>{item.text}</small></span></div>)}</>}
                </>}
            </div>
        </div>
        </>
    );
}
