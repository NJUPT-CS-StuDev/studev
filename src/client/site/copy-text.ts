document.querySelectorAll<HTMLButtonElement>('[data-copy-text], [data-copy-link]').forEach((button) => {
  const label = button.querySelector<HTMLElement>('[data-copy-label]');
  if (!label) return;
  const originalLabel = label.textContent ?? '';
  let resetLabel: ReturnType<typeof setTimeout> | undefined;
  let pending = false;

  button.addEventListener('click', async () => {
    if (pending) return;
    const value = button.dataset.copyText
      ?? document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href;
    if (!value) return;
    clearTimeout(resetLabel);
    pending = true;
    try {
      await navigator.clipboard.writeText(value);
      label.textContent = button.hasAttribute('data-copy-link') ? '链接已复制' : '已复制';
      button.parentElement?.querySelector('[data-copy-fallback]')?.remove();
    } catch {
      label.textContent = '请手动复制';
      const existing = button.parentElement?.querySelector<HTMLInputElement>('[data-copy-fallback]');
      const input = existing ?? document.createElement('input');
      input.className = 'copy-fallback';
      input.dataset.copyFallback = '';
      input.readOnly = true;
      input.value = value;
      input.setAttribute('aria-label', button.hasAttribute('data-copy-link') ? '网页链接' : 'QQ群号');
      if (!existing) button.parentElement?.append(input);
      input.focus();
      input.select();
    } finally {
      pending = false;
    }
    resetLabel = setTimeout(() => { label.textContent = originalLabel; }, 2500);
  });
});
