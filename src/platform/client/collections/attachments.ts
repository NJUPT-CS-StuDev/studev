import { api, fetchStorageDownload, safeStorageUrl, saveBlob, type StorageDownload } from '../api';
import { zipSegment } from '../../collections.mjs';
import { submissionRoute } from './model';

export { zipSegment } from '../../collections.mjs';

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

export interface ExportAttachment {
    id: string;
    revision: number;
    fieldId: string;
    fieldLabel?: string;
    name: string;
    archiveName?: string;
    size: number;
    type: string;
    studentId?: string;
    studentName?: string;
    submissionId: string;
    answers?: Record<string, unknown>;
}

export type ZipEntry<File extends ExportAttachment = ExportAttachment> = { path: string; file: File } | { path: string; text: string };
export type SignedAttachment = Pick<ExportAttachment, 'id' | 'submissionId' | 'revision' | 'archiveName'> & { download: StorageDownload };
export const exportAttachmentKey = (file: Pick<ExportAttachment, 'id' | 'submissionId' | 'revision'>) =>
    `${file.submissionId}/${file.revision}/${file.id}`;

export async function downloadZip(entries: ZipEntry<ExportAttachment & SignedAttachment>[], name: string, progress: (message: string) => void, signal: AbortSignal) {
    if (!entries.length) throw new Error('当前范围没有可打包的内容。');
    const encoder = new TextEncoder();
    const sizes = entries.map(entry => 'file' in entry ? entry.file.size : encoder.encode(entry.text).length);
    const totalBytes = entries.reduce((bytes, entry, index) => bytes + sizes[index]! + 76 + 2 * encoder.encode(entry.path).length, 22);
    if (entries.length > 65535 || totalBytes > 0xffffffff) throw new Error('附件超过 ZIP 容量，请分批下载。');

    const archive = new Array<{ name: string; data: Blob; crc: number }>(entries.length);
    const fileCount = entries.filter(entry => 'file' in entry).length;
    let next = 0;
    let done = 0;
    let failure: unknown;
    async function writeEntries() {
        while (!failure && next < entries.length) {
            const index = next++;
            const entry = entries[index]!;
            try {
                signal.throwIfAborted();
                let crc = 0xffffffff;
                const updateCrc = (chunk: Uint8Array) => {
                    for (const byte of chunk) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
                };
                let data: Blob;
                if ('text' in entry) {
                    const bytes = encoder.encode(entry.text);
                    updateCrc(bytes);
                    data = new Blob([bytes], { type: 'text/plain;charset=utf-8' });
                } else {
                    const response = await fetchStorageDownload(entry.file.download, signal);
                    if (!response.body) throw new Error('未收到附件内容，请重新下载。');
                    const fileSize = entry.file.size;
                    let bytes = 0;
                    const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
                        transform(chunk, out) {
                            signal.throwIfAborted();
                            bytes += chunk.byteLength;
                            if (bytes > fileSize) throw new Error('附件内容大小发生变化，请刷新预览。');
                            updateCrc(chunk);
                            out.enqueue(chunk);
                        },
                    }), { signal });
                    data = await new Response(body).blob();
                    if (bytes !== fileSize) throw new Error('附件内容大小发生变化，请刷新预览。');
                    progress('正在取附件 ' + (++done) + '/' + fileCount);
                }
                archive[index] = { name: entry.path, data, crc: (crc ^ 0xffffffff) >>> 0 };
            } catch (error) { failure ||= error; }
        }
    }
    await Promise.all(Array.from({ length: Math.min(6, entries.length) }, writeEntries));
    if (failure) throw failure;
    signal.throwIfAborted();
    saveBlob(buildZip(archive), zipSegment(name.replace(/\.zip$/i, '')) + '.zip');
}
