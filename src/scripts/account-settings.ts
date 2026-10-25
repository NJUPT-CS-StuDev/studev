// The settings tab of /account/: a visitor's class, usual campus, theme and
// timetable edits, all kept in this browser (see campus/shared/lib/preferences).
import { clearPreferences, readPreferences, subscribePreferences, writePreferences } from '../campus/shared/lib/preferences';

const form = document.querySelector<HTMLFormElement>('[data-settings-form]');
const status = document.querySelector<HTMLElement>('[data-settings-status]');
const classInput = document.querySelector<HTMLInputElement>('#settings-class');
const campusSelect = document.querySelector<HTMLSelectElement>('#settings-campus');
const editsBox = document.querySelector<HTMLElement>('[data-settings-edits]');
const editList = document.querySelector<HTMLElement>('[data-settings-edit-list]');
const THEME_KEY = 'site-theme';

const say = (text: string, kind: 'success' | 'error' | 'info' = 'success') => {
    if (!status) return;
    status.textContent = text;
    status.dataset.kind = kind;
    window.setTimeout(() => { if (status.textContent === text) status.textContent = ''; }, 3000);
};

function render() {
    const prefs = readPreferences();
    if (classInput && document.activeElement !== classInput) classInput.value = prefs.class ?? '';
    if (campusSelect) campusSelect.value = prefs.campus ?? '';
    const terms = Object.entries(prefs.timetable ?? {});
    if (editsBox && editList) {
        editsBox.hidden = !terms.length;
        editList.replaceChildren(...terms.map(([term, edits]) => {
            const item = document.createElement('li');
            const text = document.createElement('span');
            text.textContent = `${term.replace(/-(\d)$/, ' 第$1学期')}：${[edits.hidden.length ? `不上 ${edits.hidden.length} 门` : '', edits.added.length ? `自选 ${edits.added.length} 门` : ''].filter(Boolean).join('，')}`;
            const reset = document.createElement('button');
            reset.type = 'button';
            reset.className = 'p-button secondary small';
            reset.textContent = '恢复班级原课表';
            reset.addEventListener('click', () => {
                writePreferences(current => {
                    const timetable = { ...current.timetable };
                    delete timetable[term];
                    return { ...current, timetable };
                });
                say('已恢复为班级原课表。');
            });
            item.append(text, reset);
            return item;
        }));
    }
    let theme = 'system';
    try { theme = localStorage.getItem(THEME_KEY) ?? 'system'; } catch { /* Storage may be blocked. */ }
    document.querySelectorAll<HTMLInputElement>('input[name="theme"]').forEach(input => { input.checked = input.value === theme; });
}

form?.addEventListener('submit', event => {
    event.preventDefault();
    const value = classInput?.value.trim().toUpperCase() ?? '';
    if (value && !/^[A-Z]\d{6}(\([A-Z]{2}\))?$/.test(value)) {
        say('班级号的格式像 B240402。', 'error');
        classInput?.focus();
        return;
    }
    writePreferences(current => ({ ...current, class: value || undefined, campus: campusSelect?.value || undefined }));
    say('已保存。');
});

document.querySelectorAll<HTMLInputElement>('input[name="theme"]').forEach(input => input.addEventListener('change', () => {
    const system = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    const theme = input.value === 'system' ? system : input.value;
    try {
        if (input.value === 'system') localStorage.removeItem(THEME_KEY);
        else localStorage.setItem(THEME_KEY, input.value);
    } catch { /* The page still switches. */ }
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#14181d' : '#ffffff');
    document.dispatchEvent(new CustomEvent('site:theme-change', { detail: { theme } }));
}));

document.querySelector('[data-settings-clear]')?.addEventListener('click', () => {
    clearPreferences();
    try { localStorage.removeItem(THEME_KEY); } catch { /* Nothing stored. */ }
    render();
    say('本机设置已清除。');
});

// Signed-in people see where their member features are instead of the sign-in buttons.
document.addEventListener('studev:account', event => {
    const { nickname } = (event as CustomEvent<{ nickname: string }>).detail;
    const guest = document.querySelector<HTMLElement>('[data-settings-guest]');
    const member = document.querySelector<HTMLElement>('[data-settings-member]');
    const text = document.querySelector<HTMLElement>('[data-settings-member-text]');
    if (guest) guest.hidden = true;
    if (member) member.hidden = false;
    if (text) text.textContent = `已登录为 ${nickname}。`;
});

render();
subscribePreferences(render);
