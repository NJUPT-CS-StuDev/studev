import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';

export const Chevron = () => <svg viewBox="0 0 16 16"><path d="m6 3.5 4.5 4.5L6 12.5" /></svg>;
export const Back = () => <svg viewBox="0 0 16 16"><path d="M10 3.5 5.5 8l4.5 4.5" /></svg>;
export const Cross = () => <svg viewBox="0 0 16 16"><path d="m4 4 8 8M12 4l-8 8" /></svg>;
export const Copy = () => <svg viewBox="0 0 20 20"><rect x="7" y="7" width="9.5" height="9.5" rx="2" /><path d="M13 7V5.5A2 2 0 0 0 11 3.5H5.5a2 2 0 0 0-2 2V11a2 2 0 0 0 2 2H7" /></svg>;
export const Tick = () => <svg viewBox="0 0 20 20"><path d="m4.5 10.5 3.5 3.5 7.5-8" /></svg>;
export const Again = () => <svg viewBox="0 0 20 20"><path d="M15.5 10a5.5 5.5 0 1 1-1.6-3.9" /><path d="M14.5 3.5v3h-3" /></svg>;
export const Pencil = () => <svg viewBox="0 0 20 20"><path d="M12.5 4.5 15.5 7.5 7.5 15.5H4.5V12.5Z" /><path d="m11 6 3 3" /></svg>;
export const Up = () => <svg viewBox="0 0 20 20"><path d="M10 15.5v-11M5.5 9 10 4.5 14.5 9" /></svg>;
export const Down = () => <svg viewBox="0 0 20 20"><path d="M10 4.5v11M5.5 11 10 15.5 14.5 11" /></svg>;
export const Square = () => <svg viewBox="0 0 20 20"><rect x="6" y="6" width="8" height="8" rx="1.5" /></svg>;
export const Compose = () => <svg viewBox="0 0 20 20"><path d="M9 4H5.5a2 2 0 0 0-2 2v8.5a2 2 0 0 0 2 2H14a2 2 0 0 0 2-2V11" /><path d="M14.5 3.5 16.5 5.5 10 12H8v-2Z" /></svg>;
export const Note = () => <svg viewBox="0 0 16 16"><path d="M3.5 4.5h9M3.5 8h9M3.5 11.5h5" /></svg>;
export const Bell = () => <svg viewBox="0 0 16 16"><path d="M4.5 11V7.5a3.5 3.5 0 0 1 7 0V11l1 1.5h-9Z" /><path d="M6.8 14h2.4" /></svg>;
export const Steps = () => <svg viewBox="0 0 16 16"><path d="m3 4.5 1.2 1.2L6.5 3.5M3 10.5l1.2 1.2 2.3-2.2M9 5h4M9 11h4" /></svg>;
export const Bars = () => <svg viewBox="0 0 20 20"><path d="M3.5 6h13M3.5 10h13M3.5 14h8" /></svg>;
export const Dots = () => <svg viewBox="0 0 20 20"><path d="M5 10h.01M10 10h.01M15 10h.01" strokeWidth="2.6" /></svg>;
export const Magnifier = () => <svg viewBox="0 0 20 20"><circle cx="9" cy="9" r="5.5" /><path d="m13.2 13.2 3.3 3.3" /></svg>;

/** A sheet from the bottom on phones, a centred card on wide screens. Back closes it. */
/** A sheet over the page. `top` sits above the title; `className` and `style` dress the sheet, as a tile's colour does. */
export function Sheet({ title, top, className, style, onClose, children }: { title?: ReactNode; top?: ReactNode; className?: string; style?: CSSProperties; onClose: () => void; children: ReactNode }) {
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
            <section className={`sheet ${className ?? ''}`} style={style} ref={panel} tabIndex={-1}>
                {top}
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
