import { useState } from 'react';
import type { CachedAccount } from '../../platform/client/auth-status';
import { APPEARANCES, readAppearance, setAppearance, type Appearance } from '@/world/appearance';
import { DATA_RELEASE } from '@/world/config';
import { formLink, PRODUCT_CONFIG } from '@/world/product';
import { Chevron, Sheet, TextAction } from '@/world/ui';
import { usePreferences } from '@/world/usePreferences';
import '../campus.css';

type Timetable = typeof import('./TimetableSettings').default;
let timetableRequest: Promise<Timetable> | undefined;
function loadTimetable() {
    timetableRequest ??= import('./TimetableSettings').then(module => module.default).catch(error => {
        timetableRequest = undefined;
        throw error;
    });
    return timetableRequest;
}

const warmTimetable = () => { void loadTimetable().catch(() => {}); };
export default function MePanel({ account, onClose }: { account: CachedAccount | null; onClose: () => void }) {
    const [section, setSection] = useState<'home' | 'timetable' | 'about'>('home');
    const [Timetable, setTimetable] = useState<Timetable>();
    const [failed, setFailed] = useState(false);
    const { prefs } = usePreferences(true);
    const [appearance, setLook] = useState<Appearance>(() => typeof document === 'undefined' ? 'auto' : readAppearance());
    const back = () => setSection('home');

    function openTimetable() {
        setSection('timetable');
        if (Timetable) return;
        setFailed(false);
        void loadTimetable().then(
            component => setTimetable(() => component),
            () => setFailed(true),
        );
    }
    if (section === 'timetable') {
        if (Timetable) return <Timetable prefs={prefs} onBack={back} onClose={onClose} />;
        return <Sheet title="课表设置" onBack={back} onClose={onClose}>
            {failed ? <div className="empty"><p>课表设置暂时无法加载。</p><TextAction refresh onClick={openTimetable}>重试</TextAction></div>
                : <p className="empty" role="status">正在加载课表设置…</p>}
        </Sheet>;
    }
    if (section === 'about') {
        return <Sheet title="帮助与关于" onBack={back} onClose={onClose}>
            <a className="kv" href={formLink('feedback', { where: '网页 · 我' })}><span className="v">意见反馈<small>报告问题或提出建议</small></span><Chevron /></a>
            <a className="kv" href={formLink('data')}><span className="v">提供校园资料<small>实验课表、讲座、校车、营业时间等</small></span><Chevron /></a>
            <a className="kv" href={PRODUCT_CONFIG.ANDROID_APP.DOWNLOAD_URL}><span className="v">下载 App<small>提醒和桌面小组件</small></span><Chevron /></a>
            <a className="kv" href="/about/"><span className="v">关于 StuDev</span><Chevron /></a>
            <a className="kv club-row" href="/club/"><span className="k">学生发展中心</span><span className="v">南邮计软网安</span><Chevron /></a>
            <p className="fine">数据版本 {DATA_RELEASE.data_version} · <a href="/terms/">用户协议</a> · <a href="/privacy/">隐私政策</a></p>
        </Sheet>;
    }
    return <Sheet title="我" onClose={onClose}>
        <a className="kv me-account" href="/account/"><span className="v"><strong>{account?.nickname || '未登录'}</strong><small>{account ? '管理账号 · 任务和课表设置自动同步' : '登录后同步任务和课表设置'}</small></span><Chevron /></a>
        {account && <a className="kv" href="/members/"><span className="v">成员<small>{account.role === 'admin' || account.role === 'owner' ? '查看成员，管理身份与角色' : '查看大家的头像、昵称与签名'}</small></span><Chevron /></a>}
        <button className="kv" onPointerEnter={warmTimetable} onFocus={warmTimetable} onClick={openTimetable}>
            <span className="v">课表设置<small>{prefs.class || '选择班级、管理课程与实验'}</small></span><Chevron />
        </button>
        <div className="kv"><span className="v">外观</span><div className="choice">{APPEARANCES.map(([value, label]) => <button key={value} className={value === appearance ? 'on' : ''} onClick={() => { setLook(value); setAppearance(value); }}>{value === 'auto' ? '跟随系统' : label}</button>)}</div></div>
        <button className="kv" onClick={() => setSection('about')}><span className="v">帮助与关于</span><Chevron /></button>
    </Sheet>;
}
