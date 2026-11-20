import { readAppearance, setAppearance, type Appearance } from '../campus/world/appearance';

// The header's one-tap appearance: 跟随系统 → 浅色 → 深色, the same choice 我 › 外观 keeps.
const next: Record<Appearance, Appearance> = { auto: 'light', light: 'dark', dark: 'auto' };
const names: Record<Appearance, string> = { auto: '跟随系统', light: '浅色', dark: '深色' };
const button = () => document.querySelector<HTMLButtonElement>('[data-theme-toggle]');
function label() {
    const now = readAppearance();
    const button_ = button();
    if (!button_) return;
    button_.title = `外观：${names[now]}（点按切换到${names[next[now]]}）`;
    button_.setAttribute('aria-label', button_.title);
}
// One listener on the document: the header is replaced when an app page swaps in.
document.addEventListener('click', event => {
    if (!(event.target instanceof Element) || !event.target.closest('[data-theme-toggle]')) return;
    setAppearance(next[readAppearance()]); label();
});
document.addEventListener('astro:after-swap', label);
document.addEventListener('site:theme-change', label);
label();

// An app page swapping in brings its own <html>: carry over what this page has learned about itself (appearance,
// sign-in, the AI's state), which the first load set by script and the new markup does not have.
document.addEventListener('astro:before-swap', event => {
    const { newDocument } = event as Event & { newDocument: Document };
    const from = document.documentElement, to = newDocument.documentElement;
    for (const name of from.getAttributeNames()) if (name.startsWith('data-')) to.setAttribute(name, from.getAttribute(name) ?? '');
});
