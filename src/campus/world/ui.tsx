import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from 'react';
import MeApp from '../me/MeApp';
import tokens from '../../../design/tokens.json';

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
export function TextAction({ children, onClick, refresh = false, disabled = false, muted = false }: { children: ReactNode; onClick: () => void; refresh?: boolean; disabled?: boolean; muted?: boolean }) {
    return <button type="button" className={`text-action${muted ? ' subtle' : ''}`} onClick={onClick} disabled={disabled}>{refresh && <Again />}{children}</button>;
}
export const Dots = () => <svg viewBox="0 0 20 20"><path d="M5 10h.01M10 10h.01M15 10h.01" strokeWidth="2.6" /></svg>;
export const Magnifier = () => <svg viewBox="0 0 20 20"><circle cx="9" cy="9" r="5.5" /><path d="m13.2 13.2 3.3 3.3" /></svg>;

/** The first row of a campus entry shares one account-aligned baseline on narrow screens. */
export function CampusHeader({ children, className = '' }: { children: ReactNode; className?: string }) {
    return <div className={`campus-header ${className}`}><div className="campus-header-main">{children}</div><span className="campus-account-slot">
        <button className="site-share-entry" type="button" data-share-studev aria-label="分享 StuDev"><svg viewBox="0 0 24 24" aria-hidden="true"><path d={tokens.glyph.share} /></svg></button>
        <MeApp placement="page" />
    </span></div>;
}

interface SheetOwner { close: () => void; leaving: boolean }
const sheetOwners: SheetOwner[] = [];
let sheetEntry: { id: number; page: string } | null = null;
let sheetSequence = 0;
let sheetCleanup = 0;
let pendingSheetNavigation: { kind: 'dismiss' | 'release'; owner: SheetOwner } | null = null;
let sheetListening = false;
let sheetOpener: HTMLElement | null = null;

/** Replacing one panel with another keeps one overlay entry; only leaving the last owner traverses back. */
function ensureSheetEntry() {
    if (!sheetOwners.length || sheetOwners.at(-1)?.leaving || pendingSheetNavigation || (sheetEntry !== null && history.state?.sheet === sheetEntry.id)) return;
    const { sheet: _, ...state } = history.state ?? {};
    if (history.state?.sheet !== undefined) history.replaceState(state, '', location.href);
    sheetEntry = { id: ++sheetSequence, page: location.href };
    history.pushState({ ...state, sheet: sheetEntry.id }, '', sheetEntry.page);
}

function consumeSheetEntry() {
    if (sheetEntry === null || history.state?.sheet !== sheetEntry.id || pendingSheetNavigation) return false;
    sheetEntry = null;
    for (const owner of sheetOwners) owner.leaving = true;
    return true;
}

/** A real page reached from a panel takes that panel's slot, retaining the page behind it as Back's destination. */
export function replaceSheetRoute(url: string) {
    if (!consumeSheetEntry()) return false;
    history.replaceState(null, '', url);
    return true;
}

function finishSheetListeners() {
    if (sheetOwners.length || pendingSheetNavigation || sheetEntry !== null) return;
    removeEventListener('studev:before-popstate', sheetPopped);
    removeEventListener('keydown', sheetKey);
    sheetListening = false;
    if (sheetOpener?.isConnected) sheetOpener.focus();
    sheetOpener = null;
}

function sheetPopped(event: Event) {
    const pending = pendingSheetNavigation;
    const state = (event as PopStateEvent).state;
    if (!pending && (sheetEntry === null || state?.sheet === sheetEntry.id)) return;
    // Traversing the sheet's own entry stays on its page. Letting the site router handle it would
    // swap out the page and unmount the parent sheet just after the child has been closed.
    if (sheetEntry?.page === location.href) event.preventDefault();
    pendingSheetNavigation = null;
    sheetEntry = null;
    if (pending) {
        // A traversal already sent by an old owner cannot close a newly mounted panel.
        if (pending.kind === 'dismiss' && sheetOwners.includes(pending.owner)) pending.owner.close();
        else ensureSheetEntry();
    } else sheetOwners.at(-1)?.close();
    finishSheetListeners();
}

function sheetKey(event: KeyboardEvent) {
    if (event.key !== 'Escape' || !sheetOwners.length) return;
    event.preventDefault();
    if (pendingSheetNavigation) return;
    const owner = sheetOwners.at(-1)!;
    if (sheetEntry !== null && history.state?.sheet === sheetEntry.id) {
        pendingSheetNavigation = { kind: 'dismiss', owner };
        history.back();
    } else owner.close();
}

/** A sheet from the bottom on phones, a centred card on wide screens. Back closes it. */
/** A sheet over the page. `top` sits above the title; `className` and `style` dress the sheet, as a tile's colour does. */
export function Sheet({ title, top, className, style, onClose, onBack, children }: { title?: ReactNode; top?: ReactNode; className?: string; style?: CSSProperties; onClose: () => void; onBack?: () => void; children: ReactNode }) {
    const titleId = useId();
    const closing = useRef(onClose);
    closing.current = onClose;
    const panel = useRef<HTMLElement>(null);
    const owner = useRef<SheetOwner | null>(null);
    useEffect(() => {
        sheetCleanup++;
        sheetOpener ??= document.activeElement as HTMLElement | null;
        const current: SheetOwner = { close: () => closing.current(), leaving: false };
        owner.current = current;
        sheetOwners.push(current);
        if (!sheetListening) {
            addEventListener('studev:before-popstate', sheetPopped);
            addEventListener('keydown', sheetKey);
            sheetListening = true;
        }
        ensureSheetEntry();
        panel.current?.focus();
        return () => {
            sheetOwners.splice(sheetOwners.indexOf(current), 1);
            owner.current = null;
            const cleanup = ++sheetCleanup;
            // React cleans up the outgoing panel before mounting its replacement in the same commit.
            queueMicrotask(() => {
                if (cleanup !== sheetCleanup) return;
                if (sheetOwners.length) ensureSheetEntry();
                else if (sheetEntry !== null && history.state?.sheet === sheetEntry.id && !pendingSheetNavigation) {
                    pendingSheetNavigation = { kind: 'release', owner: current };
                    history.back();
                } else if (!pendingSheetNavigation) sheetEntry = null;
                finishSheetListeners();
            });
        };
    }, []);
    // A Back or Escape may move from a detail to its list without unmounting this Sheet.
    useEffect(() => { if (owner.current === sheetOwners.at(-1)) ensureSheetEntry(); });
    return (
        <div className="sd sheet-wrap" role="dialog" aria-modal="true" aria-labelledby={title ? titleId : undefined}>
            <button className="scrim" aria-label="关闭" onClick={onClose} />
            <section className={`sheet ${className ?? ''}`} style={style} ref={panel} tabIndex={-1} onClick={event => {
                const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
                if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || !link || link.download || (link.target && link.target !== '_self') || !/^https?:$/.test(new URL(link.href).protocol)) return;
                if (consumeSheetEntry()) { event.preventDefault(); location.replace(link.href); }
            }}>
                {top}
                <div className={`card-h${onBack ? ' has-back' : ''}`}>{onBack && <button className="sheet-back" type="button" aria-label="返回" onClick={onBack}><Back /></button>}
                    <h2 id={titleId}>{title}</h2><button className="x" aria-label="关闭" onClick={onClose}><Cross /></button></div>
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
