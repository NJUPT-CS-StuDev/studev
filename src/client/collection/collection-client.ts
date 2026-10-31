export const collectionApi = '/api/collection';

export class CollectionError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 0, code = '') {
    super(message);
    this.name = 'CollectionError';
    this.status = status;
    this.code = code;
  }
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${collectionApi}${path}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      ...options,
      headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
    });
  } catch {
    throw new CollectionError('网络连接中断，请检查网络后重试。');
  }
  let payload: unknown;
  try { payload = await response.json(); }
  catch { throw new CollectionError('收件服务暂时无法响应，请稍后重试。', response.status); }
  if (!response.ok) {
    const error = payload as { error?: { message?: string; code?: string } };
    throw new CollectionError(error.error?.message || '操作未完成，请稍后重试。', response.status, error.error?.code);
  }
  return payload as T;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '未知大小';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')} MB`;
}

export function formatTime(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '—' : new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '操作未完成，请稍后重试。';
}

export function setStatus(element: HTMLElement, text: string, kind: 'info' | 'error' | 'success' = 'info') {
  element.textContent = text;
  element.dataset.kind = kind;
}

export function safeDownloadUrl(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
    throw new CollectionError('下载地址无效，请联系负责人。');
  }
  return url.href;
}
