import { useEffect, useRef, type ReactNode } from 'react';

export const Chevron = () => <svg viewBox="0 0 16 16"><path d="m6 3.5 4.5 4.5L6 12.5" /></svg>;
export const Back = () => <svg viewBox="0 0 16 16"><path d="M10 3.5 5.5 8l4.5 4.5" /></svg>;
export const Cross = () => <svg viewBox="0 0 16 16"><path d="m4 4 8 8M12 4l-8 8" /></svg>;
export const Magnifier = () => <svg viewBox="0 0 20 20"><circle cx="9" cy="9" r="5.5" /><path d="m13.2 13.2 3.3 3.3" /></svg>;

/** A sheet from the bottom on phones, a centred card on wide screens. Back closes it. */
export function Sheet({ title, onClose, children }: { title?: ReactNode; onClose: () => void; children: ReactNode }) {
    const closing = useRef(onClose);
    closing.current = onClose;
    const panel = useRef<HTMLElement>(null);
    useEffect(() => {
        const opener = document.activeElement as HTMLElement | null;
        history.pushState({ ...history.state, sheet: true }, '', location.href);
        const pop = () => closing.current();
        const key = (event: KeyboardEvent) => { if (event.key === 'Escape') history.back(); };
        addEventListener('popstate', pop);
        addEventListener('keydown', key);
        panel.current?.focus();
        return () => {
            removeEventListener('popstate', pop);
            removeEventListener('keydown', key);
            if (history.state?.sheet) history.back();
            opener?.focus?.();
        };
    }, []);
    return (
        <div className="sd sheet-wrap" role="dialog" aria-modal="true">
            <button className="scrim" aria-label="关闭" onClick={onClose} />
            <section className="sheet" ref={panel} tabIndex={-1}>
                <div className="card-h"><h2>{title}</h2><button className="x" aria-label="关闭" onClick={onClose}><Cross /></button></div>
                {children}
            </section>
        </div>
    );
}

export function Toggle({ on }: { on: boolean }) { return <span className={`toggle ${on ? 'on' : ''}`} />; }

/** Which half-days of the week a list of lessons falls on: enough to recognise a timetable. */
export function WeekGlyph({ slots }: { slots: { weekday: number; period: number }[] }) {
    const on = new Set(slots.filter(slot => slot.weekday <= 5).map(slot => (slot.period <= 5 ? 0 : slot.period <= 9 ? 1 : 2) * 5 + slot.weekday - 1));
    return <span className="glyph" aria-hidden="true">{Array.from({ length: 15 }, (_, index) => <i key={index} className={on.has(index) ? 'b' : ''} />)}</span>;
}
