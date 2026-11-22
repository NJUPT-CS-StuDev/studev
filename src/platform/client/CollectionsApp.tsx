import { useEffect, useMemo, useRef, useState } from 'react';
import { api, errorText, fetchStorageDownload, saveBlob, type OrganizationNode, type StorageDownload } from './api';
import { isWithin } from '../organizations.mjs';
import './collections.css';

type RoundPolicy = 'strict' | 'allow-late' | 'closed';
type Status = 'submitted' | 'late' | 'missing';
type TargetMode = 'selected' | 'open';

interface FileSlot { id: string; name: string; extensions: string[]; maxBytes: number; }
interface IssuerView { userId: string; name: string; organizationId: string; organizationName: string; orgShortName: string; title: string; }
interface IssuerOption { organizationId: string; organizationName: string; orgShortName: string; title: string; label: string; }
interface Recipient { studentId: string; name: string; }
interface DirectoryPerson { id: string; studentId: string; name: string; status: string; organizationIds: string[]; }
interface RoundSummary { id: string; label: string; deadline: string; policy: RoundPolicy; fileCount: number; submittedCount: number; totalCount: number; myStatus: Status | null; }
interface CollectionItemSummary {
  id: string; term: string; termLabel: string; code: string; name: string; category: string;
  issuer: IssuerView; targetMode: TargetMode; recipientCount: number;
  inRecipients: boolean; isIssuer: boolean; inMine: boolean;
  rounds: RoundSummary[]; updatedAt: string;
}
interface Viewer { id: string; studentId: string; name: string; role: string; isStaff: boolean; inRecipients?: boolean; }
interface ListResponse {
  viewer: Viewer | null;
  organizations: OrganizationNode[];
  issuerOptions?: IssuerOption[];
  items: CollectionItemSummary[];
}

interface RoundDetail { id: string; label: string; deadline: string; policy: RoundPolicy; files: FileSlot[]; }
interface RoundStat { roundId: string; total: number; submitted: number; late: number; missing: number; }
interface StudentFile { fileId: string; storedName: string; sizeBytes: number; submittedAt: string; revisions: number; canDownload: boolean; }
interface BoardRow { studentId: string; rawStudentId?: string; name: string; orgLabel: string; isMe: boolean; statuses: Record<string, Status>; filesByRound: Record<string, StudentFile[]>; }
interface DetailResponse {
  viewer: Viewer | null;
  item: {
    id: string; term: string; termLabel: string; code: string; name: string; category: string;
    issuer: IssuerView; targetMode: TargetMode; recipientCount: number; recipients?: Recipient[];
    rounds: RoundDetail[];
  };
  roundStats: RoundStat[];
  board: BoardRow[] | null;
}

const STATUS_LABEL: Record<Status, string> = { submitted: '已提交', late: '迟交', missing: '未提交' };
const STATUS_SYMBOL: Record<Status, string> = { submitted: '✓', late: '迟', missing: '×' };
const POLICY_LABEL: Record<RoundPolicy, string> = { strict: '到点截止', 'allow-late': '超时记为迟交', closed: '已关闭' };

