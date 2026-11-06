import { planRuns, runDates, runTally, type RunPlan, type Timeline } from '@/world/events';
import { writePreferences, type RunSettings } from '@/world/preferences';
import { addDays, dateLabel, weekdayOf, type Moment } from '@/world/time';
import { Sheet } from '@/world/ui';

const save = (patch: Partial<RunSettings>) => writePreferences(current => ({ ...current, run: { days: {}, adjust: 0, ...current.run, ...patch } }));

/** Marks a morning as run on the day itself. */
export const markRun = (plan: RunPlan, date: string) => save({ days: { ...plan.days, [date]: 'done' } });

/** One tap moves a morning on: ahead it can only be planned; from today back it can be run. */
function nextMark(plan: RunPlan, date: string, today: string) {
    const mark = plan.days[date];
    const days = { ...plan.days };
    if (date > today) { if (mark) delete days[date]; else days[date] = 'plan'; }
    else if (mark === 'done') delete days[date];
    else days[date] = date === today && !mark ? 'plan' : 'done';
    return days;
}

/** The whole term's mornings: run, planned, or still open. */
export function RunPlanner({ plan, line, now, onClose }: { plan: RunPlan; line: Timeline; now: Moment; onClose: () => void }) {
    const { rule, days, adjust } = plan;
    const tally = runTally(plan);
    const open = new Set(runDates(rule, line.holidays));
    const weeks: string[][] = [];
    for (let monday = addDays(rule.start, 1 - weekdayOf(rule.start)); monday <= rule.end; monday = addDays(monday, 7)) {
        weeks.push(Array.from({ length: 5 }, (_, index) => addDays(monday, index)));
    }
    return (
        <Sheet title="早锻炼" onClose={onClose}>
            <div className="runhead"><b>{tally.count}</b><span>/ {rule.required} 次</span></div>
            <div className="meta">已跑 {tally.done}{adjust ? ` · 奖惩 ${adjust > 0 ? '+' : ''}${adjust}` : ''} · 计划 {tally.planned} · {tally.need ? `还差 ${tally.need}` : '够了'}{tally.nextBonus ? ` · 跑到 ${tally.nextBonus[0]} 次加 ${tally.nextBonus[1]} 分` : ''}</div>
            <div className="kv"><span className="v">奖惩次数<small>对照南邮小程序的奖惩记录</small></span><span className="stepper"><button className="ib" aria-label="减一次" onClick={() => save({ adjust: adjust - 1 })}>−</button>{adjust > 0 ? `+${adjust}` : adjust}<button className="ib" aria-label="加一次" onClick={() => save({ adjust: adjust + 1 })}>+</button></span></div>
            <div className="btns"><button className="btn go" disabled={!tally.need && !tally.planned} onClick={() => save({ days: planRuns(plan, line, now) })}>自动排好剩下的</button></div>
            <div className="runlegend"><i className="done" />已跑<i className="plan" />计划<i className="open" />可跑</div>
            <div className="rungrid" role="grid">
                <span /><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span>
                {weeks.map(week => <div className="runweek" key={week[0]} role="row">
                    <span className="runmonth">{dateLabel(week[0]!)}</span>
                    {week.map(date => open.has(date)
                        ? <button key={date} role="gridcell" className={`${days[date] ?? (date < now.date ? 'gone' : 'open')}${date === now.date ? ' today' : ''}`} aria-label={`${dateLabel(date)} ${days[date] === 'done' ? '已跑' : days[date] === 'plan' ? '计划' : '可跑'}`} onClick={() => save({ days: nextMark(plan, date, now.date) })}>{Number(date.slice(8))}</button>
                        : <span key={date} className="none">{Number(date.slice(8))}</span>)}
                </div>)}
            </div>
        </Sheet>
    );
}
