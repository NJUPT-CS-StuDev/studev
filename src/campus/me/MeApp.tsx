// The one place for personal settings, reached from the avatar on every page.
import { useEffect, useMemo, useState } from 'react';
import { DATA_RELEASE } from '@/world/config';
import { PRODUCT_CONFIG } from '@/world/product';
import { timetableEdits, updateTimetableEdits, writePreferences } from '@/world/preferences';
import { usePreferences } from '@/world/usePreferences';
import { ClassPicker } from '@/timetable/ClassPicker';
import { CustomCourses } from '@/timetable/CustomCourses';
import { loadClasses, loadClassLabs, loadLabs, loadPeriods, loadRuns, loadTerm, type MorningRun } from '@/world/data';
import { labCourseKey, labSheet, personalLabs } from '@/timetable/model/labs';
import { publishedOn } from '@/world/exams';
import { courseName } from '@/world/names';
import { dateLabel, hm, minutesOf } from '@/world/time';
import { gradeOf, LAYER_ORDER, type EventKind } from '@/world/events';
import { Chevron, Sheet, Toggle } from '@/world/ui';
import type { Lab, TeachingClass, TeachingTerm } from '@/world/facts';
import { APPEARANCES, readAppearance, setAppearance, type Appearance } from '@/world/appearance';
import { labels } from '../../platform/client/api';
import '../campus.css';

