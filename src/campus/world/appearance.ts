// Appearance is one choice for the whole product. "auto" lets the interface follow the
// system and the campus scene follow the sun; light and dark hold both. SiteLayout applies
// the stored choice before first paint with the same two attributes set here.
export type Appearance = 'auto' | 'light' | 'dark';
export const APPEARANCES: [Appearance, string][] = [['auto', '自动'], ['light', '浅色'], ['dark', '深色']];
const KEY = 'site-theme';

export const readAppearance = (): Appearance => {
    const value = document.documentElement.dataset.appearance;
    return value === 'light' || value === 'dark' ? value : 'auto';
};

export function setAppearance(appearance: Appearance) {
    try { if (appearance === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, appearance); } catch { /* The page still switches. */ }
    const root = document.documentElement;
    root.dataset.appearance = appearance;
    const theme = appearance === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : appearance;
    root.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute('content', meta.getAttribute(`data-${theme}`) ?? '');
    document.dispatchEvent(new CustomEvent('site:theme-change'));
}
