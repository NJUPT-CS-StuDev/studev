import { apiRequest, CollectionError, errorMessage, formatBytes, formatTime, safeDownloadUrl, setStatus } from './collection-client';

interface Submission {
  id: string; name: string; contact?: string; description?: string;
  fileName: string; fileSize: number; contentType?: string; status: string;
  createdAt: string; completedAt?: string; revision: number;
  reviewComment?: string; reviewedAt?: string; review?: { comment?: string; reviewedAt?: string };
}
const stateLabels: Record<string, string> = { created: '等待上传', uploading: '上传中', pending_review: '待审核', accepted: '已通过', rejected: '已退回', expired: '已过期', failed: '未完成' };

const page = document.querySelector<HTMLElement>('[data-collection-admin]');
if (page) {
  const get = <T extends Element>(selector: string) => page.querySelector<T>(selector)!;
  const status = get<HTMLElement>('[data-admin-status]');
  const login = get<HTMLElement>('[data-admin-login]');
  const loginForm = get<HTMLFormElement>('[data-admin-login-form]');
  const loginButton = get<HTMLButtonElement>('[data-login-button]');
  const password = get<HTMLInputElement>('#admin-password');
  const workspace = get<HTMLElement>('[data-admin-workspace]');
  const list = get<HTMLTableSectionElement>('[data-admin-list]');
  const filter = get<HTMLSelectElement>('[data-admin-filter]');
  const previous = get<HTMLButtonElement>('[data-admin-previous]');
  const next = get<HTMLButtonElement>('[data-admin-next]');
  const detail = get<HTMLElement>('[data-admin-detail]');
  const comment = get<HTMLTextAreaElement>('[data-review-comment]');
  const reviewButtons = [get<HTMLButtonElement>('[data-detail-accept]'), get<HTMLButtonElement>('[data-detail-reject]')];
  const downloadButton = get<HTMLButtonElement>('[data-detail-download]');
  let csrfToken = '';
  let items: Submission[] = [];
  let selected: Submission | undefined;
  let currentCursor: string | undefined;
  let nextCursor: string | undefined;
  const history: (string | undefined)[] = [];
  let loading = false;
  let actionBusy = false;
  let sessionEpoch = 0;

  function showLogin() {
    sessionEpoch++;
    csrfToken = '';
    items = [];
    selected = undefined;
    list.replaceChildren();
    detail.hidden = true;
    workspace.hidden = true;
    login.hidden = false;
    password.value = '';
  }

  function handleError(error: unknown) {
    if (error instanceof CollectionError && error.status === 401) {
      showLogin();
      setStatus(status, '登录已过期，请重新登录。');
      return;
    }
    setStatus(status, errorMessage(error), 'error');
  }

  function renderDetail(item: Submission, preserveComment = false) {
    selected = item;
    detail.hidden = false;
    get<HTMLElement>('[data-detail-id]').textContent = item.id;
    get<HTMLElement>('[data-detail-name]').textContent = item.name;
    get<HTMLElement>('[data-detail-contact]').textContent = item.contact || '未填写';
    get<HTMLElement>('[data-detail-description]').textContent = item.description || '未填写';
    get<HTMLElement>('[data-detail-file]').textContent = `${item.fileName} · ${formatBytes(item.fileSize)}`;
    get<HTMLElement>('[data-detail-status]').textContent = stateLabels[item.status] || '未知状态';
    get<HTMLElement>('[data-detail-time]').textContent = formatTime(item.completedAt || item.createdAt);
    const reviewComment = item.reviewComment || item.review?.comment;
    const reviewedAt = item.reviewedAt || item.review?.reviewedAt;
    get<HTMLElement>('[data-detail-review]').textContent = reviewedAt ? `${formatTime(reviewedAt)}${reviewComment ? `\n${reviewComment}` : ''}` : (reviewComment || '尚未审核');
    if (!preserveComment) comment.value = reviewComment || '';
    const complete = ['pending_review', 'accepted', 'rejected'].includes(item.status);
    get<HTMLElement>('[data-review-field]').hidden = !complete;
    reviewButtons.forEach((button) => { button.disabled = !complete || actionBusy; });
    downloadButton.disabled = !complete || actionBusy;
  }

  function renderList() {
    const visible = items.filter((item) => !filter.value || item.status === filter.value);
    list.replaceChildren();
    for (const item of visible) {
      const row = document.createElement('tr');
      const nameCell = document.createElement('td');
      nameCell.textContent = item.name;
      const fileCell = document.createElement('td');
      fileCell.textContent = item.fileName;
      const size = document.createElement('small');
      size.textContent = formatBytes(item.fileSize);
      fileCell.append(size);
      const stateCell = document.createElement('td');
      const state = document.createElement('span');
      state.className = 'collection-pill';
      state.dataset.state = item.status;
      state.textContent = stateLabels[item.status] || '未知状态';
      stateCell.append(state);
      const timeCell = document.createElement('td');
      timeCell.textContent = formatTime(item.completedAt || item.createdAt);
      const actionCell = document.createElement('td');
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'collection-button secondary compact';
      open.textContent = '查看';
      open.setAttribute('aria-label', `查看 ${item.name} 的材料`);
      open.addEventListener('click', () => {
        renderDetail(item);
        detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      actionCell.append(open);
      row.append(nameCell, fileCell, stateCell, timeCell, actionCell);
      list.append(row);
    }
    get<HTMLElement>('[data-admin-empty]').hidden = visible.length > 0;
    get<HTMLElement>('[data-admin-empty]').textContent = filter.value ? '当前页没有符合此状态的材料。' : '当前页还没有材料。';
    get<HTMLElement>('[data-admin-count]').textContent = `第 ${history.length + 1} 页 · 本页 ${items.length} 份${filter.value ? `，显示 ${visible.length} 份` : ''}（筛选仅作用于当前页）`;
    previous.disabled = history.length === 0 || loading;
    next.disabled = !nextCursor || loading;
  }

  async function loadPage(cursor?: string) {
    if (loading || !csrfToken) return false;
    loading = true;
    const epoch = sessionEpoch;
    previous.disabled = true;
    next.disabled = true;
    get<HTMLButtonElement>('[data-admin-refresh]').disabled = true;
    setStatus(status, '正在读取收件清单……');
    try {
      const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
      const result = await apiRequest<{ items: Submission[]; cursor: string | null }>(`/admin/submissions${query}`);
      if (epoch !== sessionEpoch) return false;
      items = result.items;
      currentCursor = cursor;
      nextCursor = result.cursor || undefined;
      selected = undefined;
      detail.hidden = true;
      setStatus(status, '');
      return true;
    } catch (error) { if (epoch === sessionEpoch) handleError(error); }
    finally {
      loading = false;
      get<HTMLButtonElement>('[data-admin-refresh]').disabled = false;
      renderList();
    }
    return false;
  }

  async function enterWorkspace(token: string) {
    sessionEpoch++;
    csrfToken = token;
    login.hidden = true;
    workspace.hidden = false;
    password.value = '';
    history.length = 0;
    currentCursor = undefined;
    nextCursor = undefined;
    await loadPage();
  }

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (loginButton.disabled || !loginForm.reportValidity()) return;
    loginButton.disabled = true;
    setStatus(status, '正在登录……');
    const value = password.value;
    password.value = '';
    try {
      const result = await apiRequest<{ authenticated: boolean; csrfToken: string }>('/admin/login', { method: 'POST', body: JSON.stringify({ password: value }) });
      if (!result.authenticated || !result.csrfToken) throw new Error('登录未完成，请重试。');
      await enterWorkspace(result.csrfToken);
    } catch (error) {
      if (error instanceof CollectionError && error.code === 'LOGIN_FAILED') {
        setStatus(status, error.message, 'error');
        password.focus();
      } else handleError(error);
    }
    finally { loginButton.disabled = false; }
  });

  filter.addEventListener('change', renderList);
  get<HTMLButtonElement>('[data-admin-refresh]').addEventListener('click', () => void loadPage(currentCursor));
  next.addEventListener('click', async () => {
    if (loading || !nextCursor) return;
    history.push(currentCursor);
    if (!(await loadPage(nextCursor))) { history.pop(); renderList(); }
  });
  previous.addEventListener('click', async () => {
    if (loading || history.length === 0) return;
    const cursor = history.pop();
    if (!(await loadPage(cursor))) { history.push(cursor); renderList(); }
  });
  get<HTMLButtonElement>('[data-detail-close]').addEventListener('click', () => { detail.hidden = true; selected = undefined; });

  async function review(state: 'accepted' | 'rejected') {
    if (!selected || actionBusy) return;
    const item = selected;
    const epoch = sessionEpoch;
    const reviewComment = comment.value.trim();
    actionBusy = true;
    renderDetail(item, true);
    setStatus(status, '正在保存审核结果……');
    try {
      const result = await apiRequest<{ item: Submission }>(`/admin/submissions/${encodeURIComponent(item.id)}/review`, {
        method: 'POST', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify({ status: state, revision: item.revision, comment: reviewComment }),
      });
      if (epoch !== sessionEpoch) return;
      items = items.map((entry) => entry.id === result.item.id ? result.item : entry);
      selected = result.item;
      renderList();
      setStatus(status, state === 'accepted' ? '已记录：审核通过。' : '已记录：退回。', 'success');
    } catch (error) { if (epoch === sessionEpoch) handleError(error); }
    finally {
      actionBusy = false;
      if (epoch === sessionEpoch && selected) renderDetail(selected, selected === item);
    }
  }
  reviewButtons[0].addEventListener('click', () => void review('accepted'));
  reviewButtons[1].addEventListener('click', () => void review('rejected'));

  downloadButton.addEventListener('click', async () => {
    if (!selected || actionBusy) return;
    const item = selected;
    const epoch = sessionEpoch;
    actionBusy = true;
    renderDetail(item, true);
    setStatus(status, '正在准备下载……');
    let objectUrl: string | undefined;
    try {
      const result = await apiRequest<{ download: { url: string; headers: Record<string, string>; fileName: string } }>(`/admin/submissions/${encodeURIComponent(item.id)}/download`, {
        method: 'POST', headers: { 'X-CSRF-Token': csrfToken },
      });
      const response = await fetch(safeDownloadUrl(result.download.url), { credentials: 'omit', headers: result.download.headers, cache: 'no-store', referrerPolicy: 'no-referrer' });
      if (!response.ok) throw new Error('文件下载失败，请重新获取下载权限。');
      const blob = await response.blob();
      if (epoch !== sessionEpoch) return;
      objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = result.download.fileName || item.fileName;
      link.hidden = true;
      document.body.append(link);
      link.click();
      link.remove();
      const toRevoke = objectUrl;
      window.setTimeout(() => URL.revokeObjectURL(toRevoke), 60_000);
      objectUrl = undefined;
      setStatus(status, '文件已准备好，请在浏览器中保存。', 'success');
    } catch (error) { if (epoch === sessionEpoch) handleError(error); }
    finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      actionBusy = false;
      if (epoch === sessionEpoch && selected) renderDetail(selected, true);
    }
  });

  get<HTMLButtonElement>('[data-admin-logout]').addEventListener('click', async () => {
    const button = get<HTMLButtonElement>('[data-admin-logout]');
    button.disabled = true;
    try {
      await apiRequest('/admin/logout', { method: 'POST', headers: { 'X-CSRF-Token': csrfToken } });
      showLogin();
      setStatus(status, '已退出登录。');
    } catch (error) { handleError(error); }
    finally { button.disabled = false; }
  });

  void apiRequest<{ authenticated: boolean; csrfToken: string }>('/admin/session')
    .then((result) => result.authenticated && result.csrfToken ? enterWorkspace(result.csrfToken) : showLogin())
    .catch((error) => {
      showLogin();
      if (error instanceof CollectionError && error.status === 401) setStatus(status, '');
      else setStatus(status, errorMessage(error), 'error');
    });
}
