const form = document.querySelector<HTMLFormElement>('[data-header-search-form]');
const input = document.querySelector<HTMLInputElement>('[data-header-search-input]');

if (form && input) {
  const syncFromLocation = () => {
    if (window.location.pathname.startsWith('/search')) {
      const params = new URLSearchParams(window.location.search);
      input.value = params.get('q') || params.get('class') || '';
    }
  };
  syncFromLocation();
  window.addEventListener('popstate', syncFromLocation);

  form.addEventListener('submit', (event) => {
    const q = input.value.trim();
    if (!q) {
      event.preventDefault();
      window.location.href = '/search/';
      return;
    }
    if (window.location.pathname.startsWith('/search')) {
      event.preventDefault();
      const target = `/search/?q=${encodeURIComponent(q)}`;
      window.history.pushState(null, '', target);
      window.dispatchEvent(new PopStateEvent('popstate'));
      input.blur();
    }
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const active = document.activeElement as HTMLElement | null;
      const tag = active?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || active?.isContentEditable) {
        return;
      }
      event.preventDefault();
      input.focus();
      input.select();
    } else if (event.key === 'Escape' && document.activeElement === input) {
      input.blur();
    }
  });
}