export default function MeApp() {
    const [open, setOpen] = useState(false);
    const { prefs } = usePreferences();
    const [appearance, setLook] = useState<Appearance>(() => typeof document === 'undefined' ? 'auto' : readAppearance());
    const [picking, setPicking] = useState(false);
    const [layering, setLayering] = useState(false);
    const [classLabs, setClassLabs] = useState<Lab[] | null>(null);
    const [labsOpen, setLabsOpen] = useState(false);
    const [extraClass, setExtraClass] = useState('');
    const [coursesOpen, setCoursesOpen] = useState(false);
    const [periods, setPeriods] = useState(12);
    useEffect(() => { if (open) void loadPeriods().then(list => setPeriods(list.length)); }, [open]);
    useEffect(() => { let live = true; setClassLabs(null); if (open && prefs.class) void Promise.all([loadClassLabs(prefs.class), prefs.labs?.classes?.length ? loadLabs() : Promise.resolve([] as Lab[])]).then(([own, all]) => { if (live) setClassLabs(personalLabs(own, prefs.labs?.classes ?? [], all)); }).catch(() => { if (live) setClassLabs([]); }); return () => { live = false; }; }, [open, prefs.class, prefs.labs?.classes]);
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
    const [shared, setShared] = useState(false);
    // Who is signed in, as the account pages keep it in this browser.
    const account = useMemo(() => {
        try { return JSON.parse(localStorage.getItem('studev_auth_user') ?? 'null') as { nickname: string; role: string } | null; } catch { return null; }
    }, [open]);
    const share = async () => {
        const url = `${PRODUCT_CONFIG.ORIGIN}/`;
        if (navigator.share) { await navigator.share({ title: 'StuDev', url }).catch(() => undefined); return; }
        await navigator.clipboard.writeText(url);
        setShared(true);
    };
    if (!open) return null;
    const order = prefs.layers ?? LAYER_ORDER;
    const KIND_NAMES: Record<EventKind, string> = { exam: '考试', task: '任务', lab: '实验', class: '课程', run: '早锻炼' };
    // Moving one up a step swaps it with the one before: the whole order is always written.
    const raise = (kind: EventKind) => writePreferences(current => {
        const next = [...(current.layers ?? LAYER_ORDER)];
        const at = next.indexOf(kind);
        if (at > 0) [next[at - 1], next[at]] = [next[at]!, next[at - 1]!];
        return { ...current, layers: next };
    });
    const choices = prefs.labs ?? {};
    const sheets = [...new Map((classLabs ?? []).map(lab => [labSheet(lab), lab])).values()];
    const setChoice = (key: 'off' | 'drop' | 'skip' | 'classes', value: string, on: boolean) => writePreferences(current => {
        const list = new Set(current.labs?.[key] ?? []);
        if (on) list.add(value); else list.delete(value);
        return { ...current, labs: { ...current.labs, [key]: [...list] } };
    });
    if (coursesOpen && facts) return <CustomCourses term={facts.term.term} weeks={facts.term.weeks.length} periods={periods} edits={timetableEdits(prefs, facts.term.term)} onClose={() => setCoursesOpen(false)} />;
    if (labsOpen) {
        const dropped = [...new Map((classLabs ?? []).filter(lab => choices.drop?.includes(labCourseKey(lab))).map(lab => [labCourseKey(lab), lab])).values()];
        const skipped = (classLabs ?? []).filter(lab => choices.skip?.includes(lab.id));
        return (
            <Sheet title="实验安排" onClose={() => setLabsOpen(false)}>
                <p className="fine lead">实验与理论课各自选择。每份表可以整份关闭，也可以单独不上某门实验或某一次；增删理论课不改变这里的选择。</p>
                <h3 className="sh gap">其他班级的实验</h3>
                {(choices.classes ?? []).map(name => <div className="kv" key={name}><span className="v">{name}</span><button className="ib" onClick={() => setChoice('classes', name, false)}>移除</button></div>)}
                <div className="trow"><input className="tf" aria-label="实验班级" placeholder="如 B240402" value={extraClass} onChange={event => setExtraClass(event.target.value.toUpperCase())} /><button className="btn" disabled={!/^[A-Z]\d{6}(\([A-Z]{2}\))?$/.test(extraClass.trim())} onClick={() => { setChoice('classes', extraClass.trim(), true); setExtraClass(''); }}>添加</button></div>
                {sheets.map(lab => <button key={labSheet(lab)} className="kv" onClick={() => setChoice('off', labSheet(lab), !choices.off?.includes(labSheet(lab)))}>
                    <span className="v">{labSheet(lab)}<small>{dateLabel(publishedOn(lab.source))} 的版本 · 你的班有 {(classLabs ?? []).filter(other => labSheet(other) === labSheet(lab)).length} 次</small></span><Toggle on={!choices.off?.includes(labSheet(lab))} />
                </button>)}
                {classLabs && !sheets.length && <p className="fine">你的班级不在已收到的实验表里。</p>}
                {dropped.length > 0 && <h3 className="sh gap">去掉的实验</h3>}
                {dropped.map(lab => <div key={labCourseKey(lab)} className="kv"><span className="v">{courseName(lab.course.name)}<small>整门实验</small></span><button className="ib" onClick={() => setChoice('drop', labCourseKey(lab), false)}>恢复</button></div>)}
                {skipped.length > 0 && <h3 className="sh gap">不上的几次</h3>}
                {skipped.map(lab => <div key={lab.id} className="kv"><span className="v">{courseName(lab.course.name)}<small>{dateLabel(lab.date)} {hm(minutesOf(lab.start))} · {lab.project}</small></span><button className="ib" onClick={() => setChoice('skip', lab.id, false)}>恢复</button></div>)}
            </Sheet>
        );
    }
    if (layering) return (
        <Sheet title="叠放顺序" onClose={() => setLayering(false)}>
            <p className="fine lead">同一时间有几件事时，靠前的显示在前面，后面的露出一条边，点开任何一件都能看到同时段的其他安排。这只改变显示，不会让哪件事消失。</p>
            {order.map((kind, at) => <div key={kind} className="kv"><span className="k">第 {at + 1} 层</span><span className="v">{KIND_NAMES[kind]}</span>{at > 0 && <button className="ib" onClick={() => raise(kind)}>上移</button>}</div>)}
            {prefs.layers && <button className="btn wide" onClick={() => writePreferences(current => { const { layers: _, ...rest } = current; return rest; })}>恢复默认</button>}
        </Sheet>
    );
    if (picking || !prefs.class) return <Sheet title="选择班级" onClose={() => { setPicking(false); setOpen(false); }}><ClassPicker onPicked={() => setPicking(false)} /></Sheet>;

    const edits = facts ? timetableEdits(prefs, facts.term.term) : { hidden: [], added: [] };
    const grade = facts ? gradeOf(info?.grade, facts.term) : null;
    const run = prefs.run ?? { days: [] as string[], adjust: 0 };
    const runOn = run.on ?? (grade !== null && grade <= 2);
    const setRun = (patch: Partial<typeof run>) => writePreferences(current => ({ ...current, run: { days: [], adjust: 0, ...current.run, ...patch } }));
    return (
        <Sheet title="我" onClose={() => setOpen(false)}>
            <button className="kv" onClick={() => setPicking(true)}><span className="k">班级</span><span className="v">{prefs.class}{info?.major ? ` · ${info.major}` : ''}</span><Chevron /></button>
            <div className="kv"><span className="k">改动</span><span className="v">{[`加了 ${edits.added.length} 门`, `隐藏了 ${edits.hidden.length} 门`, edits.names ? `改名 ${Object.keys(edits.names).length} 门` : ''].filter(Boolean).join('，')}</span>
                {edits.hidden.length + edits.added.length + Object.keys(edits.names ?? {}).length > 0 && facts && <button className="ib" onClick={() => updateTimetableEdits(facts.term.term, current => ({ hidden: [], added: [], ...(current.custom ? { custom: current.custom } : {}) }))}>还原</button>}</div>
            {facts && <button className="kv" onClick={() => setCoursesOpen(true)}><span className="k">自己的课</span><span className="v">{edits.custom?.length ? `${edits.custom.length} 门` : '没有'}<small>任选课、实验、整周实习，教务课表里没有的</small></span><Chevron /></button>}
            <div className="kv"><span className="k">外观</span><div className="choice">{APPEARANCES.map(([value, label]) => <button key={value} className={value === appearance ? 'on' : ''} onClick={() => { setLook(value); setAppearance(value); }}>{label}</button>)}</div></div>
            {classLabs !== null && <button className="kv" onClick={() => setLabsOpen(true)}><span className="k">实验</span><span className="v">{sheets.filter(lab => !choices.off?.includes(labSheet(lab))).length ? '已放进课表' : '没有放进课表'}<small>{[choices.drop?.length ? `去掉 ${choices.drop.length} 门` : '', choices.skip?.length ? `不上 ${choices.skip.length} 次` : ''].filter(Boolean).join('，') || '学院实验中心的上机安排'}</small></span><Chevron /></button>}
            <button className="kv" onClick={() => setLayering(true)}><span className="k">叠放</span><span className="v">{order.map(kind => KIND_NAMES[kind]).join(' › ')}<small>同一时间有几件事时谁在前面</small></span><Chevron /></button>
            <a className="kv" href="/account/"><span className="k">账号</span><span className="v">{account ? `${account.nickname} · ${labels[account.role] ?? account.role}` : '未登录'}</span><Chevron /></a>
            {facts?.run && <>
                <h3 className="sh gap">早锻炼</h3>
                <button className="kv" onClick={() => setRun({ on: !runOn })}><span className="v">显示在课表上<small>{grade !== null && grade <= 2 ? `大${'一二'[grade - 1]}必做，本学期 ${facts.run.required} 次` : '大三大四需要补跑时打开'}</small></span><Toggle on={runOn} /></button>
            </>}
            <a className="kv" href={PRODUCT_CONFIG.ANDROID_APP.DOWNLOAD_URL}><span className="v">下载 App<small>提醒和桌面小组件</small></span><Chevron /></a>
            <button className="kv" onClick={() => void share()}><span className="v">分享本站<small>{shared ? '网址已复制' : PRODUCT_CONFIG.ORIGIN.replace(/^https:\/\//, '')}</small></span><Chevron /></button>
            <a className="kv club-row" href="/club/"><span className="k">学生发展中心</span><span className="v">南邮计软网安</span><Chevron /></a>
            <p className="fine">数据版本 {DATA_RELEASE.data_version} · <a href="/terms/">用户协议</a> · <a href="/privacy/">隐私政策</a></p>
        </Sheet>
    );
}
