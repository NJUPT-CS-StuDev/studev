export interface FetchOptions {
    signal?: AbortSignal;
}

export const fetchJson = async <T = unknown>(url: string, options: FetchOptions = {}): Promise<T> => {
    const response = await fetch(url, { signal: options.signal });
    if (!response.ok) throw new Error(`数据请求失败: ${url} HTTP ${response.status}`);
    return await response.json() as T;
};
