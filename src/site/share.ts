// All visible headers open the same share action and dialog.
document.addEventListener('click', async event => {
    const target = event.target instanceof Element ? event.target.closest('button') : null;
    if (!target?.matches('[data-share-studev], [data-copy-share]')) return;
    const dialog = document.querySelector<HTMLDialogElement>('#share-studev');
    const link = dialog?.querySelector('input');
    const status = dialog?.querySelector<HTMLElement>('[data-share-status]');
    if (!dialog || !link || !status) return;

    if (target.matches('[data-copy-share]')) {
        try {
            await navigator.clipboard.writeText(link.value);
            status.textContent = '链接已复制';
        } catch {
            link.focus(); link.select();
            status.textContent = '已选中链接，可手动复制';
        }
        return;
    }

    if (navigator.share) {
        try { await navigator.share({ title: 'StuDev', url: link.value }); return; }
        catch (error) { if (error instanceof DOMException && error.name === 'AbortError') return; }
    }
    status.textContent = '';
    if (!dialog.open) dialog.showModal();
});
