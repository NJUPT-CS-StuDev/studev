const form = document.querySelector<HTMLFormElement>('[data-header-search-form]');
const input = document.querySelector<HTMLInputElement>('[data-header-search-input]');
const clearBtn = document.querySelector<HTMLButtonElement>('[data-header-search-clear]');

if (form && input) {
  const updateClearVisibility = () => {
    if (clearBtn) {
      clearBtn.hidden = !input.value;
    }
  };

  input.addEventListener('input', updateClearVisibility);

  clearBtn?.addEventListener('click', (event) => {
    if (document.documentElement.dataset.searchRoute) return;
    event.preventDefault();
    input.value = '';
    updateClearVisibility();
    input.focus();
  });

  form.addEventListener('submit', (event) => {
    if (document.documentElement.dataset.searchRoute) {
      return;
    }
    const q = input.value.trim();
    if (!q) {
      event.preventDefault();
      window.location.href = '/search/';
    }
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const active = document.activeElement as HTMLElement | null;
      const tag = active?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || active?.isContentEditable) {
        return;
      }
      if (document.documentElement.dataset.searchRoute === 'home') {
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
