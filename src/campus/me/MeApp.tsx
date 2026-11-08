// The one place for personal settings, reached from the avatar on every page.
import { useEffect, useMemo, useState } from 'react';
import { DATA_RELEASE } from '@/world/config';
import { PRODUCT_CONFIG } from '@/world/product';
import { timetableEdits, updateTimetableEdits, writePreferences } from '@/world/preferences';
import { usePreferences } from '@/world/usePreferences';
import { ClassPicker } from '@/timetable/ClassPicker';
import { loadClasses, loadRuns, loadTerm, type MorningRun } from '@/world/data';
import { gradeOf } from '@/world/events';
import { Chevron, Sheet, Toggle } from '@/world/ui';
import type { TeachingClass, TeachingTerm } from '@/world/facts';
import { APPEARANCES, readAppearance, setAppearance, type Appearance } from '@/world/appearance';
import { labels } from '../../platform/client/api';
import '../campus.css';

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
    const [shared, setShared] = useState(false);
    // Who is signed in, as the account pages keep it in this browser.
    const account = useMemo(() => {
        try { return JSON.parse(localStorage.getItem('studev_auth_user') ?? 'null') as { nickname: string; role: string } | null; } catch { return null; }
    }, [open]);
    const share = async () => {
        const url = `${PRODUCT_CONFIG.ORIGIN}/`;
        if (navigator.share) { await navigator.share({ title: 'studev', url }).catch(() => undefined); return; }
        await navigator.clipboard.writeText(url);
        setShared(true);
    };
    if (!open) return null;
    if (picking || !prefs.class) return <Sheet title="选择班级" onClose={() => { setPicking(false); setOpen(false); }}><ClassPicker onPicked={() => setPicking(false)} /></Sheet>;

    const edits = facts ? timetableEdits(prefs, facts.term.term) : { hidden: [], added: [] };
    const grade = facts ? gradeOf(info?.grade, facts.term) : null;
    const run = prefs.run ?? { days: [] as string[], adjust: 0 };
    const runOn = run.on ?? (grade !== null && grade <= 2);
    const setRun = (patch: Partial<typeof run>) => writePreferences(current => ({ ...current, run: { days: [], adjust: 0, ...current.run, ...patch } }));
    return (
        <Sheet title="我" onClose={() => setOpen(false)}>
            <button className="kv" onClick={() => setPicking(true)}><span className="k">班级</span><span className="v">{prefs.class}{info?.major ? ` · ${info.major}` : ''}</span><Chevron /></button>
            <div className="kv"><span className="k">改动</span><span className="v">加了 {edits.added.length} 门，隐藏了 {edits.hidden.length} 门</span>
                {edits.hidden.length + edits.added.length > 0 && facts && <button className="ib" onClick={() => updateTimetableEdits(facts.term.term, () => ({ hidden: [], added: [] }))}>还原</button>}</div>
            <div className="kv"><span className="k">外观</span><div className="choice">{APPEARANCES.map(([value, label]) => <button key={value} className={value === appearance ? 'on' : ''} onClick={() => { setLook(value); setAppearance(value); }}>{label}</button>)}</div></div>
            <a className="kv" href="/account/"><span className="k">账号</span><span className="v">{account ? `${account.nickname} · ${labels[account.role] ?? account.role}` : '未登录'}</span><Chevron /></a>
            {facts?.run && <>
                <h3 className="sh gap">早锻炼</h3>
                <button className="kv" onClick={() => setRun({ on: !runOn })}><span className="v">显示在课表上<small>{grade !== null && grade <= 2 ? `大${'一二'[grade - 1]}必做，本学期 ${facts.run.required} 次` : '大三大四需要补跑时打开'}</small></span><Toggle on={runOn} /></button>
            </>}
            <a className="kv" href={PRODUCT_CONFIG.ANDROID_APP.DOWNLOAD_URL}><span className="v">下载 App<small>提醒和桌面小组件</small></span><Chevron /></a>
            <button className="kv" onClick={() => void share()}><span className="v">分享本站<small>{shared ? '网址已复制' : PRODUCT_CONFIG.ORIGIN.replace(/^https:\/\//, '')}</small></span><Chevron /></button>
            <a className="kv club-row" href="/club/"><span className="k">社团</span><span className="v">南邮计软网安学生发展中心</span><Chevron /></a>
            <p className="fine">数据版本 {DATA_RELEASE.data_version} · <a href="/terms/">用户协议</a> · <a href="/privacy/">隐私政策</a></p>
        </Sheet>
    );
}
