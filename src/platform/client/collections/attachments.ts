import { api, fetchStorageDownload, safeStorageUrl, saveBlob, type StorageDownload } from '../api';
import { submissionRoute } from './model';

/** Minimal zero-dependency ZIP builder (STORE mode) for client-side batch download from OSCA. */
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  crcTable[i] = c >>> 0;
}

function buildZip(entries: { name: string; data: Blob; crc: number }[]): Blob {
  const enc = new TextEncoder();
  const locals: (Uint8Array | Blob)[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    const crc = e.crc;
    const lh = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, e.data.size, true);
    lv.setUint32(22, e.data.size, true);
    lv.setUint16(26, nameBytes.length, true);
    lh.set(nameBytes, 30);
    locals.push(lh, e.data);

    const ch = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, e.data.size, true);
    cv.setUint32(24, e.data.size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    ch.set(nameBytes, 46);
    centrals.push(ch);
    offset += lh.length + e.data.size;
  }
  const cdSize = centrals.reduce((s, b) => s + b.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  return new Blob([...locals, ...centrals, eocd] as BlobPart[], { type: 'application/zip' });
}

export type Upload = { url: string; headers: Record<string, string> };

export async function uploadFile(file: File, upload: Upload) {
  const response = await fetch(safeStorageUrl(upload.url), { method: 'PUT', headers: upload.headers, body: file, credentials: 'omit', redirect: 'error' });
  if (!response.ok) throw new Error('附件上传失败，请重试。');
}

export async function downloadFile(submissionId: string, file: { id: string; name: string }) {
  const { download } = await api<{ download: StorageDownload & { fileName: string } }>(`${submissionRoute(submissionId)}/files/${encodeURIComponent(file.id)}/download`, {});
  const response = await fetchStorageDownload(download);
  saveBlob(await response.blob(), download.fileName || file.name);
}

const segment = (part: string) => part.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/^[. ]+|[. ]+$/g, '') || '附件';

export async function downloadZip(path: string, name: string, progress: (message: string) => void, signal: AbortSignal) {
  const { files } = await api<{ files: { name: string; size: number; studentId?: string; submissionId: string; download: StorageDownload }[] }>(`${path}/files`, undefined, { signal });
  if (!files.length) throw new Error('本批次暂无可下载的附件。');
  const names = new Set<string>();
  const encoder = new TextEncoder();
  const entries = files.map(file => {
    const folder = segment(file.studentId || file.submissionId);
    const base = `${folder}/${segment(file.name)}`;
    let path = base;
    for (let suffix = 2; names.has(path.toLowerCase()); suffix++) path = `${folder}/${suffix}-${segment(file.name)}`;
    names.add(path.toLowerCase());
    return { path, file };
  });
  const totalBytes = entries.reduce((bytes, entry) => bytes + entry.file.size + 76 + 2 * encoder.encode(entry.path).length, 22);
  if (files.length > 65535 || totalBytes > 0xffffffff) throw new Error('批次附件超过 ZIP 容量，请单独下载。');

  const archive = new Array<{ name: string; data: Blob; crc: number }>(files.length);
  let next = 0;
  let done = 0;
  let failure: unknown;
  async function downloadFiles() {
    while (!failure && next < entries.length) {
      const index = next++;
      const { file, path } = entries[index]!;
      try {
        signal.throwIfAborted();
        const response = await fetchStorageDownload(file.download, signal);
        const data = await response.blob();
        if (data.size !== file.size) throw new Error('附件内容大小发生变化，请重新下载。');
        const reader = data.stream().getReader();
        let crc = 0xffffffff;
        try {
          for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
            signal.throwIfAborted();
            for (const byte of chunk.value) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
          }
        } finally { reader.releaseLock(); }
        archive[index] = { name: path, data, crc: (crc ^ 0xffffffff) >>> 0 };
        progress(`正在下载附件 ${++done}/${files.length}`);
      } catch (error) { failure ||= error; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(6, files.length) }, downloadFiles));
  if (failure) throw failure;
  signal.throwIfAborted();
  saveBlob(buildZip(archive), name + '.zip');
}