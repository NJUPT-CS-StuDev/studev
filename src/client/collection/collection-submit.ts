import { apiRequest, errorMessage, formatBytes, formatTime, setStatus } from './collection-client';

interface SubmissionItem { id: string; status: string; fileName: string; fileSize: number; createdAt: string; completedAt?: string; }
interface NewSubmission { item: SubmissionItem; receiptToken: string; upload: { url: string; method: string; headers: Record<string, string>; expiresAt: string }; }

const page = document.querySelector<HTMLElement>('[data-collection-submit]');
if (page) {
  const get = <T extends Element>(selector: string) => page.querySelector<T>(selector)!;
  const form = get<HTMLFormElement>('[data-submit-form]');
  const fields = get<HTMLFieldSetElement>('[data-submit-fields]');
  const status = get<HTMLElement>('[data-submit-status]');
  const fileInput = get<HTMLInputElement>('#submission-file');
  const submitButton = get<HTMLButtonElement>('[data-submit-button]');
  const progress = get<HTMLElement>('[data-upload-progress]');
  const progressBar = get<HTMLProgressElement>('[data-upload-bar]');
  const progressLabel = get<HTMLElement>('[data-upload-label]');
  const cancelButton = get<HTMLButtonElement>('[data-upload-cancel]');
  const retryButton = get<HTMLButtonElement>('[data-complete-retry]');
  const receipt = get<HTMLElement>('[data-submit-receipt]');
  let maxFileBytes = 20 * 1024 * 1024;
  let allowedExtensions: string[] = [];
  let available = false;
  let busy = false;
  let activeUpload: XMLHttpRequest | undefined;
  let pending: NewSubmission | undefined;
  let receiptText = '';

  function setBusy(value: boolean) {
    busy = value;
    fields.disabled = value || !available || Boolean(pending);
    retryButton.disabled = value;
    submitButton.textContent = value ? '正在提交……' : '提交材料';
  }

  function uploadFile(file: File, upload: NewSubmission['upload']): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      activeUpload = xhr;
      xhr.open(upload.method, upload.url);
      xhr.withCredentials = false;
      xhr.timeout = 15 * 60 * 1000;
      for (const [key, value] of Object.entries(upload.headers)) xhr.setRequestHeader(key, value);
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          const percent = Math.min(100, Math.round(event.loaded / event.total * 100));
          progressBar.value = percent;
          progressLabel.textContent = `正在上传 ${percent}% · ${formatBytes(event.loaded)} / ${formatBytes(event.total)}`;
        }
      });
      xhr.addEventListener('load', () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('文件未能上传成功，请稍后重试。')));
      xhr.addEventListener('error', () => reject(new Error('文件上传连接失败，请检查网络后重试。')));
      xhr.addEventListener('timeout', () => reject(new Error('上传等待超时，请检查网络后重试。')));
      xhr.addEventListener('abort', () => reject(new Error('上传已取消，材料尚未提交。')));
      xhr.send(file);
    });
  }

  async function completeSubmission() {
    if (!pending) return;
    setBusy(true);
    retryButton.hidden = true;
    cancelButton.hidden = true;
    progressLabel.textContent = '上传完成，正在确认收件……';
    try {
      const { item } = await apiRequest<{ item: SubmissionItem }>(`/submissions/${encodeURIComponent(pending.item.id)}/complete`, {
        method: 'POST', body: JSON.stringify({ receiptToken: pending.receiptToken }),
      });
      if (!['pending_review', 'accepted', 'rejected'].includes(item.status)) throw new Error('材料仍在处理中，请重试确认提交。');
      form.hidden = true;
      progress.hidden = true;
      receipt.hidden = false;
      get<HTMLElement>('[data-receipt-id]').textContent = item.id;
      get<HTMLElement>('[data-receipt-file]').textContent = `${item.fileName} · ${formatBytes(item.fileSize)}`;
      get<HTMLElement>('[data-receipt-time]').textContent = formatTime(item.completedAt || item.createdAt);
      receiptText = `StuDev 材料提交回执\n编号：${item.id}\n文件：${item.fileName}\n大小：${formatBytes(item.fileSize)}\n提交时间：${formatTime(item.completedAt || item.createdAt)}`;
      get<HTMLInputElement>('#invite-code').value = '';
      pending = undefined;
      setStatus(status, '提交成功，材料已进入待审核清单。', 'success');
      receipt.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (error) {
      retryButton.hidden = false;
      setStatus(status, `${errorMessage(error)} 文件可能已上传，请留在此页并点击“重试确认提交”，无需重新上传。`, 'error');
    } finally { setBusy(false); }
  }

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    get<HTMLElement>('[data-file-summary]').textContent = file ? `${file.name} · ${formatBytes(file.size)}` : '';
    const extension = file?.name.split('.').at(-1)?.toLowerCase() || '';
    const invalidExtension = file && allowedExtensions.length > 0 && !allowedExtensions.includes(extension);
    fileInput.setCustomValidity(file && file.size > maxFileBytes ? `请选择不超过 ${formatBytes(maxFileBytes)} 的文件。` : invalidExtension ? '此文件类型不在本次收件范围内，请按下方格式提交。' : '');
    if (file) fileInput.reportValidity();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy || !available || !form.reportValidity()) return;
    if (pending) {
      setStatus(status, '上一份文件正在等待确认，请先点击“重试确认提交”。', 'error');
      return;
    }
    const file = fileInput.files?.[0];
    if (!file || file.size === 0) { setStatus(status, '请选择一个非空文件。', 'error'); return; }
    if (file.size > maxFileBytes) { setStatus(status, `文件超过 ${formatBytes(maxFileBytes)}，请压缩后再提交。`, 'error'); return; }
    const body = {
      inviteCode: get<HTMLInputElement>('#invite-code').value.trim(),
      name: get<HTMLInputElement>('#submitter-name').value.trim(),
      contact: get<HTMLInputElement>('#submitter-contact').value.trim(),
      description: get<HTMLTextAreaElement>('#submission-description').value.trim(),
      file: { name: file.name, size: file.size, type: file.type || 'application/octet-stream' },
    };
    setBusy(true);
    retryButton.hidden = true;
    progress.hidden = false;
    progressBar.value = 0;
    progressLabel.textContent = '正在准备上传……';
    setStatus(status, '正在提交，请保持此页打开。');
    try {
      pending = await apiRequest<NewSubmission>('/submissions', { method: 'POST', body: JSON.stringify(body) });
      cancelButton.hidden = false;
      try { await uploadFile(file, pending.upload); }
      catch (error) { pending = undefined; throw error; }
      activeUpload = undefined;
      await completeSubmission();
    } catch (error) {
      progress.hidden = true;
      cancelButton.hidden = true;
      setStatus(status, errorMessage(error), 'error');
    } finally {
      activeUpload = undefined;
      setBusy(false);
    }
  });

  cancelButton.addEventListener('click', () => activeUpload?.abort());
  retryButton.addEventListener('click', () => { if (!busy) void completeSubmission(); });
  get<HTMLButtonElement>('[data-submit-another]').addEventListener('click', () => {
    form.reset();
    form.hidden = false;
    receipt.hidden = true;
    get<HTMLElement>('[data-file-summary]').textContent = '';
    get<HTMLButtonElement>('[data-receipt-copy]').textContent = '复制回执';
    setStatus(status, '');
    get<HTMLInputElement>('#invite-code').focus();
  });
  get<HTMLButtonElement>('[data-receipt-copy]').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(receiptText);
      get<HTMLButtonElement>('[data-receipt-copy]').textContent = '回执已复制';
    } catch { setStatus(status, '浏览器无法复制，请手动保存回执编号。'); }
  });
  window.addEventListener('beforeunload', (event) => {
    if (busy || pending) event.preventDefault();
  });

  void apiRequest<{ available: boolean; collection: { title: string; instructions?: string; maxFileBytes: number; allowedExtensions?: string[] } }>('/config')
    .then((config) => {
      if (!config.available) throw new Error('本次收件暂未开放，请联系活动负责人。');
      available = true;
      if (config.collection.title) get<HTMLElement>('[data-collection-title]').textContent = config.collection.title;
      if (config.collection.instructions) get<HTMLElement>('[data-collection-instructions]').textContent = config.collection.instructions;
      if (Number.isFinite(config.collection.maxFileBytes) && config.collection.maxFileBytes > 0) maxFileBytes = config.collection.maxFileBytes;
      get<HTMLElement>('[data-file-limit]').textContent = formatBytes(maxFileBytes);
      allowedExtensions = (config.collection.allowedExtensions || []).filter((extension) => /^[a-z0-9]{1,10}$/.test(extension));
      if (allowedExtensions.length > 0) {
        fileInput.accept = allowedExtensions.map((extension) => `.${extension}`).join(',');
        const formats = get<HTMLElement>('[data-allowed-types]');
        formats.textContent = `支持格式：${allowedExtensions.join('、')}`;
        formats.hidden = false;
      }
      fields.disabled = false;
      setStatus(status, '');
    }).catch((error) => setStatus(status, errorMessage(error), 'error'));
}
