// The one place for personal settings, reached from the avatar on every page.
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { avatarUrl } from '../../platform/client/api';
import { readCachedAccount, subscribeCachedAccount, type CachedAccount } from '../../platform/client/auth-status';
import { DATA_RELEASE } from '@/world/config';
import { formLink, PRODUCT_CONFIG } from '@/world/product';
import { writePreferences } from '@/world/preferences';
import { usePreferences } from '@/world/usePreferences';
import { ClassPicker } from '@/timetable/ClassPicker';
import { CourseManager } from '@/timetable/CourseManager';
import { loadClasses, loadClassLabs, loadLabs, loadPeriods, loadRuns, loadTerm, type MorningRun } from '@/world/data';
import { labCourseKey, labSheet, personalLabs } from '@/timetable/model/labs';
import { publishedOn } from '@/world/exams';
import { courseName } from '@/world/names';
import { dateLabel, hm, minutesOf } from '@/world/time';
import { gradeOf, LAYER_ORDER, type EventKind } from '@/world/events';
import { Chevron, Sheet, Toggle, TextAction } from '@/world/ui';
import type { Lab, TeachingClass, TeachingPeriod, TeachingTerm } from '@/world/facts';
import { APPEARANCES, readAppearance, setAppearance, type Appearance } from '@/world/appearance';
import { useWide } from '@/world/useUrl';
import ModelSettings from '@/ai/ModelSettings';
import '../campus.css';

const noSubscription = () => () => {};
const clientReady = () => true;
const serverReady = () => false;
const serverAccount = () => null;

export default function MeApp({ placement = 'site', campus = false }: { placement?: 'site' | 'page'; campus?: boolean }) {
    const wide = useWide();
    const [open, setOpen] = useState(false);
    const account = useSyncExternalStore(subscribeCachedAccount, readCachedAccount, serverAccount);
    const ready = useSyncExternalStore(noSubscription, clientReady, serverReady);
    const name = account?.nickname || '未登录';
    if (placement === 'page' ? wide : campus && !wide) return null;
    if (!ready) return <span className="avatar avatar-loading" role="status" aria-label="正在加载个人菜单" aria-busy="true"><AccountFace account={null} /><span className="avatar-name">加载中</span></span>;
    return <>
        <button className="avatar" type="button" data-me aria-label={`${name}，打开我`} onClick={() => setOpen(true)}>
            <AccountFace account={account} /><span className="avatar-name" data-me-name>{name}</span>
        </button>
        {open && createPortal(<MePanel account={account} onClose={() => setOpen(false)} />, document.body)}
    </>;
}

function AccountFace({ account }: { account: CachedAccount | null }) {
    const picture = account ? avatarUrl(account, 100) : '';
    const [failed, setFailed] = useState('');
    useEffect(() => setFailed(''), [picture]);
    return <span className="avatar-face" data-me-face>
        {picture && failed !== picture ? <img src={picture} alt="" referrerPolicy="no-referrer" onError={() => setFailed(picture)} />
            : account ? account.nickname?.slice(0, 1) || '我'
            : <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="3.6" /><path d="M5 20c.8-3.8 3.6-5.8 7-5.8s6.2 2 7 5.8" /></svg>}
    </span>;
}

