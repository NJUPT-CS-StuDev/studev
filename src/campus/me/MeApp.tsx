// The one place for personal settings, reached from the avatar on every page.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { avatarUrl } from '../../platform/client/api';
import { readCachedAccount, subscribeCachedAccount, type CachedAccount } from '../../platform/client/auth-status';
import { useWide } from '@/world/useUrl';
import MePanel from './MePanel';

const noSubscription = () => () => {};
const clientReady = () => true;
const serverReady = () => false;
const serverAccount = () => null;

export default function MeApp({ placement = 'site', campus = false }: { placement?: 'site' | 'page'; campus?: boolean }) {
    const wide = useWide();
    const [open, setOpen] = useState(false);
    const account = useSyncExternalStore(subscribeCachedAccount, readCachedAccount, serverAccount);
    const ready = useSyncExternalStore(noSubscription, clientReady, serverReady);
    const name = account ? account.nickname || '我' : '未登录';
    if (placement === 'page' ? wide : campus && !wide) return null;
    if (!ready) return <span className="avatar avatar-loading" role="status" aria-label="正在确认登录状态" aria-busy="true"><AccountFace account={null} /><span className="avatar-name">正在确认登录…</span></span>;
    return <>
        <button className="avatar" type="button" data-me aria-label={`${name}，打开我`} onClick={() => setOpen(true)}>
            <AccountFace account={account} /><span className="avatar-name" data-me-name>{name}</span>
        </button>
        {open && createPortal(<MePanel account={account} onClose={() => setOpen(false)} />, document.body)}
    </>;
}

function AccountFace({ account }: { account: CachedAccount | null }) {
    const picture = account ? avatarUrl(account, 100) : '';
    const [loaded, setLoaded] = useState('');
    const [failed, setFailed] = useState('');
    useEffect(() => {
        if (!picture || failed !== picture) return;
        const retry = () => { if (document.visibilityState === 'visible') setFailed(''); };
        window.addEventListener('online', retry);
        document.addEventListener('visibilitychange', retry);
        return () => { window.removeEventListener('online', retry); document.removeEventListener('visibilitychange', retry); };
    }, [failed, picture]);
    return <span className="avatar-face" data-me-face>
        {account ? <span aria-hidden="true">{[...(account.nickname?.trim() || '我')][0]}</span>
            : <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="3.6" /><path d="M5 20c.8-3.8 3.6-5.8 7-5.8s6.2 2 7 5.8" /></svg>}
        {picture && failed !== picture && <img key={picture} src={picture} alt="" referrerPolicy="no-referrer" decoding="async"
            data-loaded={loaded === picture ? '' : undefined} onLoad={() => setLoaded(picture)} onError={() => setFailed(picture)} />}
    </span>;
}
