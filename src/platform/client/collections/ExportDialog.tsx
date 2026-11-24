import { ArrowDown, ArrowUp, Download, FileArchive, FileText, Folder, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { attachmentNameTokens, collectionProgress, formatAttachmentName, splitAttachmentName } from '../../collections.mjs';
import { api, bytes, errorText } from '../api';
import { Dialog } from './Dialog';
import { downloadZip, exportAttachmentKey, zipSegment, type ExportAttachment, type SignedAttachment, type ZipEntry } from './attachments';
import { displayTime, groupBoardRows, matchesBoardFilter, submissionStatus, type BoardTableRow, type ProgressCounts, type Round } from './model';
import './Export.css';

interface ExportDialogProps {
    path: string;
    title: string;
    attachmentNamePattern?: string;
    round: Round;
    rows: BoardTableRow[];
    activeGroupId: string | null;
    activeFilter: string;
    selected: boolean;
    onClose: () => void;
}

const folderNames = { group: '班级或组织', round: '批次', student: '学号和姓名' };
type FolderLayer = keyof typeof folderNames;
const schemeKey = 'studev_collection_export_scheme';
const tokens = /\{([^{}]+)\}/g;
const fieldPrefix = '字段:';
const nameOrder = new Intl.Collator('zh-CN', { numeric: true });
const previewPageSize = 80;
interface Scheme { folders: FolderLayer[]; pattern: string; statistics: boolean; missing: boolean }

function readScheme(): Scheme | undefined {
    try {
        const raw: unknown = JSON.parse(localStorage.getItem(schemeKey) || 'null');
        if (typeof raw !== 'object' || raw === null) return;
        const { folders, pattern, statistics, missing } = raw as Partial<Scheme>;
        if (Array.isArray(folders) && folders.every(layer => Object.hasOwn(folderNames, layer)) &&
            new Set(folders).size === folders.length && typeof pattern === 'string' && pattern.length <= 320 &&
            typeof statistics === 'boolean' && typeof missing === 'boolean') return { folders, pattern, statistics, missing };
    } catch {
        return;
    }
}

const tokenValue = (value: unknown): string => {
    if (Array.isArray(value)) return value.filter(v => typeof v === 'string').join('、');
    return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
};

function archiveNameParts(file: ExportAttachment, pattern: string, round: Round, values: Record<'学号' | '姓名' | '班级' | '收集名称', string>) {
    if (file.archiveName) return splitAttachmentName(file.archiveName);
    const builtins: Record<string, string> = {
        ...values, 批次: round.label, 附件项: file.fieldLabel || round.fields.find(field => field.id === file.fieldId)?.label || '附件', 原文件名: splitAttachmentName(file.name).stem,
    };
    return splitAttachmentName(formatAttachmentName(pattern, file.name, token =>
        token.startsWith(fieldPrefix) ? tokenValue(file.answers?.[token.slice(fieldPrefix.length)]) : builtins[token] ?? ''));
}

function summaryLine(counts: ProgressCounts) {
    if (counts.total === null) return `参与 ${counts.submitted} 人，共交 ${counts.records} 份${counts.late ? `，补交 ${counts.late} 人` : ''}`;
    return `应交 ${counts.total} 人，名单内已交 ${counts.submitted} 人，未交 ${counts.missing} 人，补交 ${counts.late} 人`;
}

function reportEntries(scheme: Scheme, rows: BoardTableRow[], title: string, round: Round, scopeLabel: string, selected: boolean, time: string): ZipEntry[] {
    const groups = groupBoardRows(rows);
    const entries: ZipEntry[] = [];
    if (scheme.statistics) {
        const lines = [
            title,
            '批次　' + round.label,
            '范围　' + scopeLabel,
            '截止　' + displayTime(round.deadline),
            '清单生成时间　' + displayTime(time),
            '',
            summaryLine(collectionProgress(rows, selected).counts),
            ...groups.filter(() => groups.length > 1).map(group => group.label + '　' + summaryLine(collectionProgress(group.rows, selected).counts)),
        ];
        entries.push({ path: '统计.txt', text: lines.join('\r\n') + '\r\n' });
    }
    if (scheme.missing && selected) {
        const lines = groups.flatMap(group => {
            const { missingRows } = collectionProgress(group.rows, selected);
            return missingRows.length ? [group.label, ...missingRows.map(person => (person.studentId || '').trim() + '\t' + person.name), ''] : [];
        });
        entries.push({ path: '未交名单.txt', text: [title + ' · ' + round.label, '范围　' + scopeLabel, '', ...(lines.length ? lines : ['当前范围内没有未交。'])].join('\r\n') + '\r\n' });
    }
    return entries;
}

function makePlan({ files, attachmentRows, reportRows, scheme, title, round, reportLabel, selected, time }: {
    files: ExportAttachment[]; attachmentRows: BoardTableRow[]; reportRows: BoardTableRow[]; scheme: Scheme; title: string; round: Round; reportLabel: string; selected: boolean; time: string;
}) {
    const entries = reportEntries(scheme, reportRows, title, round, reportLabel, selected, time);
    const occupied = new Set(entries.map(entry => entry.path.toLowerCase()));
    const bySubmission = new Map(attachmentRows.flatMap(row => row.submissionId ? [[row.submissionId, row] as const] : []));
    const groupFolders = new Map<string, string>();
    const folderLabels = new Set<string>();
    for (const { id, label } of groupBoardRows(reportRows)) {
        const base = zipSegment(label);
        let segment = base;
        for (let suffix = 2; folderLabels.has(segment.toLowerCase()); suffix++) segment = base + '-' + suffix;
        groupFolders.set(id, segment);
        folderLabels.add(segment.toLowerCase());
    }

    const placement = new Map(attachmentRows.flatMap((row, index) => row.submissionId ? [[row.submissionId, index] as const] : []));
    const rootFolders = new Map<string, string>();
    const takenRootNames = new Set(occupied);
    const nextSuffix = new Map<string, number>();
    const ordered = [...files].sort((a, b) => (placement.get(a.submissionId) ?? Infinity) - (placement.get(b.submissionId) ?? Infinity) ||
        a.fieldId.localeCompare(b.fieldId) || nameOrder.compare(a.name, b.name) || a.id.localeCompare(b.id));
    for (const file of ordered) {
        const row = bySubmission.get(file.submissionId);
        if (!row) continue;
        const studentId = row.studentId || file.studentId || '';
        const name = row.name || file.studentName || '';
        const group = row.groupLabel || '待核对';
        const folders = {
            group: groupFolders.get(row.groupId) ?? zipSegment(group),
            round: zipSegment(round.label),
            student: zipSegment([studentId, name].filter(Boolean).join('-') || '未登记学号'),
        };
        const segments = scheme.folders.map(layer => folders[layer]);
        const first = segments[0];
        if (first) {
            const key = first.toLowerCase();
            let folder = rootFolders.get(key);
            if (!folder) {
                folder = first;
                for (let count = 2; takenRootNames.has(folder.toLowerCase()); count++) folder = first + '-' + count;
                takenRootNames.add(folder.toLowerCase());
                rootFolders.set(key, folder);
            }
            segments[0] = folder;
        }
        const directory = segments.join('/');
        const { stem, extension } = archiveNameParts(file, scheme.pattern, round, { 学号: studentId, 姓名: name, 班级: group, 收集名称: title });
        const full = (suffix = '') => (directory ? directory + '/' : '') + stem + suffix + (extension ? '.' + extension : '');
        let path = full();
        const base = path.toLowerCase();
        let key = base;
        if (occupied.has(base)) {
            let suffix = nextSuffix.get(base) ?? 2;
            do {
                path = full('-' + suffix++);
                key = path.toLowerCase();
            } while (occupied.has(key));
            nextSuffix.set(base, suffix);
        }
        occupied.add(key);
        entries.push({ path, file });
    }
    return entries;
}

interface TreeNode { children: Map<string, TreeNode>; isFolder: boolean }

function ZipTree({ entries, name }: { entries: ZipEntry[]; name: string }) {
    const tree: TreeNode = { children: new Map(), isFolder: true };
    for (const { path } of entries) {
        let node = tree;
        const parts = path.split('/');
        for (const [index, part] of parts.entries()) {
            let next = node.children.get(part);
            if (!next) {
                next = { children: new Map(), isFolder: index < parts.length - 1 };
                node.children.set(part, next);
            }
            node = next;
        }
    }
    const render = (node: TreeNode): ReactNode => <ul>{[...node.children].map(([label, child]) =>
        <li key={label}><span>{child.isFolder ? <Folder size={15} /> : <FileText size={15} />}{label}</span>
            {child.children.size > 0 && render(child)}</li>)}</ul>;
    return <div className="cw-export-tree"><div><FileArchive size={17} />{name}</div>{render(tree)}</div>;
}

export default function ExportDialog({ path, title, attachmentNamePattern, round, rows, activeGroupId, activeFilter, selected, onClose }: ExportDialogProps) {
    const collectionNaming = Boolean(attachmentNamePattern);
    const [scope, setScope] = useState<'current' | 'all'>('current');
    const [archiveName, setArchiveName] = useState(round.label);
    const [hasPreset, setHasPreset] = useState(() => !!readScheme());
    const [scheme, setScheme] = useState<Scheme>(() => ({
        folders: rows.some(row => row.groupId) ? ['group'] : [],
        pattern: '{学号}-{姓名}-{批次}', statistics: true, missing: false,
    }));
    const [manifest, setManifest] = useState<{ key: string; files: ExportAttachment[]; time: string; error?: string }>();
    const [attempt, retry] = useState(0);
    const [previewPage, setPreviewPage] = useState(0);
    const [working, setWorking] = useState(false);
    const [attachmentError, setAttachmentError] = useState('');
    const [message, setMessage] = useState('');
    const transfer = useRef<AbortController>(null);
    const nameInput = useRef<HTMLInputElement>(null);
    const lastFolderAction = useRef<HTMLButtonElement>(null);
    useEffect(() => () => transfer.current?.abort(), []);

    const reportRows = useMemo(() => scope === 'all' || activeGroupId === null ? rows :
        rows.filter(row => row.groupId === activeGroupId), [rows, scope, activeGroupId]);
    const attachmentRows = useMemo(() => scope === 'all' || activeFilter === 'all' ? reportRows :
        reportRows.filter(row => matchesBoardFilter(row, activeFilter)), [reportRows, scope, activeFilter]);
    const formFields = round.fields.filter(field => field.type !== 'file');
    const fieldLabels = new Map<string, string>();
    const labelIds = new Map<string, string>();
    for (const field of formFields) {
        const base = '表单·' + field.label.replace(/\{/g, '｛').replace(/\}/g, '｝');
        let label = base;
        for (let number = 2; labelIds.has(label); number++) label = base + '（' + number + '）';
        fieldLabels.set(field.id, label);
        labelIds.set(label, field.id);
    }
    const displayedPattern = attachmentNamePattern || scheme.pattern.replace(tokens, (whole, token: string) => {
        const label = token.startsWith(fieldPrefix) && fieldLabels.get(token.slice(fieldPrefix.length));
        return label ? '{' + label + '}' : whole;
    });
    const fileTokens = collectionNaming ? [] : [...scheme.pattern.matchAll(tokens)].map(match => match[1]!);
    const answerFieldIds = [...new Set(fileTokens.filter(token => token.startsWith(fieldPrefix))
        .map(token => token.slice(fieldPrefix.length)).filter(id => formFields.some(field => field.id === id)))].sort();
    const submissionIds = [...new Set(attachmentRows.flatMap(row => row.submissionId && row.hasFiles ? [row.submissionId] : []))].sort();
    const key = JSON.stringify({ submissionIds, answerFieldIds, attachmentNamePattern: attachmentNamePattern || '' });
    const activeGroup = activeGroupId === null ? '全部组织' : rows.find(row => row.groupId === activeGroupId)?.groupLabel || '待核对';
    const activeStatus = submissionStatus[activeFilter as keyof typeof submissionStatus] || '全部状态';
    const reportLabel = scope === 'all' || activeGroupId === null ? '整个批次' : activeGroup;
    const invalidToken = fileTokens.find(token => !attachmentNameTokens.some(value => value === token) &&
        !(token.startsWith(fieldPrefix) && answerFieldIds.includes(token.slice(fieldPrefix.length))));
    const invalidPattern = !collectionNaming && (!scheme.pattern.trim() || /[{}]/.test(scheme.pattern.replace(tokens, '')) || !!invalidToken);
    useEffect(() => {
        const controller = new AbortController();
        const { submissionIds, answerFieldIds, attachmentNamePattern } = JSON.parse(key) as { submissionIds: string[]; answerFieldIds: string[]; attachmentNamePattern: string };
        if (!submissionIds.length) {
            setManifest({ key, files: [], time: new Date().toISOString() });
            return;
        }
        api<{ files: ExportAttachment[]; attachmentNamePattern?: string }>(path + '/files', { submissionIds, answerFieldIds }, { signal: controller.signal })
            .then(({ files, attachmentNamePattern: currentPattern }) => {
                if (controller.signal.aborted) return;
                if ((currentPattern || '') !== attachmentNamePattern || files.some(file => Boolean(file.archiveName) !== Boolean(attachmentNamePattern))) {
                    setManifest({ key, files: [], time: '', error: '收集的汇总命名规则已更新，请刷新页面后重新打包。' });
                } else setManifest({ key, files, time: new Date().toISOString() });
            })
            .catch(error => { if (!controller.signal.aborted) setManifest({ key, files: [], time: '', error: errorText(error) }); });
        return () => controller.abort();
    }, [path, key, attempt]);

    const currentManifest = manifest?.key === key ? manifest : undefined;
    const entries = useMemo(() => currentManifest && !currentManifest.error && !invalidPattern ?
        makePlan({ files: currentManifest.files, attachmentRows, reportRows, scheme, title, round, reportLabel, selected, time: currentManifest.time }) : [],
    [currentManifest, invalidPattern, attachmentRows, reportRows, scheme, title, round, reportLabel, selected]);
    const counts = useMemo(() => collectionProgress(reportRows, selected).counts, [reportRows, selected]);
    const fileCount = entries.filter(entry => 'file' in entry).length;
    const fileBytes = entries.reduce((sum, entry) => sum + ('file' in entry ? entry.file.size : 0), 0);
    const zipName = zipSegment(archiveName.trim().replace(/\.zip$/i, '') || round.label) + '.zip';

    function chooseFolders(next: FolderLayer[]) { setScheme(previous => ({ ...previous, folders: next })); }
    function moveFolder(index: number, direction: number) {
        const next = [...scheme.folders];
        const target = index + direction;
        if (!next[index] || !next[target]) return;
        [next[index], next[target]] = [next[target], next[index]];
        chooseFolders(next);
    }
    function changePattern(display: string) {
        const pattern = display.replace(tokens, (whole, token: string) => {
            const id = labelIds.get(token);
            return id ? '{' + fieldPrefix + id + '}' : whole;
        });
        if (display.length > 320 || pattern.length > 320) return false;
        setScheme(previous => ({ ...previous, pattern }));
        return true;
    }
    function insertToken(token: string) {
        const input = nameInput.current;
        const at = input?.selectionStart ?? displayedPattern.length;
        const end = input?.selectionEnd ?? at;
        const part = '{' + token + '}';
        const display = displayedPattern.slice(0, at) + part + displayedPattern.slice(end);
        if (!changePattern(display)) return;
        requestAnimationFrame(() => {
            input?.focus();
            input?.setSelectionRange(at + part.length, at + part.length);
        });
    }
    function saveScheme() {
        try {
            const pattern = collectionNaming ? readScheme()?.pattern ?? scheme.pattern : scheme.pattern;
            localStorage.setItem(schemeKey, JSON.stringify({ ...scheme, pattern }));
            setHasPreset(true);
            setMessage(collectionNaming ? '目录和清单设置已保存在此浏览器。' : '方案已保存在此浏览器。');
        } catch (error) { setAttachmentError(errorText(error)); }
    }
    async function pack() {
        if (!entries.length || transfer.current) return;
        setAttachmentError('');
        const controller = new AbortController();
        transfer.current = controller;
        setWorking(true);
        setMessage('正在准备下载…');
        try {
            const attachments = entries.flatMap(entry => {
                if (!('file' in entry)) return [];
                const { id, submissionId, revision } = entry.file;
                return [{ id, submissionId, revision }];
            });
            const files = attachments.length ? (await api<{ files: SignedAttachment[] }>(path + '/files', { attachments }, { signal: controller.signal })).files : [];
            const signed = new Map(files.map(file => [exportAttachmentKey(file), file]));
            const authorized = entries.map(entry => {
                if (!('file' in entry)) return entry;
                const authorization = signed.get(exportAttachmentKey(entry.file));
                if (!authorization || authorization.archiveName !== entry.file.archiveName) throw new Error('附件清单或汇总文件名有变化，请刷新预览。');
                return { ...entry, file: { ...entry.file, download: authorization.download } };
            });
            await downloadZip(authorized, zipName, setMessage, controller.signal);
            setMessage('ZIP 已生成。');
        } catch (error) {
            if (!controller.signal.aborted) setAttachmentError(errorText(error));
            setMessage(controller.signal.aborted ? '已取消打包。' : '');
        } finally {
            transfer.current = null;
            setWorking(false);
        }
    }

    const pageCount = Math.ceil(entries.length / previewPageSize);
    const page = Math.max(0, Math.min(previewPage, pageCount - 1));
    const shown = entries.slice(page * previewPageSize, (page + 1) * previewPageSize);
    return <Dialog title="打包附件" onClose={onClose} wide busy={working}>
        <div className="cw-export">
            <div className="cw-export-body">
                <fieldset className="cw-export-settings" disabled={working} aria-label="导出设置">
                    <div className="cw-export-field">
                        <label htmlFor="cw-export-scope">附件范围</label>
                        <select id="cw-export-scope" value={scope} onChange={event => { setScope(event.target.value === 'all' ? 'all' : 'current'); setPreviewPage(0); setAttachmentError(''); }}>
                            <option value="current">当前筛选 · {activeGroup} · {activeStatus}</option>
                            <option value="all">整个批次</option>
                        </select>
                    </div>
                    <div className="cw-export-field">
                        <label htmlFor="cw-export-name">压缩包名称</label>
                        <input id="cw-export-name" maxLength={80} value={archiveName} onChange={event => setArchiveName(event.target.value)} />
                    </div>
                    <div className="cw-export-field">
                        <h3>目录层级</h3>
                        {scheme.folders.length > 0 && <ol className="cw-export-folders">
                            {scheme.folders.map((layer, index) => <li key={layer}><span><Folder size={16} />{folderNames[layer]}</span>
                                <span className="cw-export-folder-actions">
                                    <button type="button" className="cw-icon" disabled={index === 0} aria-label={'上移' + folderNames[layer]} onClick={() => moveFolder(index, -1)}><ArrowUp size={14} /></button>
                                    <button type="button" className="cw-icon" disabled={index === scheme.folders.length - 1} aria-label={'下移' + folderNames[layer]} onClick={() => moveFolder(index, 1)}><ArrowDown size={14} /></button>
                                    <button type="button" className="cw-icon" ref={index === scheme.folders.length - 1 ? lastFolderAction : undefined} aria-label={'移除' + folderNames[layer]} onClick={() => chooseFolders(scheme.folders.filter(value => value !== layer))}><X size={14} /></button>
                                </span></li>)}
                        </ol>}
                        {!scheme.folders.length && <p className="cw-muted">附件直接放在压缩包根目录。</p>}
                        {scheme.folders.length < Object.keys(folderNames).length && <select aria-label="添加目录层级" value="" onChange={event => {
                            const layer = event.target.value as FolderLayer;
                            if (Object.hasOwn(folderNames, layer) && !scheme.folders.includes(layer)) {
                                const next = [...scheme.folders, layer];
                                chooseFolders(next);
                                if (next.length === Object.keys(folderNames).length) requestAnimationFrame(() => lastFolderAction.current?.focus());
                            }
                        }}>
                            <option value="">添加目录层级</option>
                            {(Object.keys(folderNames) as FolderLayer[]).filter(layer => !scheme.folders.includes(layer))
                                .map(layer => <option key={layer} value={layer}>{folderNames[layer]}</option>)}
                        </select>}
                    </div>
                    {collectionNaming ? <div className="cw-export-field">
                        <label htmlFor="cw-export-pattern">汇总命名规则</label>
                        <input id="cw-export-pattern" value={displayedPattern} readOnly aria-describedby="cw-export-naming-help" />
                        <p id="cw-export-naming-help" className="cw-muted">沿用「收集设置」中的规则，扩展名按原附件保留。</p>
                    </div> : <div className="cw-export-field">
                        <label htmlFor="cw-export-pattern">附件命名</label>
                        <input id="cw-export-pattern" ref={nameInput} value={displayedPattern} maxLength={320} aria-describedby="cw-export-naming-help"
                            aria-invalid={invalidPattern} onChange={event => changePattern(event.target.value)} />
                        <p id="cw-export-naming-help" className="cw-muted">输入固定文字，或点选字段插入。扩展名按原附件保留。</p>
                        {invalidPattern && <p className="cw-failure">{invalidToken ? '命名中含有当前批次不可用的字段，请重新选择。' : '请填写附件命名规则，并补齐字段的括号。'}</p>}
                        <div className="cw-export-tokens">{attachmentNameTokens.map(token =>
                            <button type="button" key={token} className="cw-button" onClick={() => insertToken(token)}>{token}</button>)}</div>
                        {!!formFields.length && <select aria-label="插入表单字段" value="" onChange={event => {
                            const label = fieldLabels.get(event.target.value);
                            if (label) insertToken(label);
                        }}><option value="">插入表单字段</option>{formFields.map(field => <option key={field.id} value={field.id}>{field.label}</option>)}</select>}
                    </div>}
                    <div className="cw-export-field">
                        <h3>根目录附带</h3>
                        <label className="cw-check"><input type="checkbox" checked={scheme.statistics}
                            onChange={event => setScheme(previous => ({ ...previous, statistics: event.target.checked }))} />统计.txt</label>
                        {selected && <label className="cw-check"><input type="checkbox" checked={scheme.missing}
                            onChange={event => setScheme(previous => ({ ...previous, missing: event.target.checked }))} />未交名单.txt</label>}
                    </div>
                    <div className="cw-export-presets">
                        <button type="button" className="cw-button" disabled={invalidPattern} onClick={saveScheme}>{collectionNaming ? '保存目录和清单设置' : '保存方案'}</button>
                        {hasPreset && <button type="button" className="cw-button" onClick={() => {
                            const saved = readScheme();
                            if (saved) { setScheme(saved); setMessage(collectionNaming ? '已使用上次保存的目录和清单设置。' : '已使用上次保存的方案。'); }
                        }}>{collectionNaming ? '使用已保存的目录和清单设置' : '使用已保存方案'}</button>}
                    </div>
                </fieldset>
                <section className="cw-export-preview" aria-labelledby="cw-export-preview-title">
                    <h3 id="cw-export-preview-title">打包预览</h3>
                    <p className="cw-muted">{reportLabel} · {summaryLine(counts)}</p>
                    {currentManifest?.error ? <>
                        <p role="alert" className="cw-failure">{currentManifest.error}</p>
                        <button type="button" className="cw-button" onClick={() => { setManifest(undefined); retry(value => value + 1); }}>重试</button>
                    </> : !currentManifest ? <p className="cw-muted" role="status">正在读取附件清单…</p>
                        : entries.length ? <>
                            <p className="cw-muted">{fileCount} 个附件{fileCount ? ' · ' + bytes(fileBytes) : ''} · {entries.length - fileCount} 份清单</p>
                            <ZipTree entries={shown} name={zipName} />
                            {pageCount > 1 && <div className="cw-inline">
                                <button type="button" className="cw-button" disabled={page === 0} onClick={() => setPreviewPage(page - 1)}>上一页</button>
                                <span className="cw-muted" role="status">第 {page + 1} / {pageCount} 页</span>
                                <button type="button" className="cw-button" disabled={page + 1 === pageCount} onClick={() => setPreviewPage(page + 1)}>下一页</button>
                            </div>}
                        </> : <p className="cw-muted">{invalidPattern ? '命名规则有效后显示预览。' : '当前范围没有可打包的内容。'}</p>}
                </section>
            </div>
            <div className="cw-export-footer">
                <span className="cw-muted" role="status">{message}</span>
                {attachmentError && <span role="alert" className="cw-failure">{attachmentError}</span>}
                {attachmentError && !working && <button type="button" className="cw-button" onClick={() => { setAttachmentError(''); setManifest(undefined); retry(value => value + 1); }}>刷新预览</button>}
                {working ? <button type="button" className="cw-button" onClick={() => transfer.current?.abort()}>取消打包</button>
                    : <button type="button" className="cw-button cw-primary" disabled={!entries.length} onClick={() => void pack()}><Download size={17} />下载 ZIP</button>}
            </div>
        </div>
    </Dialog>;
}
