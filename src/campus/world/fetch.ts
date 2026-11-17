import { reloadIfGone } from '@/world/stale';

export interface FetchOptions {
    signal?: AbortSignal;
}

const request = async (url: string, options: FetchOptions = {}): Promise<Response> => {
    const timeout = AbortSignal.timeout(10_000);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    const response = await fetch(url, { signal });
    if (!response.ok) {
        if (response.status === 404) void reloadIfGone();
        throw new Error(`数据请求失败: ${url} HTTP ${response.status}`);
    }
    return response;
};

export const fetchJson = async <T = unknown>(url: string, options: FetchOptions = {}): Promise<T> =>
    (await request(url, options)).json() as Promise<T>;

export const fetchText = async (url: string, options: FetchOptions = {}): Promise<string> =>
    (await request(url, options)).text();
