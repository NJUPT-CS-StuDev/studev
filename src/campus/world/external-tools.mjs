export const externalToolLimit = 16;
export const externalSchemaBudget = 32768;
export const externalAlias = /^mcp_[0-9a-f]{12}_[A-Za-z0-9_-]{1,47}(?![\s\S])/u;
export const externalDescription = value => value.replace(/[\p{Cc}\p{Cf}\s]+/gu, ' ').trim().slice(0, 600);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** One schema contract for locally discovered tools and the free model relay. */
export function externalParameters(input) {
    if (!object(input) || input.type !== 'object') return null;
    const parameters = { ...input };
    delete parameters.$schema;
    const pending = [[parameters, 0]];
    let count = 0;
    while (pending.length) {
        const [value, depth] = pending.pop();
        if (++count > 512 || depth > 12) return null;
        if (value === null || typeof value !== 'object') continue;
        for (const [key, child] of Object.entries(value)) {
            if (['$id', '$ref', '$dynamicRef', '$recursiveRef'].includes(key) && typeof child === 'string' && !child.startsWith('#')) return null;
            pending.push([child, depth + 1]);
        }
    }
    const json = JSON.stringify(parameters, (key, value) => key === 'description' && typeof value === 'string' ? externalDescription(value) : value);
    const bytes = new TextEncoder().encode(json).byteLength;
    return bytes <= 8192 ? { parameters: JSON.parse(json), bytes } : null;
}
