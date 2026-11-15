import { writePreferences } from './preferences';
// Appearance is one choice for the whole product. "auto" lets the interface follow the
// system and the campus scene follow the sun; light and dark hold both. It is one of the parts
// of oneself (preferences.ts), going with one to one's other devices; SiteLayout applies it
// before first paint with the same two attributes set here.
export type Appearance = 'auto' | 'light' | 'dark';
export const APPEARANCES: [Appearance, string][] = [['auto', '自动'], ['light', '浅色'], ['dark', '深色']];

export const readAppearance = (): Appearance => {
    const value = document.documentElement.dataset.appearance;
    return value === 'light' || value === 'dark' ? value : 'auto';
};

export function setAppearance(appearance: Appearance) {
    writePreferences(current => { const { appearance: _, ...rest } = current; return appearance === 'auto' ? rest : { ...rest, appearance }; });
    show(appearance);
}

/** Shows an appearance without keeping it: as chosen here, or as taken from another device. */
export function show(appearance: Appearance) {
    const root = document.documentElement;
    root.dataset.appearance = appearance;
    const theme = appearance === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : appearance;
    root.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute('content', meta.getAttribute(`data-${theme}`) ?? '');
    document.dispatchEvent(new CustomEvent('site:theme-change'));
}