function formatBytes(bytes: number): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDateTime(iso: string): string {
  if (!iso) return '不限';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toLocalInput(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function orgIndentLabel(org: OrganizationNode): string {
  return `${'　'.repeat(org.depth)}${org.depth ? '└ ' : ''}${org.name}`;
}

/** Minimal zero-dependency ZIP builder (STORE mode) for client-side batch download from OSCA. */
function buildZip(entries: { name: string; data: Uint8Array }[]): Blob {
  const enc = new TextEncoder();
  const crcTable = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    crcTable[i] = c >>> 0;
  }
  const crc32 = (buf: Uint8Array) => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    const crc = crc32(e.data);
    const lh = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, e.data.length, true);
    lv.setUint32(22, e.data.length, true);
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
    cv.setUint32(20, e.data.length, true);
    cv.setUint32(24, e.data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    ch.set(nameBytes, 46);
    centrals.push(ch);
    offset += lh.length + e.data.length;
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

interface OrgPeoplePickerProps {
  organizations: OrganizationNode[];
  people: DirectoryPerson[];
  selected: Map<string, string>;
  onChange: (next: Map<string, string>) => void;
}

function OrgPeoplePicker({ organizations, people, selected, onChange }: OrgPeoplePickerProps) {
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(organizations.filter((o) => o.depth === 0).map((o) => o.id)));
  const [extraSid, setExtraSid] = useState('');
  const [extraName, setExtraName] = useState('');

  const subtreePeople = useMemo(() => {
    const map = new Map<string, DirectoryPerson[]>();
    for (const org of organizations) {
      map.set(org.id, people.filter((p) => p.organizationIds.some((oid) => isWithin(oid, org.id, organizations))));
    }
    return map;
  }, [organizations, people]);

  const directPeople = useMemo(() => {
    const map = new Map<string, DirectoryPerson[]>();
    for (const org of organizations) {
      map.set(org.id, people.filter((p) => p.organizationIds.includes(org.id)));
    }
    return map;
  }, [organizations, people]);

  const toggleOrg = (orgId: string) => {
    const list = subtreePeople.get(orgId) || [];
    if (!list.length) return;
    const allSelected = list.every((p) => selected.has(p.studentId));
    const next = new Map(selected);
    if (allSelected) {
      for (const p of list) next.delete(p.studentId);
    } else {
      for (const p of list) next.set(p.studentId, p.name);
    }
    onChange(next);
  };

  const togglePerson = (sid: string, name: string) => {
    const next = new Map(selected);
    if (next.has(sid)) next.delete(sid);
    else next.set(sid, name);
    onChange(next);
  };

  const toggleExpand = (orgId: string) => {
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(orgId)) next.delete(orgId);
      else next.add(orgId);
      return next;
    });
  };

  const addExtra = () => {
    const sid = extraSid.normalize('NFKC').trim().toUpperCase();
    const name = extraName.normalize('NFKC').trim();
    if (!/^[A-Z0-9]{4,24}$/.test(sid) || !name) return;
    const next = new Map(selected);
    next.set(sid, name);
    onChange(next);
    setExtraSid('');
    setExtraName('');
  };

  const qText = search.trim().normalize('NFKC').toLowerCase();
  const searchMatches = qText
    ? people.filter((p) => p.studentId.toLowerCase().includes(qText) || p.name.toLowerCase().includes(qText))
    : [];

  const renderBranch = (parentId: string | null) => {
    const children = organizations.filter((o) => (o.parentId ?? null) === parentId);
    return children.map((org) => {
      const subList = subtreePeople.get(org.id) || [];
      const dirList = directPeople.get(org.id) || [];
      const hasSubOrgs = organizations.some((o) => o.parentId === org.id);
      const isOpen = expanded.has(org.id);
      const checkedCount = subList.filter((p) => selected.has(p.studentId)).length;
      const allChecked = subList.length > 0 && checkedCount === subList.length;
      const partial = checkedCount > 0 && checkedCount < subList.length;

      return (
        <div key={org.id}>
          <div className="col-tree-row" style={{ paddingLeft: `${org.depth * 18 + 4}px` }}>
            <button
              type="button"
              className="col-tree-toggle"
              aria-label={isOpen ? `收起${org.name}` : `展开${org.name}`}
              onClick={() => toggleExpand(org.id)}
              style={{ visibility: hasSubOrgs || dirList.length ? 'visible' : 'hidden' }}
            >
              {isOpen ? '▾' : '▸'}
            </button>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', flex: 1 }}>
              <input
                type="checkbox"
                checked={allChecked}
                ref={(el) => { if (el) el.indeterminate = partial; }}
                disabled={!subList.length}
                onChange={() => toggleOrg(org.id)}
              />
              <span>{org.name}</span>
              <span className="col-meta">({checkedCount ? `${checkedCount}/${subList.length}` : subList.length} 人)</span>
            </label>
          </div>
          {isOpen && (
            <>
              {renderBranch(org.id)}
              {dirList.length > 0 && (
                <div className="col-tree-people" style={{ paddingLeft: `${(org.depth + 1) * 18 + 24}px` }}>
                  {dirList.map((p) => {
                    const on = selected.has(p.studentId);
                    return (
                      <label key={p.studentId} className={`col-person-chip ${on ? 'on' : ''}`}>
                        <input type="checkbox" checked={on} onChange={() => togglePerson(p.studentId, p.name)} />
                        <span>{p.name}</span>
                        <span className="col-meta" style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{p.studentId}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      );
    });
  };

  return (
    <div className="col-picker">
      <div className="col-picker-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <input
            type="search"
            placeholder="搜索学号或姓名"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ height: 30, padding: '0 10px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--paper)', color: 'var(--ink)', font: 'inherit', fontSize: 12.5, width: 180 }}
          />
          <span className="col-meta">已选 <b style={{ color: 'var(--ink)' }}>{selected.size}</b> 人</span>
        </div>
        {selected.size > 0 && (
          <button type="button" className="col-btn" style={{ height: 28, fontSize: 12 }} onClick={() => onChange(new Map())}>清空</button>
        )}
      </div>

      <div className="col-picker-tree">
        {qText ? (
          searchMatches.length ? (
            <div className="col-tree-people" style={{ padding: 6 }}>
              {searchMatches.map((p) => {
                const on = selected.has(p.studentId);
                return (
                  <label key={p.studentId} className={`col-person-chip ${on ? 'on' : ''}`}>
                    <input type="checkbox" checked={on} onChange={() => togglePerson(p.studentId, p.name)} />
                    <span>{p.name}</span>
                    <span className="col-meta" style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{p.studentId}</span>
                  </label>
                );
              })}
            </div>
          ) : (
            <p className="col-meta" style={{ padding: 8, margin: 0 }}>未找到匹配成员，可在下方按学号临时补充。</p>
          )
        ) : (
          renderBranch(null)
        )}
      </div>

      <div className="col-picker-extra">
        <span className="col-meta">补充校内其他同学：</span>
        <input
          placeholder="学号"
          value={extraSid}
          onChange={(e) => setExtraSid(e.target.value)}
          style={{ height: 28, padding: '0 8px', border: '1px solid var(--line)', borderRadius: 6, background: 'var(--paper)', color: 'var(--ink)', font: 'inherit', fontSize: 12, width: 110 }}
        />
        <input
          placeholder="姓名"
          value={extraName}
          onChange={(e) => setExtraName(e.target.value)}
          style={{ height: 28, padding: '0 8px', border: '1px solid var(--line)', borderRadius: 6, background: 'var(--paper)', color: 'var(--ink)', font: 'inherit', fontSize: 12, width: 96 }}
        />
        <button type="button" className="col-btn" style={{ height: 28, fontSize: 12 }} onClick={addExtra}>添加</button>
      </div>
    </div>
  );
}

const LIST_CACHE_KEY = 'studev_collections_list_v2';
const detailCache = new Map<string, DetailResponse>();

function readListCache(): ListResponse | null {
  try {
    const raw = sessionStorage.getItem(LIST_CACHE_KEY) || localStorage.getItem(LIST_CACHE_KEY);
    return raw ? (JSON.parse(raw) as ListResponse) : null;
  } catch {
    return null;
  }
}

function writeListCache(data: ListResponse) {
  try {
    const raw = JSON.stringify(data);
    sessionStorage.setItem(LIST_CACHE_KEY, raw);
    localStorage.setItem(LIST_CACHE_KEY, raw);
  } catch { /* ignore quota */ }
}

export default function CollectionsApp() {
  const [listData, setListData] = useState<ListResponse | null>(() => readListCache());
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [orgFilter, setOrgFilter] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [roundId, setRoundId] = useState<string | null>(null);
  const [boardOrgFilter, setBoardOrgFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | Status>('ALL');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [toast, setToast] = useState('');

  // People directory for the org-tree picker (staff only, lazy loaded)
  const [directory, setDirectory] = useState<{ organizations: OrganizationNode[]; people: DirectoryPerson[] } | null>(null);

  // Create collection form
  const [cIssuerKey, setCIssuerKey] = useState('');
  const [cTerm, setCTerm] = useState('2026-2027-1');
  const [cTermLabel, setCTermLabel] = useState('2026–2027 学年第一学期');
  const [cCode, setCCode] = useState('');
  const [cName, setCName] = useState('');
  const [cCategory, setCCategory] = useState('课程实验');
  const [cTargetMode, setCTargetMode] = useState<TargetMode>('selected');
  const [cRecipients, setCRecipients] = useState<Map<string, string>>(new Map());
  const [cRoundLabel, setCRoundLabel] = useState('第1次');
  const [cDeadline, setCDeadline] = useState('');
  const [cFileName, setCFileName] = useState('实验报告');
  const [cFileExts, setCFileExts] = useState('doc, docx, pdf');

  // Detail admin edits
  const [dlDraft, setDlDraft] = useState('');
  const [polDraft, setPolDraft] = useState<RoundPolicy>('strict');
  const [nrLabel, setNrLabel] = useState('');
  const [nrFile, setNrFile] = useState('作业报告');
  const [nrExts, setNrExts] = useState('doc, docx, pdf');
  const [nrDl, setNrDl] = useState('');
  const [editRecMode, setEditRecMode] = useState<TargetMode>('selected');
  const [editRecMap, setEditRecMap] = useState<Map<string, string>>(new Map());

  const fileInput = useRef<HTMLInputElement>(null);
  const pendingUpload = useRef<{ itemId: string; roundId: string; fileId: string } | null>(null);

  const notify = (msg: string) => {
    setToast(msg);
    window.clearTimeout((notify as unknown as { t?: number }).t);
    (notify as unknown as { t?: number }).t = window.setTimeout(() => setToast(''), 3200);
  };

  const ensureDirectory = async () => {
    if (directory) return;
    try {
      const res = await api<{ organizations: OrganizationNode[]; people: DirectoryPerson[] }>('/collections/people');
      setDirectory(res);
    } catch (e) {
      notify(errorText(e));
    }
  };

  const loadList = async () => {
    if (!listData) setLoading(true);
    try {
      const data = await api<ListResponse>('/collections');
      setListData(data);
      writeListCache(data);
      if (!data.viewer) setScope('all');
      if (data.issuerOptions?.length && !cIssuerKey) {
        const first = data.issuerOptions[0]!;
        setCIssuerKey(`${first.organizationId}::${first.title}`);
      }
    } catch (e) {
      notify(errorText(e));
    } finally {
      setLoading(false);
    }
  };

  const loadDetail = async (id: string, preferRound?: string) => {
    const cached = detailCache.get(id);
    if (cached) {
      setDetail(cached);
      setSelectedId(id);
      setRoundId(preferRound || cached.item.rounds[cached.item.rounds.length - 1]?.id || null);
    } else {
      setLoading(true);
    }
    try {
      const data = await api<DetailResponse>(`/collections/items/${encodeURIComponent(id)}`);
      detailCache.set(id, data);
      setDetail(data);
      setSelectedId(id);
      const target = preferRound || data.item.rounds[data.item.rounds.length - 1]?.id || null;
      setRoundId(target);
      setBoardOrgFilter('ALL');
      setStatusFilter('ALL');
      setEditRecMode(data.item.targetMode);
      setEditRecMap(new Map((data.item.recipients || []).map((r) => [r.studentId, r.name])));
    } catch (e) {
      notify(errorText(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const id = new URLSearchParams(location.search).get('id');
    void loadList();
    if (id) void loadDetail(id);
  }, []);

  const activeRound = useMemo(() => detail?.item.rounds.find((r) => r.id === roundId) || detail?.item.rounds[0] || null, [detail, roundId]);

  useEffect(() => {
    if (!activeRound) return;
    setDlDraft(toLocalInput(activeRound.deadline));
    setPolDraft(activeRound.policy);
  }, [activeRound?.id, activeRound?.deadline, activeRound?.policy]);

  const viewer = detail?.viewer ?? listData?.viewer ?? null;
  const isStaff = Boolean(viewer?.isStaff);
  const organizations = listData?.organizations || [];
  const effectiveScope: 'mine' | 'all' = viewer ? scope : 'all';

  const handleUpload = async (file: File | undefined) => {
    if (!file || !pendingUpload.current) return;
    const { itemId, roundId: rid, fileId } = pendingUpload.current;
    setBusy('正在上传…');
    try {
      const pre = await api<{ upload: { url: string; headers?: Record<string, string> }; objectKey: string; storedName: string }>(
        `/collections/items/${encodeURIComponent(itemId)}/rounds/${encodeURIComponent(rid)}/presign`,
        { method: 'POST', body: { fileId, fileName: file.name, sizeBytes: file.size, contentType: file.type || 'application/octet-stream' } }
      );
      const putRes = await fetch(pre.upload.url, { method: 'PUT', headers: pre.upload.headers || { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
      if (!putRes.ok) throw new Error(`上传文件失败（${putRes.status}）`);
      await api(`/collections/items/${encodeURIComponent(itemId)}/rounds/${encodeURIComponent(rid)}/confirm`, {
        method: 'POST',
        body: { fileId, objectKey: pre.objectKey, originalName: file.name, storedName: pre.storedName, sizeBytes: file.size },
      });
      notify(`已保存：${pre.storedName}`);
      await loadDetail(itemId, rid);
      void loadList();
    } catch (e) {
      notify(errorText(e));
    } finally {
      setBusy('');
    }
  };

  const downloadSingle = async (itemId: string, rid: string, fileId: string, studentId?: string) => {
    try {
      const q = new URLSearchParams({ fileId, ...(studentId ? { studentId } : {}) });
      const res = await api<{ download: StorageDownload; storedName: string }>(`/collections/items/${encodeURIComponent(itemId)}/rounds/${encodeURIComponent(rid)}/download?${q}`);
      const response = await fetchStorageDownload(res.download);
      saveBlob(await response.blob(), res.storedName);
    } catch (e) {
      notify(errorText(e));
    }
  };

  const downloadZip = async (itemId: string, rid: string) => {
    setBusy('正在打包 ZIP…');
    try {
      const res = await api<{ zipName: string; files: (StorageDownload & { path: string; sizeBytes: number })[] }>(`/collections/items/${encodeURIComponent(itemId)}/rounds/${encodeURIComponent(rid)}/files`);
      if (!res.files.length) { notify('当前批次还没有可打包的提交文件'); return; }
      const encoder = new TextEncoder();
      const zipBytes = res.files.reduce((bytes, file) => bytes + file.sizeBytes + 76 + 2 * encoder.encode(file.path).length, 22);
      if (res.files.length > 65535 || zipBytes > 0xffffffff) throw new Error('批次超出 ZIP 大小上限，请分别下载文件。');
      const entries = new Array<{ name: string; data: Uint8Array }>(res.files.length);
      let next = 0;
      let done = 0;
      let failure: unknown;
      async function downloadFiles() {
        while (!failure && next < res.files.length) {
          const index = next++;
          const file = res.files[index]!;
          try {
            const response = await fetchStorageDownload(file);
            entries[index] = { name: file.path, data: new Uint8Array(await response.arrayBuffer()) };
            setBusy(`正在拉取文件 (${++done}/${res.files.length})…`);
          } catch (error) {
            failure = error;
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(6, res.files.length) }, downloadFiles));
      if (failure) throw failure;
      saveBlob(buildZip(entries), res.zipName);
      notify(`已打包 ${entries.length} 份文件`);
    } catch (e) {
      notify(errorText(e));
    } finally {
      setBusy('');
    }
  };

  const createItem = async () => {
    const [issuerOrganizationId, issuerTitle] = cIssuerKey.split('::');
    if (!issuerOrganizationId) { notify('请选择发布身份'); return; }
    if (!cName.trim()) { notify('请填写收集名称'); return; }
    if (cTargetMode === 'selected' && cRecipients.size === 0) { notify('请从组织树中选择应交人员，或切换为公开收集'); return; }
    setBusy('正在发布…');
    try {
      const recipients = [...cRecipients.entries()].map(([studentId, name]) => ({ studentId, name }));
      const res = await api<{ item: { id: string } }>('/collections/items', {
        method: 'POST',
        body: {
          issuerOrganizationId,
          issuerTitle: issuerTitle || '',
          term: cTerm, termLabel: cTermLabel, code: cCode.trim(), name: cName.trim(), category: cCategory.trim() || '材料收集',
          targetMode: cTargetMode,
          recipients,
          roundLabel: cRoundLabel.trim() || '第1次',
          deadline: cDeadline ? new Date(cDeadline).toISOString() : '',
          policy: 'strict',
          files: [{ name: cFileName.trim() || '文件', extensions: cFileExts }],
        },
      });
      setCreateOpen(false);
      setCName('');
      setCCode('');
      setCRecipients(new Map());
      notify('已发布收集');
      await loadList();
      await loadDetail(res.item.id);
    } catch (e) {
      notify(errorText(e));
    } finally {
      setBusy('');
    }
  };

  const saveRecipients = async () => {
    if (!detail) return;
    setBusy('正在保存名单…');
    try {
      const recipients = [...editRecMap.entries()].map(([studentId, name]) => ({ studentId, name }));
      await api(`/collections/items/${encodeURIComponent(detail.item.id)}/recipients`, {
        method: 'POST',
        body: { targetMode: editRecMode, recipients },
      });
      notify('已更新应交名单');
      await loadDetail(detail.item.id, activeRound?.id);
      void loadList();
    } catch (e) {
      notify(errorText(e));
    } finally {
      setBusy('');
    }
  };

  const saveRound = async () => {
    if (!detail || !activeRound) return;
    setBusy('正在保存…');
    try {
      await api(`/collections/items/${encodeURIComponent(detail.item.id)}/rounds/${encodeURIComponent(activeRound.id)}`, {
        method: 'POST',
        body: { deadline: dlDraft ? new Date(dlDraft).toISOString() : '', policy: polDraft },
      });
      notify('已更新截止设置');
      await loadDetail(detail.item.id, activeRound.id);
    } catch (e) {
      notify(errorText(e));
    } finally {
      setBusy('');
    }
  };

  const createRound = async () => {
    if (!detail || !nrLabel.trim()) { notify('请填写批次名称'); return; }
    setBusy('正在新建批次…');
    try {
      const res = await api<{ round: { id: string } }>(`/collections/items/${encodeURIComponent(detail.item.id)}/rounds`, {
        method: 'POST',
        body: { label: nrLabel.trim(), deadline: nrDl ? new Date(nrDl).toISOString() : '', policy: 'strict', files: [{ name: nrFile.trim() || '文件', extensions: nrExts }] },
      });
      setNrLabel('');
      notify('已新建批次');
      await loadDetail(detail.item.id, res.round.id);
    } catch (e) {
      notify(errorText(e));
    } finally {
      setBusy('');
    }
  };

  const copyMissing = () => {
    if (!detail || !activeRound || !detail.board) return;
    const list = detail.board
      .filter((row) => boardOrgFilter === 'ALL' || row.orgLabel === boardOrgFilter)
      .filter((row) => row.statuses[activeRound.id] === 'missing');
    const txt = `【未交提醒】${detail.item.name} · ${activeRound.label}${activeRound.deadline ? `（截止 ${formatDateTime(activeRound.deadline)}）` : ''}\n未交 ${list.length} 人：${list.map((x) => x.name).join('、') || '全员已交'}`;
    navigator.clipboard.writeText(txt).then(() => notify(`已复制 ${list.length} 人未交名单`)).catch(() => notify(txt));
  };

  const visibleItems = (listData?.items || []).filter((it) => {
    if (effectiveScope === 'mine' && !it.inMine) return false;
    if (orgFilter && (!it.issuer.organizationId || !isWithin(it.issuer.organizationId, orgFilter, organizations))) return false;
    return true;
  });

  const byTerm = new Map<string, CollectionItemSummary[]>();
  for (const it of visibleItems) {
    const arr = byTerm.get(it.termLabel) || [];
    arr.push(it);
    byTerm.set(it.termLabel, arr);
  }

  const openTodos = viewer ? (listData?.items || []).flatMap((it) =>
    it.inRecipients ? it.rounds.filter((r) => r.policy !== 'closed').map((r) => ({ it, r })) : []
  ) : [];

  return (
    <div className="col-app">
      <input ref={fileInput} type="file" hidden onChange={(e) => { void handleUpload(e.target.files?.[0]); e.target.value = ''; }} />

      {!selectedId || !detail ? (
        <>
          <div className="col-bar">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <h1 style={{ margin: 0, fontSize: 26, fontWeight: 600, letterSpacing: '-.02em', lineHeight: 1.2 }}>收集</h1>
              {viewer && (
                <div className="col-seg" role="tablist" aria-label="范围筛选">
                  <button className={effectiveScope === 'mine' ? 'on' : ''} onClick={() => setScope('mine')}>与我相关</button>
                  <button className={effectiveScope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>全部</button>
                </div>
              )}
              {organizations.length > 0 && (
                <select className="col-select" aria-label="按组织筛选" value={orgFilter} onChange={(e) => setOrgFilter(e.target.value)}>
                  <option value="">全部组织</option>
                  {organizations.map((org) => (
                    <option key={org.id} value={org.id}>{orgIndentLabel(org)}</option>
                  ))}
                </select>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {busy && <span className="col-meta">{busy}</span>}
              {!viewer && <a className="col-btn primary" href={`/login/?next=${encodeURIComponent(location.pathname + location.search)}`}>登录</a>}
              {isStaff && (
                <button
                  className="col-btn primary"
                  onClick={() => {
                    const next = !createOpen;
                    setCreateOpen(next);
                    if (next) void ensureDirectory();
                  }}
                >
                  {createOpen ? '收起' : '+ 发布收集'}
                </button>
              )}
            </div>
          </div>

          {isStaff && createOpen && (
            <section className="col-panel" style={{ marginTop: 0 }}>
              <div className="col-panel-h"><h3>发布新收集</h3></div>
              <div className="col-form-row">
                <label className="col-field" style={{ minWidth: 220 }}>
                  发布身份（决定所属组织）
                  <select value={cIssuerKey} onChange={(e) => setCIssuerKey(e.target.value)}>
                    {(listData?.issuerOptions || []).map((opt) => (
                      <option key={`${opt.organizationId}::${opt.title}`} value={`${opt.organizationId}::${opt.title}`}>{opt.label}</option>
                    ))}
                  </select>
                </label>
                <label className="col-field" style={{ minWidth: 180 }}>名称<input placeholder="例如：计算机通信与网络" value={cName} onChange={(e) => setCName(e.target.value)} /></label>
                <label className="col-field">类别<input placeholder="课程实验 / 活动材料" value={cCategory} onChange={(e) => setCCategory(e.target.value)} /></label>
                <label className="col-field">课程号（选填）<input placeholder="如 JS160201S" value={cCode} onChange={(e) => setCCode(e.target.value)} /></label>
                <label className="col-field">学期<input value={cTerm} onChange={(e) => setCTerm(e.target.value)} /></label>
                <label className="col-field">学期显示名<input value={cTermLabel} onChange={(e) => setCTermLabel(e.target.value)} /></label>
                <label className="col-field">首个批次<input value={cRoundLabel} onChange={(e) => setCRoundLabel(e.target.value)} /></label>
                <label className="col-field">提交文件<input value={cFileName} onChange={(e) => setCFileName(e.target.value)} /></label>
                <label className="col-field">允许后缀<input value={cFileExts} onChange={(e) => setCFileExts(e.target.value)} /></label>
                <label className="col-field">截止时间<input type="datetime-local" value={cDeadline} onChange={(e) => setCDeadline(e.target.value)} /></label>
              </div>

              <div style={{ marginTop: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <span className="col-meta">面向人员：</span>
                  <div className="col-seg">
                    <button type="button" className={cTargetMode === 'selected' ? 'on' : ''} onClick={() => setCTargetMode('selected')}>指定人员</button>
                    <button type="button" className={cTargetMode === 'open' ? 'on' : ''} onClick={() => setCTargetMode('open')}>公开收集（不限名单）</button>
                  </div>
                </div>
                {cTargetMode === 'selected' && (
                  directory ? (
                    <OrgPeoplePicker
                      organizations={directory.organizations}
                      people={directory.people}
                      selected={cRecipients}
                      onChange={setCRecipients}
                    />
                  ) : (
                    <p className="col-meta" style={{ marginTop: 8 }}>正在加载组织与成员…</p>
                  )
                )}
              </div>

              <div style={{ marginTop: 14 }}>
                <button className="col-btn primary" onClick={() => void createItem()}>发布</button>
              </div>
            </section>
          )}

          {effectiveScope === 'mine' && openTodos.length > 0 && (
            <section className="col-todo">
              <h4>待交</h4>
              <div className="col-todo-list">
                {openTodos.map(({ it, r }) => {
                  const st = r.myStatus || 'missing';
                  return (
                    <button key={`${it.id}-${r.id}`} className="col-todo-item" onClick={() => void loadDetail(it.id, r.id)}>
                      <span className={`col-dot ${st}`} />
                      <b>{it.name}</b>
                      <span className="col-meta">{r.label}</span>
                      <span className={`col-badge ${st}`}>{STATUS_LABEL[st]}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {loading && !listData ? <p className="col-meta">正在加载…</p> : visibleItems.length === 0 ? (
            <p className="col-meta">
              {orgFilter ? '该组织下暂无收集项目。' : effectiveScope === 'mine' ? '当前没有与你相关的收集，可以切换到「全部」浏览。' : '还没有发布收集项目。'}
            </p>
          ) : (
            [...byTerm.entries()].map(([termLabel, list]) => (
              <section key={termLabel}>
                <div className="col-term"><h2>{termLabel}</h2></div>
                <div className="col-grid">
                  {list.map((it) => {
                    const hasOpen = it.rounds.some((r) => r.policy !== 'closed');
                    const issuerLabel = it.issuer.title
                      ? `${it.issuer.orgShortName} · ${it.issuer.title}`
                      : (it.issuer.orgShortName || it.issuer.name);
                    return (
                      <button key={it.id} className="col-card" onClick={() => void loadDetail(it.id)}>
                        <div className="col-card-top">
                          <span className={`col-code ${it.code ? '' : 'org'}`}>{it.code || it.issuer.orgShortName}</span>
                          <span className="col-meta">{issuerLabel}</span>
                        </div>
                        <h3>{it.name}</h3>
                        <div className="col-chips">
                          <span className={`col-chip ${hasOpen ? 'open' : ''}`}>{it.category} · {it.rounds.length} 批{hasOpen ? ' · 进行中' : ''}</span>
                          <span className="col-chip">{it.targetMode === 'open' ? '公开收集' : `${it.recipientCount} 人`}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))
          )}

          {isStaff && (
            <p className="col-meta" style={{ marginTop: 32, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <a href="/members/" style={{ color: 'var(--muted)', textDecoration: 'underline', textUnderlineOffset: 3 }}>组织与成员管理</a>
              <a href="/admin/" style={{ color: 'var(--muted)', textDecoration: 'underline', textUnderlineOffset: 3 }}>通用问卷与表单管理</a>
            </p>
          )}
        </>
      ) : activeRound ? (() => {
        const stat = detail.roundStats.find((s) => s.roundId === activeRound.id) || { total: 0, submitted: 0, late: 0, missing: 0 };
        const pct = stat.total ? Math.round(((stat.submitted + stat.late) / stat.total) * 100) : 0;
        const myRow = detail.board?.find((r) => r.isMe) || null;
        const boardOrgs = [...new Set((detail.board || []).map((r) => r.orgLabel).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
        const rows = (detail.board || [])
          .filter((r) => boardOrgFilter === 'ALL' || r.orgLabel === boardOrgFilter)
          .filter((r) => statusFilter === 'ALL' || r.statuses[activeRound.id] === statusFilter)
          .sort((a, b) => (a.isMe ? -1 : b.isMe ? 1 : a.studentId.localeCompare(b.studentId)));
        const issuerSummary = `${detail.item.issuer.organizationName || detail.item.issuer.orgShortName}${detail.item.issuer.title ? ` · ${detail.item.issuer.title}` : ''}`;

        return (
          <>
            <button className="col-back" onClick={() => { setSelectedId(null); setDetail(null); }}>‹ 返回</button>
            <div className="col-head">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {detail.item.code && <span className="col-code">{detail.item.code}</span>}
                <span className="col-meta">{detail.item.termLabel} · {detail.item.category}</span>
              </div>
              <h1>{detail.item.name}</h1>
              <p>
                {issuerSummary}{detail.item.issuer.name ? `（${detail.item.issuer.name}）` : ''}发起 · {detail.item.targetMode === 'open' ? `公开收集（已交 ${detail.item.recipientCount} 人）` : `面向 ${detail.item.recipientCount} 人`} · {POLICY_LABEL[activeRound.policy]}
              </p>
            </div>

            {detail.item.rounds.length > 1 && (
              <div className="col-rounds">
                {detail.item.rounds.map((r) => (
                  <button key={r.id} className={`col-rpill ${r.id === activeRound.id ? 'on' : ''}`} onClick={() => setRoundId(r.id)}>{r.label}</button>
                ))}
              </div>
            )}

            <section className="col-panel">
              <div className="col-panel-h">
                <h3>{activeRound.label}</h3>
                <span className="col-meta">截止：{formatDateTime(activeRound.deadline)}</span>
              </div>
              {!viewer ? (
                <div className="col-slot">
                  <div className="col-slot-info">
                    <div className="col-slot-title">{activeRound.files.map((f) => f.name).join(' / ')}</div>
                    <div className="col-slot-req">登录后自动匹配你的学号并提交。</div>
                  </div>
                  <a className="col-btn primary" href={`/login/?next=${encodeURIComponent(`${location.pathname}?id=${detail.item.id}`)}`}>登录提交</a>
                </div>
              ) : activeRound.files.map((f) => {
                const sub = myRow?.filesByRound[activeRound.id]?.find((s) => s.fileId === f.id) || null;
                const st: Status = sub ? (activeRound.deadline && Date.parse(sub.submittedAt) > Date.parse(activeRound.deadline) ? 'late' : 'submitted') : 'missing';
                const canSubmit = activeRound.policy !== 'closed' && (viewer.inRecipients || isStaff);
                return (
                  <div key={f.id} className="col-slot">
                    <div className="col-slot-info">
                      <div className="col-slot-title">{f.name} {viewer.inRecipients && <span className={`col-badge ${st}`}>{STATUS_LABEL[st]}</span>}</div>
                      <div className="col-slot-req">.{f.extensions.join(' / .')} · 上限 {Math.round(f.maxBytes / 1048576)} MB</div>
                      {sub && (
                        <div className="col-slot-file">
                          <button type="button" style={{ border: 0, background: 'none', padding: 0, color: 'var(--brand)', font: 'inherit', cursor: 'pointer' }} onClick={() => void downloadSingle(detail.item.id, activeRound.id, f.id)}>{sub.storedName}</button>
                          <span className="col-meta">{formatBytes(sub.sizeBytes)} · {formatDateTime(sub.submittedAt)}{sub.revisions > 1 ? ` · 第 ${sub.revisions} 版` : ''}</span>
                        </div>
                      )}
                    </div>
                    <div>
                      {canSubmit ? (
                        <button className={`col-btn ${sub ? '' : 'primary'}`} onClick={() => { pendingUpload.current = { itemId: detail.item.id, roundId: activeRound.id, fileId: f.id }; fileInput.current?.click(); }}>
                          {sub ? '替换提交' : '上传文件'}
                        </button>
                      ) : <span className="col-meta">{activeRound.policy === 'closed' ? '已关闭' : '无需提交'}</span>}
                    </div>
                  </div>
                );
              })}

              {isStaff && (
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <button className="col-btn" onClick={copyMissing}>复制未交名单 ({stat.missing})</button>
                    <a className="col-btn" href={`/api/platform/collections/items/${encodeURIComponent(detail.item.id)}/rounds/${encodeURIComponent(activeRound.id)}/csv`}>导出 CSV</a>
                    <button className="col-btn primary" onClick={() => void downloadZip(detail.item.id, activeRound.id)}>打包下载 ZIP</button>
                  </div>
                  <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 12 }}>
                    <details>
                      <summary style={{ cursor: 'pointer', color: 'var(--muted)', fontSize: 13 }}>修改截止与状态</summary>
                      <div className="col-form-row" style={{ marginTop: 10 }}>
                        <label className="col-field">截止时间<input type="datetime-local" value={dlDraft} onChange={(e) => setDlDraft(e.target.value)} /></label>
                        <label className="col-field">
                          状态
                          <select value={polDraft} onChange={(e) => setPolDraft(e.target.value as RoundPolicy)}>
                            <option value="strict">开放提交（到点截止）</option>
                            <option value="allow-late">开放提交（超时记为迟交）</option>
                            <option value="closed">已关闭</option>
                          </select>
                        </label>
                        <button className="col-btn primary" onClick={() => void saveRound()}>保存</button>
                      </div>
                    </details>
                    <details>
                      <summary style={{ cursor: 'pointer', color: 'var(--brand)', fontSize: 13 }}>+ 新建批次</summary>
                      <div className="col-form-row" style={{ marginTop: 10 }}>
                        <label className="col-field">名称<input placeholder={`例如：第${detail.item.rounds.length + 1}次`} value={nrLabel} onChange={(e) => setNrLabel(e.target.value)} /></label>
                        <label className="col-field">提交文件<input value={nrFile} onChange={(e) => setNrFile(e.target.value)} /></label>
                        <label className="col-field">允许后缀<input value={nrExts} onChange={(e) => setNrExts(e.target.value)} /></label>
                        <label className="col-field">截止时间<input type="datetime-local" value={nrDl} onChange={(e) => setNrDl(e.target.value)} /></label>
                        <button className="col-btn primary" onClick={() => void createRound()}>创建</button>
                      </div>
                    </details>
                    <details onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open) void ensureDirectory(); }}>
                      <summary style={{ cursor: 'pointer', color: 'var(--muted)', fontSize: 13 }}>调整应交名单</summary>
                      <div style={{ marginTop: 10, minWidth: 320 }}>
                        <div className="col-seg" style={{ marginBottom: 8 }}>
                          <button type="button" className={editRecMode === 'selected' ? 'on' : ''} onClick={() => setEditRecMode('selected')}>指定人员</button>
                          <button type="button" className={editRecMode === 'open' ? 'on' : ''} onClick={() => setEditRecMode('open')}>公开收集</button>
                        </div>
                        {editRecMode === 'selected' && (
                          directory ? (
                            <OrgPeoplePicker
                              organizations={directory.organizations}
                              people={directory.people}
                              selected={editRecMap}
                              onChange={setEditRecMap}
                            />
                          ) : <p className="col-meta">正在加载组织与成员…</p>
                        )}
                        <div style={{ marginTop: 10 }}>
                          <button className="col-btn primary" onClick={() => void saveRecipients()}>保存名单</button>
                        </div>
                      </div>
                    </details>
                  </div>
                </div>
              )}
            </section>

            <div className="col-stats">
              <div className="col-stat"><small>提交率</small><b>{pct}%</b></div>
              <div className="col-stat"><small>已提交</small><b style={{ color: stat.submitted > 0 ? 'var(--col-ok)' : 'var(--muted)' }}>{stat.submitted}</b></div>
              <div className="col-stat"><small>迟交</small><b style={{ color: stat.late > 0 ? 'var(--col-late)' : 'var(--muted)' }}>{stat.late}</b></div>
              <div className="col-stat"><small>未提交</small><b style={{ color: stat.missing > 0 ? 'var(--col-miss)' : 'var(--muted)' }}>{stat.missing}</b></div>
            </div>

            {detail.board ? (
              <>
                <div className="col-panel-h">
                  <h3>进度看板</h3>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {boardOrgs.length > 1 && (
                      <select className="col-select" value={boardOrgFilter} onChange={(e) => setBoardOrgFilter(e.target.value)}>
                        <option value="ALL">全部组织 ({detail.board.length})</option>
                        {boardOrgs.map((g) => <option key={g} value={g}>{g}</option>)}
                      </select>
                    )}
                    <select className="col-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'ALL' | Status)}>
                      <option value="ALL">全部状态</option>
                      <option value="missing">未提交</option>
                      <option value="submitted">已提交</option>
                      <option value="late">迟交</option>
                    </select>
                  </div>
                </div>
                <div className="col-table-wrap">
                  <table className="col-table">
                    <thead>
                      <tr>
                        <th>学号</th><th>姓名</th><th>组织</th>
                        {detail.item.rounds.map((r) => <th key={r.id} style={r.id === activeRound.id ? { color: 'var(--brand)' } : undefined}>{r.label}</th>)}
                        <th>文件（{activeRound.label}）</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => {
                        const files = row.filesByRound[activeRound.id] || [];
                        return (
                          <tr key={`${row.studentId}-${row.name}`} className={row.isMe ? 'me-row' : ''}>
                            <td style={{ fontFamily: 'var(--font-mono)' }}>{row.studentId}</td>
                            <td><b>{row.name}</b>{row.isMe && <> <span className="col-badge submitted">我</span></>}</td>
                            <td className="col-meta">{row.orgLabel}</td>
                            {detail.item.rounds.map((r) => {
                              const st = row.statuses[r.id] || 'missing';
                              return <td key={r.id}><span className={`col-cell ${st}`} title={`${r.label}：${STATUS_LABEL[st]}`}>{STATUS_SYMBOL[st]}</span></td>;
                            })}
                            <td className="col-meta">
                              {files.length ? files.map((s) => (
                                <span key={s.fileId} style={{ marginRight: 8 }}>
                                  {s.canDownload ? (
                                    <button type="button" style={{ border: 0, background: 'none', padding: 0, color: 'var(--brand)', font: 'inherit', cursor: 'pointer' }} onClick={() => void downloadSingle(detail.item.id, activeRound.id, s.fileId, row.rawStudentId)}>{s.storedName}</button>
                                  ) : s.storedName} ({formatBytes(s.sizeBytes)}{s.revisions > 1 ? ` · v${s.revisions}` : ''})
                                </span>
                              )) : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p className="col-meta">登录后可查看进度看板。</p>
            )}
          </>
        );
      })() : null}

      {toast && <div className="col-toast" role="status">{toast}</div>}
    </div>
  );
}