function MePanel({ account, onClose }: { account: CachedAccount | null; onClose: () => void }) {
    const [section, setSection] = useState<'home' | 'timetable' | 'models' | 'about'>('home');
    const [factsError, setFactsError] = useState(false);
    const [retry, setRetry] = useState(0);
    const { prefs } = usePreferences(true);
    const [appearance, setLook] = useState<Appearance>(() => typeof document === 'undefined' ? 'auto' : readAppearance());
    const [picking, setPicking] = useState(false);
    const [layering, setLayering] = useState(false);
    const [classLabs, setClassLabs] = useState<Lab[] | null>(null);
    const [labsError, setLabsError] = useState(false);
    const [labsOpen, setLabsOpen] = useState(false);
    const [extraClass, setExtraClass] = useState('');
    const [coursesOpen, setCoursesOpen] = useState(false);
    const [periods, setPeriods] = useState<TeachingPeriod[]>([]);
    useEffect(() => { let live = true; setClassLabs(null); setLabsError(false); if (prefs.class) void Promise.all([loadClassLabs(prefs.class), prefs.labs?.classes?.length ? loadLabs() : Promise.resolve([] as Lab[])]).then(([own, all]) => { if (live) setClassLabs(personalLabs(own, prefs.labs?.classes ?? [], all)); }).catch(() => { if (live) setLabsError(true); }); return () => { live = false; }; }, [prefs.class, prefs.labs?.classes, retry]);
    const [facts, setFacts] = useState<{ term: TeachingTerm; classes: TeachingClass[]; run: MorningRun | null } | null>(null);
    useEffect(() => {
        if (facts) return;
        let live = true; setFactsError(false);
        void Promise.all([loadTerm(), loadClasses(), loadRuns(), loadPeriods()]).then(([term, classes, runs, times]) => { if (live) { setFacts({ term, classes, run: runs[term.term] ?? null }); setPeriods(times); } }, () => { if (live) setFactsError(true); });
        return () => { live = false; };
    }, [facts, retry]);
    const info = useMemo(() => facts?.classes.find(item => item.name === prefs.class) ?? null, [facts, prefs.class]);
    const [shared, setShared] = useState(false);
    const share = async () => {
        const url = `${PRODUCT_CONFIG.ORIGIN}/`;
        if (navigator.share) { await navigator.share({ title: 'StuDev', url }).catch(() => undefined); return; }
        await navigator.clipboard.writeText(url);
        setShared(true);
    };
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
    if (coursesOpen && facts && !labsOpen) return <CourseManager term={facts.term} periods={periods} prefs={prefs} labs={classLabs ?? []} onLabs={() => setLabsOpen(true)} onClose={() => setCoursesOpen(false)} />;
    if (labsOpen) {
        const dropped = [...new Map((classLabs ?? []).filter(lab => choices.drop?.includes(labCourseKey(lab))).map(lab => [labCourseKey(lab), lab])).values()];
        const skipped = (classLabs ?? []).filter(lab => choices.skip?.includes(lab.id));
        return (
            <Sheet title="实验安排" onClose={() => setLabsOpen(false)}>
                <p className="fine lead">选择参加的实验。隐藏理论课不会取消实验。</p>
                {labsError && <div className="empty"><p>实验安排暂时无法加载</p><TextAction refresh onClick={() => setRetry(value => value + 1)}>重试</TextAction></div>}
                <h3 className="sh gap">其他班级的实验</h3>
                {(choices.classes ?? []).map(name => <div className="kv" key={name}><span className="v">{name}</span><button className="ib" onClick={() => setChoice('classes', name, false)}>移除</button></div>)}
                <div className="trow"><input className="tf" aria-label="实验班级" placeholder="如 B240402" value={extraClass} onChange={event => setExtraClass(event.target.value.toUpperCase())} /><button className="btn" disabled={!/^[A-Z]\d{6}(\([A-Z]{2}\))?$/.test(extraClass.trim())} onClick={() => { setChoice('classes', extraClass.trim(), true); setExtraClass(''); }}>添加</button></div>
                {sheets.map(lab => <button key={labSheet(lab)} className="kv" onClick={() => setChoice('off', labSheet(lab), !choices.off?.includes(labSheet(lab)))}>
                    <span className="v">{labSheet(lab)}<small>{dateLabel(publishedOn(lab.source))} 的版本 · 你的班有 {(classLabs ?? []).filter(other => labSheet(other) === labSheet(lab)).length} 次</small></span><Toggle on={!choices.off?.includes(labSheet(lab))} />
                </button>)}
                {classLabs && !sheets.length && <p className="fine">你的班级不在已收到的实验表里。</p>}
                <a className="kv" href={formLink('data')}><span className="v">提供实验课表</span><Chevron /></a>
                {dropped.length > 0 && <h3 className="sh gap">去掉的实验</h3>}
                {dropped.map(lab => <div key={labCourseKey(lab)} className="kv"><span className="v">{courseName(lab.course.name)}<small>整门实验</small></span><button className="ib" onClick={() => setChoice('drop', labCourseKey(lab), false)}>恢复</button></div>)}
                {skipped.length > 0 && <h3 className="sh gap">不上的几次</h3>}
                {skipped.map(lab => <div key={lab.id} className="kv"><span className="v">{courseName(lab.course.name)}<small>{dateLabel(lab.date)} {hm(minutesOf(lab.start))} · {lab.project}</small></span><button className="ib" onClick={() => setChoice('skip', lab.id, false)}>恢复</button></div>)}
                {classLabs && classLabs.length > 0 && <h3 className="sh gap">全部实验</h3>}
                {[...new Map((classLabs ?? []).map(lab => [labCourseKey(lab), lab])).values()].map(course => <details className="kv together" key={labCourseKey(course)}><summary><span className="v">{courseName(course.course.name)}<small>{(classLabs ?? []).filter(lab => labCourseKey(lab) === labCourseKey(course)).length} 次</small></span><Chevron /></summary>
                    <button className="kv" onClick={() => setChoice('drop', labCourseKey(course), !choices.drop?.includes(labCourseKey(course)))}><span className="v">参加这门实验</span><Toggle on={!choices.drop?.includes(labCourseKey(course))} /></button>
                    {(classLabs ?? []).filter(lab => labCourseKey(lab) === labCourseKey(course)).map(lab => <div className="kv" key={lab.id}><span className="v">{lab.project}<small>{dateLabel(lab.date)} {lab.start}–{lab.end} · {lab.place}</small><small>{lab.teachers.join('、')}</small></span><button className="ib" disabled={choices.off?.includes(labSheet(lab)) || choices.drop?.includes(labCourseKey(lab))} onClick={() => setChoice('skip', lab.id, !choices.skip?.includes(lab.id))}>{choices.skip?.includes(lab.id) ? '恢复' : '不参加'}</button></div>)}
                </details>)}
            </Sheet>
        );
    }
    if (layering) return (
        <Sheet title="冲突时的显示顺序" onClose={() => setLayering(false)}>
            <p className="fine lead">同时段的安排按此顺序显示，点开可查看全部。</p>
            {order.map((kind, at) => <div key={kind} className="kv"><span className="k">第 {at + 1} 层</span><span className="v">{KIND_NAMES[kind]}</span>{at > 0 && <button className="ib" onClick={() => raise(kind)}>上移</button>}</div>)}
            {prefs.layers && <button className="btn wide" onClick={() => writePreferences(current => { const { layers: _, ...rest } = current; return rest; })}>恢复默认</button>}
        </Sheet>
    );
    if (picking) return <Sheet title="选择班级" onClose={() => setPicking(false)}><ClassPicker onPicked={() => setPicking(false)} /></Sheet>;

    const grade = facts ? gradeOf(info?.grade, facts.term) : null;
    const run = prefs.run ?? { days: [] as string[], adjust: 0 };
    const runOn = run.on ?? (grade !== null && grade <= 2);
    const setRun = (patch: Partial<typeof run>) => writePreferences(current => ({ ...current, run: { days: [], adjust: 0, ...current.run, ...patch } }));
    return (
        <Sheet title={section === 'timetable' ? '课表设置' : section === 'models' ? '模型服务' : section === 'about' ? '帮助与关于' : '我'} top={section !== 'home' ? <button className="back" onClick={() => setSection('home')}>‹ 返回</button> : undefined} onClose={onClose}>
            {section === 'home' && <>
            <a className="kv me-account" href="/account/"><span className="v"><strong>{account?.nickname || '未登录'}</strong><small>{account ? '管理账号 · 任务和课表设置自动同步' : '登录后同步任务和课表设置'}</small></span><Chevron /></a>
            {account && <a className="kv" href="/members/"><span className="v">成员<small>查看头像、昵称与签名</small></span><Chevron /></a>}
            <button className="kv" onClick={() => setSection('timetable')}><span className="v">课表设置<small>{[prefs.class, info?.major].filter(Boolean).join(' · ') || '选择班级、管理课程与实验'}</small></span><Chevron /></button>
            <button className="kv" onClick={() => setSection('models')}><span className="v">模型服务<small>管理服务商和启用的模型</small></span><Chevron /></button>
            <div className="kv"><span className="v">外观</span><div className="choice">{APPEARANCES.map(([value, label]) => <button key={value} className={value === appearance ? 'on' : ''} onClick={() => { setLook(value); setAppearance(value); }}>{value === 'auto' ? '跟随系统' : label}</button>)}</div></div>
            <button className="kv" onClick={() => setSection('about')}><span className="v">帮助与关于</span><Chevron /></button>
            </>}
            {section === 'timetable' && <>
            <button className="kv" onClick={() => setPicking(true)}><span className="k">班级</span><span className="v">{prefs.class || '选择班级'}{info?.major ? ` · ${info.major}` : ''}</span><Chevron /></button>
            {facts && <><p className="fine">{facts.term.year}–{facts.term.year + 1} 学年第{facts.term.number === 1 ? '一' : '二'}学期</p><button className="kv" onClick={() => setCoursesOpen(true)}><span className="v">我的课程<small>查看详情、增删课程和修改安排</small></span><Chevron /></button></>}
            {factsError && <div className="empty"><p>课表设置暂时无法加载</p><TextAction refresh onClick={() => setRetry(value => value + 1)}>重试</TextAction></div>}
            <button className="kv" onClick={() => setLabsOpen(true)}><span className="v">实验安排</span><Chevron /></button>
            {facts?.run && <>
                <h3 className="sh gap">早锻炼</h3>
                <button className="kv" onClick={() => setRun({ on: !runOn })}><span className="v">显示早锻炼<small>{grade !== null && grade <= 2 ? `本学期需完成 ${facts.run.required} 次` : '需要补跑时开启'}</small></span><Toggle on={runOn} /></button>
            </>}
            <button className="kv" onClick={() => setLayering(true)}><span className="v">冲突时的显示顺序</span><Chevron /></button>
            </>}
            {section === 'models' && <ModelSettings />}
            {section === 'about' && <>
            <a className="kv" href={formLink('feedback', { where: '网页 · 我' })}><span className="v">意见反馈</span><Chevron /></a>
            <a className="kv" href={formLink('data')}><span className="v">提供校园资料<small>实验课表、讲座、校车、营业时间等</small></span><Chevron /></a>
            <a className="kv" href={PRODUCT_CONFIG.ANDROID_APP.DOWNLOAD_URL}><span className="v">下载 App<small>提醒和桌面小组件</small></span><Chevron /></a>
            <button className="kv" onClick={() => void share()}><span className="v">分享本站<small>{shared ? '网址已复制' : PRODUCT_CONFIG.ORIGIN.replace(/^https:\/\//, '')}</small></span><Chevron /></button>
            <a className="kv club-row" href="/club/"><span className="k">学生发展中心</span><span className="v">南邮计软网安</span><Chevron /></a>
            <p className="fine">数据版本 {DATA_RELEASE.data_version} · <a href="/terms/">用户协议</a> · <a href="/privacy/">隐私政策</a></p>
            </>}
        </Sheet>
    );
}
