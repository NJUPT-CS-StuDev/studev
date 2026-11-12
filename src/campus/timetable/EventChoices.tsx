import { useState } from 'react';
import type { CampusEvent, Timeline } from '@/world/events';
import { usePreferences } from '@/world/usePreferences';
import { writePreferences } from '@/world/preferences';
import { AVOIDANCE, eventPreference, preferenceKey, type EventPreference } from '@/world/schedule';

/** Participation, planning and appearance are independent decisions. This edits only the last two. */
export function EventChoices({ event, line }: { event: CampusEvent; line: Timeline }) {
    const { prefs } = usePreferences();
    const [series, setSeries] = useState(event.kind === 'class');
    const current = eventPreference(event, line.term.term, prefs.events);
    const change = (value: EventPreference, whole = series) => writePreferences(prefs => {
        const key = preferenceKey(event, line.term.term, whole);
        const events = { ...prefs.events, [key]: { ...prefs.events?.[key], ...value } };
        if (whole && value.avoid) {
            const sitting = preferenceKey(event, line.term.term);
            if (sitting !== key && events[sitting]) {
                events[sitting] = { ...events[sitting], avoid: undefined };
                if (events[sitting].layer === undefined) delete events[sitting];
            }
        }
        if (!Object.values(events[key]!).some(value => value !== undefined)) delete events[key];
        return { ...prefs, events };
    });
    return <details className="event-choices">
        <summary>排程 · {AVOIDANCE.find(item => item.value === current.avoid)?.name}</summary>
        {(event.kind === 'class' || event.kind === 'lab') && <label className="meta"><input type="checkbox" checked={series} onChange={event => setSeries(event.target.checked)} /> 应用到这门{event.kind === 'lab' ? '实验' : '课'}的全部时段</label>}
        <div className="picks">{AVOIDANCE.map(({ value, name }) => <button key={value} className={current.avoid === value ? 'on' : ''} onClick={() => change({ avoid: value })}>{name}</button>)}</div>
        <button className="ib" onClick={() => change({ avoid: undefined })}>恢复排程默认</button>
        <p className="meta">排时间时如何避让这项安排；不改变是否参加、提醒或显示顺序。</p>
        <div className="btns">
            <button className="btn" onClick={() => change({ layer: Date.now() }, false)}>将这一项置于前面</button>
            <button className="btn" onClick={() => change({ layer: undefined }, false)}>恢复图层</button>
        </div>
    </details>;
}
