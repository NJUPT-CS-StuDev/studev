import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function Dialog({ title, children, onClose, busy = false, wide = false }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean; wide?: boolean }) {
    const ref = useRef<HTMLDialogElement>(null);
    const titleId = useId();
    useEffect(() => {
        const node = ref.current;
        node?.showModal();
        return () => node?.close();
    }, []);
    return <dialog ref={ref} className={`cw-dialog${wide ? ' cw-dialog-wide' : ''}`} aria-labelledby={titleId} onCancel={event => {
        event.preventDefault();
        if (!busy) onClose();
    }}>
        <div className="cw-dialog-head"><h2 id={titleId}>{title}</h2><button type="button" className="cw-icon" aria-label="关闭" disabled={busy} onClick={onClose}><X size={20} /></button></div>
        {children}
    </dialog>;
}
