const root = document.querySelector<HTMLElement>('[data-legacy-collection]');
if (root) {
    const status = root.querySelector<HTMLElement>('[data-legacy-status]')!;
    const container = root.querySelector<HTMLElement>('[data-legacy-items]')!;
    const api = '/api/platform';
    let csrf = '';
    async function request(path: string, post = false) {
        const result = await fetch(api + path, { method: post ? 'POST' : 'GET', credentials: 'same-origin', headers: post ? { 'X-CSRF-Token': csrf } : {}, cache: 'no-store' });
        const body = await result.json();
        if (!result.ok) {
            if (result.status === 401)
                location.assign('/login/?next=%2Flegacy-collection%2F');
            throw new Error(body.error?.message || '暂时无法读取历史记录。');
        }
        return body;
    }
    void (async () => {
        try {
            const session = await request('/auth/session');
            csrf = session.csrfToken;
            if (!['owner', 'admin'].includes(session.user?.role) || !session.mfaVerified) {
                location.assign('/account/');
                return;
            }
            const { items } = await request('/admin/legacy/submissions');
            status.textContent = `共 ${items.length} 条历史记录。`;
            root.querySelector<HTMLElement>('[data-legacy-list]')!.hidden = false;
            for (const item of items) {
                const article = document.createElement('article');
                article.className = 'collection-card';
                const title = document.createElement('h3');
                title.textContent = item.fileName;
                const summary = document.createElement('p');
                summary.textContent = `${item.name} · ${item.fileSize} B · ${new Date(item.createdAt).toLocaleString('zh-CN')}`;
                const description = document.createElement('p');
                description.textContent = item.description || '未填写说明';
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'collection-button';
                button.textContent = item.completed ? '下载原始文件' : '尚未完成上传';
                button.disabled = !item.completed;
                button.addEventListener('click', async () => {
                    button.disabled = true;
                    try {
                        const { download } = await request(`/admin/legacy/submissions/${encodeURIComponent(item.id)}/download`, true);
                        const url = new URL(download.url);
                        if (url.origin !== 'https://fgws3-ocloud.ihep.ac.cn')
                            throw new Error('下载来源无效。');
                        const result = await fetch(url, { headers: download.headers, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
                        if (!result.ok)
                            throw new Error('文件下载失败。');
                        const objectUrl = URL.createObjectURL(await result.blob());
                        const link = document.createElement('a');
                        link.href = objectUrl;
                        link.download = download.fileName;
                        link.click();
                        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
                        status.textContent = '文件已准备好，请在浏览器中保存。';
                    }
                    catch (error) {
                        status.textContent = error instanceof Error ? error.message : '下载失败。';
                    }
                    finally {
                        button.disabled = false;
                    }
                });
                article.append(title, summary, description, button);
                container.append(article);
            }
        }
        catch (error) {
            status.textContent = error instanceof Error ? error.message : '加载失败。';
        }
    })();
}
