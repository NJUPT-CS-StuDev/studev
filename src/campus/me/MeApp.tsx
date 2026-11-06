// The one place for personal settings, reached from the avatar on every page.
import { useEffect, useMemo, useState } from 'react';
import { DATA_RELEASE } from '@/app/config/constants';
import { PRODUCT_CONFIG } from '@/app/config/product';
import { timetableEdits, updateTimetableEdits, writePreferences } from '@/shared/lib/preferences';
import { usePreferences } from '@/shared/lib/usePreferences';
import { ClassPicker } from '@/timetable/ClassPicker';
import { buildClassCalendar, downloadCalendar } from '@/timetable/model/calendar';
import { loadCalendar, loadClasses, loadClassExams, loadClassMeetings, loadPeriods, loadRuns, loadTerm, type MorningRun } from '@/world/data';
import { gradeOf } from '@/world/events';
import { Chevron, Sheet, Toggle } from '@/world/ui';
import type { TeachingClass, TeachingTerm } from '@/academics/facts';
import { APPEARANCES, readAppearance, setAppearance, type Appearance } from '@/world/appearance';
import '../campus.css';

const compact = (value: string) => value.replace(/[-:]/g, '');
const allDay = (uid: string, name: string, start: string, end: string) => {
    const next = new Date(`${end}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    return ['BEGIN:VEVENT', `UID:${uid}@studev`, `DTSTAMP:${compact(new Date().toISOString().slice(0, 19))}Z`, `DTSTART;VALUE=DATE:${compact(start)}`, `DTEND;VALUE=DATE:${compact(next.toISOString().slice(0, 10))}`, `SUMMARY:${name}`, 'END:VEVENT'];
};
const wrap = (rows: string[]) => `${['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//studev//ZH-CN', ...rows, 'END:VCALENDAR'].join('\r\n')}\r\n`;

export default function MeApp() {
    const [open, setOpen] = useState(false);
    const { prefs } = usePreferences();
    const [appearance, setLook] = useState<Appearance>(() => typeof document === 'undefined' ? 'auto' : readAppearance());
    const [picking, setPicking] = useState(false);
    const [facts, setFacts] = useState<{ term: TeachingTerm; classes: TeachingClass[]; run: MorningRun | null } | null>(null);
    useEffect(() => {
        const button = document.querySelector<HTMLElement>('[data-me]');
        const show = () => setOpen(true);
        button?.addEventListener('click', show);
        return () => button?.removeEventListener('click', show);
    }, []);
    useEffect(() => {
        if (!open || facts) return;
        void Promise.all([loadTerm(), loadClasses(), loadRuns()]).then(([term, classes, runs]) => setFacts({ term, classes, run: runs[term.term] ?? null }));
    }, [facts, open]);
    const info = useMemo(() => facts?.classes.find(item => item.name === prefs.class) ?? null, [facts, prefs.class]);
    if (!open) return null;
    if (picking || !prefs.class) return <Sheet title="选择班级" onClose={() => { setPicking(false); setOpen(false); }}><ClassPicker onPicked={() => setPicking(false)} /></Sheet>;

    const edits = facts ? timetableEdits(prefs, facts.term.term) : { hidden: [], added: [] };
    const grade = facts ? gradeOf(info?.grade, facts.term) : null;
    const run = prefs.run ?? { done: 0, alarm: false };
    const runOn = run.on ?? (grade !== null && grade <= 2);
    const setRun = (patch: Partial<typeof run>) => writePreferences(current => ({ ...current, run: { done: 0, alarm: false, ...current.run, ...patch } }));
    const exportLessons = async () => {
        const [term, periods, meetings] = await Promise.all([loadTerm(), loadPeriods(), loadClassMeetings(prefs.class!)]);
        const hidden = new Set(timetableEdits(prefs, term.term).hidden);
        downloadCalendar(`studev 课表 ${prefs.class}.ics`, buildClassCalendar(prefs.class!, meetings.filter(meeting => !hidden.has(meeting.teaching_class.id)), term.weeks, periods));
    };
    const exportExams = async () => {
        const exams = await loadClassExams(prefs.class!);
        downloadCalendar(`studev 考表 ${prefs.class}.ics`, wrap(exams.map(exam => [
            'BEGIN:VEVENT', `UID:${exam.id}@studev`, `DTSTAMP:${compact(new Date().toISOString().slice(0, 19))}Z`,
            `DTSTART;TZID=Asia/Shanghai:${compact(exam.date)}T${compact(exam.start)}00`, `DTEND;TZID=Asia/Shanghai:${compact(exam.date)}T${compact(exam.end)}00`,
            `SUMMARY:${exam.course.name} 考试`, `LOCATION:${exam.room ?? exam.location ?? ''}`, 'END:VEVENT',
        ].join('\r\n'))));
    };
    const exportCalendar = async () => {
        const terms = await loadCalendar();
        downloadCalendar('studev 校历.ics', wrap(terms.flatMap(term => [...term.holidays, ...term.events, ...(term.break ? [term.break] : [])]).map(item => allDay(`${item.name}-${item.start}`, item.name, item.start, item.end).join('\r\n'))));
    };
    return (
        <Sheet title="我" onClose={() => setOpen(false)}>
            <button className="kv" onClick={() => setPicking(true)}><span className="k">班级</span><span className="v">{prefs.class}{info?.major ? ` · ${info.major}` : ''}</span><Chevron /></button>
            <div className="kv"><span className="k">改动</span><span className="v">加了 {edits.added.length} 门，隐藏了 {edits.hidden.length} 门</span>
                {edits.hidden.length + edits.added.length > 0 && facts && <button className="ib" onClick={() => updateTimetableEdits(facts.term.term, () => ({ hidden: [], added: [] }))}>还原</button>}</div>
            <div className="kv"><span className="k">外观</span><div className="choice">{APPEARANCES.map(([value, label]) => <button key={value} className={value === appearance ? 'on' : ''} onClick={() => { setLook(value); setAppearance(value); }}>{label}</button>)}</div></div>
            <a className="kv" href="/account/"><span className="k">账号</span><span className="v">登录和社团表单</span><Chevron /></a>
            {facts?.run && <>
                <h3 className="sh gap">早锻炼</h3>
                <button className="kv" onClick={() => setRun({ on: !runOn })}><span className="v">显示在课表上<small>{grade !== null && grade <= 2 ? `大${'一二'[grade - 1]}必做，本学期 ${facts.run.required} 次` : '大三大四需要补跑时打开'}</small></span><Toggle on={runOn} /></button>
                {runOn && <div className="kv"><span className="v">已跑次数<small>对照南邮小程序填写</small></span><span className="stepper"><button className="ib" aria-label="减一次" onClick={() => setRun({ done: Math.max(0, run.done - 1) })}>−</button>{run.done}<button className="ib" aria-label="加一次" onClick={() => setRun({ done: run.done + 1 })}>+</button></span></div>}
            </>}
            <h3 className="sh gap">导入手机日历</h3>
            <button className="kv" onClick={() => void exportLessons()}><span className="v">studev 课表<small>下载日历文件</small></span><Chevron /></button>
            <button className="kv" onClick={() => void exportExams()}><span className="v">studev 考表<small>下载日历文件</small></span><Chevron /></button>
            <button className="kv" onClick={() => void exportCalendar()}><span className="v">studev 校历<small>放假和校历日程，整天显示</small></span><Chevron /></button>
            <a className="kv" href={PRODUCT_CONFIG.ANDROID_APP.DOWNLOAD_URL}><span className="v">下载 App<small>闹钟、提醒和桌面小组件</small></span><Chevron /></a>
            <a className="kv club-row" href="/club/"><span className="k">社团</span><span className="v">南邮计软网安学生发展中心</span><Chevron /></a>
            <p className="fine">数据版本 {DATA_RELEASE.data_version}</p>
        </Sheet>
    );
}
