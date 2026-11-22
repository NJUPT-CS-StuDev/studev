import { useEffect, useMemo, useRef, useState } from 'react';
import { api, errorText } from './api';
import './collections.css';

type RoundPolicy = 'strict' | 'allow-late' | 'closed';
type Status = 'submitted' | 'late' | 'missing';

interface FileSlot { id: string; name: string; extensions: string[]; maxBytes: number; }
interface RoundSummary { id: string; label: string; deadline: string; policy: RoundPolicy; fileCount: number; submittedCount: number; totalCount: number; myStatus: Status | null; }
interface CollectionItemSummary {
  id: string; kind: 'course' | 'org'; term: string; termLabel: string; code: string; name: string;
  category: string; groupIds: string[]; groupNames: string[]; rosterCount: number; inMine: boolean;
  rounds: RoundSummary[]; updatedAt: string;
}
interface GroupSummary { id: string; name: string; count: number; }
interface Viewer { studentId: string; name: string; role: string; isStaff: boolean; inRoster?: boolean; }
interface ListResponse { viewer: Viewer | null; items: CollectionItemSummary[]; groups?: GroupSummary[]; }

interface RoundDetail { id: string; label: string; deadline: string; policy: RoundPolicy; files: FileSlot[]; }
interface RoundStat { roundId: string; total: number; submitted: number; late: number; missing: number; }
interface StudentFile { fileId: string; storedName: string; sizeBytes: number; submittedAt: string; revisions: number; canDownload: boolean; }
interface BoardRow { studentId: string; rawStudentId?: string; name: string; groupName: string; isMe: boolean; statuses: Record<string, Status>; filesByRound: Record<string, StudentFile[]>; }
interface DetailResponse {
  viewer: Viewer | null;
  item: { id: string; kind: 'course' | 'org'; term: string; termLabel: string; code: string; name: string; category: string; groupNames: string[]; rosterCount: number; rounds: RoundDetail[]; };
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

export default function CollectionsApp() {
  const [listData, setListData] = useState<ListResponse | null>(null);
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [drawer, setDrawer] = useState<'none' | 'groups' | 'create'>('none');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [roundId, setRoundId] = useState<string | null>(null);
  const [groupFilter, setGroupFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | Status>('ALL');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [toast, setToast] = useState('');

  // Staff creation forms
  const [gName, setGName] = useState('');
  const [gLines, setGLines] = useState('');
  const [cKind, setCKind] = useState<'course' | 'org'>('course');
  const [cTerm, setCTerm] = useState('2026-2027-1');
  const [cTermLabel, setCTermLabel] = useState('2026–2027 学年第一学期');
  const [cCode, setCCode] = useState('JS160201S');
  const [cName, setCName] = useState('计算机通信与网络');
  const [cCategory, setCCategory] = useState('课程实验');
  const [cGroupIds, setCGroupIds] = useState<string[]>([]);
  const [cRoundLabel, setCRoundLabel] = useState('实验2');
  const [cDeadline, setCDeadline] = useState('');
  const [cFileName, setCFileName] = useState('实验报告');
  const [cFileExts, setCFileExts] = useState('doc, docx, pdf');

  // Round edit / new round
  const [dlDraft, setDlDraft] = useState('');
  const [polDraft, setPolDraft] = useState<RoundPolicy>('strict');
  const [nrLabel, setNrLabel] = useState('');
  const [nrFile, setNrFile] = useState('作业报告');
  const [nrExts, setNrExts] = useState('doc, docx, pdf');
  const [nrDl, setNrDl] = useState('');

  const fileInput = useRef<HTMLInputElement>(null);
  const pendingUpload = useRef<{ itemId: string; roundId: string; fileId: string } | null>(null);

  const notify = (msg: string) => {
    setToast(msg);
    window.clearTimeout((notify as unknown as { t?: number }).t);
    (notify as unknown as { t?: number }).t = window.setTimeout(() => setToast(''), 3000);
  };

  const loadList = async () => {
    setLoading(true);
    try {
      const data = await api<ListResponse>('/collections');
      setListData(data);
      if (!data.viewer) setScope('all');
    } catch (e) {
      notify(errorText(e));
    } finally {
      setLoading(false);
    }
  };

  const loadDetail = async (id: string, preferRound?: string) => {
    setLoading(true);
    try {
      const data = await api<DetailResponse>(`/collections/items/${encodeURIComponent(id)}`);
      setDetail(data);
      setSelectedId(id);
      const target = preferRound || data.item.rounds[data.item.rounds.length - 1]?.id || null;
      setRoundId(target);
      setGroupFilter('ALL');
      setStatusFilter('ALL');
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
      const res = await api<{ download: { url: string }; storedName: string }>(`/collections/items/${encodeURIComponent(itemId)}/rounds/${encodeURIComponent(rid)}/download?${q}`);
      window.open(res.download.url, '_blank', 'noopener');
    } catch (e) {
      notify(errorText(e));
    }
  };

  const downloadZip = async (itemId: string, rid: string) => {
    setBusy('正在打包 ZIP…');
    try {
      const res = await api<{ zipName: string; files: { path: string; url: string }[] }>(`/collections/items/${encodeURIComponent(itemId)}/rounds/${encodeURIComponent(rid)}/files`);
      if (!res.files.length) { notify('当前批次还没有可打包的提交文件'); return; }
      const entries: { name: string; data: Uint8Array }[] = [];
      for (let i = 0; i < res.files.length; i++) {
        setBusy(`正在拉取文件 (${i + 1}/${res.files.length})…`);
        const r = await fetch(res.files[i]!.url);
        if (!r.ok) continue;
        entries.push({ name: res.files[i]!.path, data: new Uint8Array(await r.arrayBuffer()) });
      }
      const blob = buildZip(entries);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = res.zipName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      notify(`已打包 ${entries.length} 份文件`);
    } catch (e) {
      notify(errorText(e));
    } finally {
      setBusy('');
    }
  };

  const saveGroup = async () => {
    setBusy('正在保存名单…');
    try {
      const res = await api<{ group: { id: string; name: string; members: unknown[] } }>('/collections/groups', { method: 'POST', body: { name: gName, lines: gLines } });
      setGName(''); setGLines('');
      notify(`已保存名单「${res.group.name}」（${res.group.members.length} 人）`);
      await loadList();
    } catch (e) {
      notify(errorText(e));
    } finally {
      setBusy('');
    }
  };

  const createItem = async () => {
    setBusy('正在发布…');
    try {
      const res = await api<{ item: { id: string } }>('/collections/items', {
        method: 'POST',
        body: {
          kind: cKind, term: cTerm, termLabel: cTermLabel, code: cCode, name: cName, category: cCategory,
          groupIds: cGroupIds, roundLabel: cRoundLabel, deadline: cDeadline ? new Date(cDeadline).toISOString() : '',
          policy: 'strict', files: [{ name: cFileName, extensions: cFileExts }],
        },
      });
      setDrawer('none');
      notify('已发布收集');
      await loadList();
      await loadDetail(res.item.id);
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
      .filter((row) => groupFilter === 'ALL' || row.groupName === groupFilter)
      .filter((row) => row.statuses[activeRound.id] === 'missing');
    const txt = `【未交提醒】${detail.item.name} · ${activeRound.label}${activeRound.deadline ? `（截止 ${formatDateTime(activeRound.deadline)}）` : ''}\n未交 ${list.length} 人：${list.map((x) => x.name).join('、') || '全员已交'}`;
    navigator.clipboard.writeText(txt).then(() => notify(`已复制 ${list.length} 人未交名单`)).catch(() => notify(txt));
  };

  const visibleItems = (listData?.items || []).filter((it) => effectiveScope !== 'mine' || it.inMine);
  const byTerm = new Map<string, CollectionItemSummary[]>();
  for (const it of visibleItems) {
    const arr = byTerm.get(it.termLabel) || [];
    arr.push(it);
    byTerm.set(it.termLabel, arr);
  }

  const openTodos = viewer ? (listData?.items || []).flatMap((it) =>
    it.inMine ? it.rounds.filter((r) => r.policy !== 'closed').map((r) => ({ it, r })) : []
  ) : [];

  return (
    <div className="col-app">
      <input ref={fileInput} type="file" hidden onChange={(e) => { void handleUpload(e.target.files?.[0]); e.target.value = ''; }} />

      {!selectedId || !detail ? (
        <>
          <div className="col-bar">
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <h1 style={{ margin: 0, fontSize: 26, fontWeight: 600, letterSpacing: '-.02em', lineHeight: 1.2 }}>收集</h1>
              {viewer && (
                <div className="col-seg" role="tablist" aria-label="范围筛选">
                  <button className={effectiveScope === 'mine' ? 'on' : ''} onClick={() => setScope('mine')}>与我相关</button>
                  <button className={effectiveScope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>全部</button>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {busy && <span className="col-meta">{busy}</span>}
              {!viewer && <a className="col-btn primary" href={`/login/?next=${encodeURIComponent(location.pathname + location.search)}`}>登录</a>}
              {isStaff && (
                <>
                  <button className="col-btn" onClick={() => setDrawer((d) => (d === 'groups' ? 'none' : 'groups'))}>名单</button>
                  <button className="col-btn primary" onClick={() => setDrawer((d) => (d === 'create' ? 'none' : 'create'))}>+ 发布收集</button>
                </>
              )}
            </div>
          </div>

          {isStaff && drawer === 'groups' && (
            <section className="col-panel" style={{ marginTop: 0 }}>
              <div className="col-panel-h">
                <h3>名单</h3>
                <span className="col-meta">{(listData?.groups || []).length} 组</span>
              </div>
              <div className="col-chips" style={{ marginBottom: 12 }}>
                {(listData?.groups || []).map((g) => <span key={g.id} className="col-chip">{g.name} · {g.count} 人</span>)}
              </div>
              <div className="col-form-row" style={{ alignItems: 'flex-start' }}>
                <label className="col-field">名称<input placeholder="例如：B240402" value={gName} onChange={(e) => setGName(e.target.value)} /></label>
                <label className="col-field" style={{ flex: 1, minWidth: 220 }}>
                  成员（每行：学号 姓名；未注册同学注册后自动匹配）
                  <textarea rows={4} style={{ padding: 8, border: '1px solid var(--line)', borderRadius: 8, background: 'var(--paper)', color: 'var(--ink)', font: 'inherit', fontSize: 12.5 }} placeholder={"B24040201 张三\nB24040202 李四"} value={gLines} onChange={(e) => setGLines(e.target.value)} />
                </label>
                <button className="col-btn primary" style={{ marginTop: 20 }} onClick={() => void saveGroup()}>保存名单</button>
              </div>
            </section>
          )}

          {isStaff && drawer === 'create' && (
            <section className="col-panel" style={{ marginTop: 0 }}>
              <div className="col-panel-h"><h3>发布新收集</h3></div>
              <div className="col-form-row">
                <label className="col-field">归属<select value={cKind} onChange={(e) => setCKind(e.target.value as 'course' | 'org')}><option value="course">课程</option><option value="org">社团组织</option></select></label>
                <label className="col-field">学期<input value={cTerm} onChange={(e) => setCTerm(e.target.value)} /></label>
                <label className="col-field">学期显示名<input value={cTermLabel} onChange={(e) => setCTermLabel(e.target.value)} /></label>
                <label className="col-field">{cKind === 'course' ? '课程号' : '组织代号'}<input value={cCode} onChange={(e) => setCCode(e.target.value)} /></label>
                <label className="col-field">名称<input value={cName} onChange={(e) => setCName(e.target.value)} /></label>
                <label className="col-field">类别<input value={cCategory} onChange={(e) => setCCategory(e.target.value)} /></label>
                <label className="col-field">首个批次<input value={cRoundLabel} onChange={(e) => setCRoundLabel(e.target.value)} /></label>
                <label className="col-field">提交文件<input value={cFileName} onChange={(e) => setCFileName(e.target.value)} /></label>
                <label className="col-field">允许后缀<input value={cFileExts} onChange={(e) => setCFileExts(e.target.value)} /></label>
                <label className="col-field">截止时间<input type="datetime-local" value={cDeadline} onChange={(e) => setCDeadline(e.target.value)} /></label>
              </div>
              {(listData?.groups || []).length > 0 && (
                <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', fontSize: 13 }}>
                  <span className="col-meta">面向名单：</span>
                  {(listData?.groups || []).map((g) => (
                    <label key={g.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                      <input type="checkbox" checked={cGroupIds.includes(g.id)} onChange={(e) => setCGroupIds((cur) => e.target.checked ? [...cur, g.id] : cur.filter((x) => x !== g.id))} />
                      {g.name} ({g.count})
                    </label>
                  ))}
                </div>
              )}
              <div style={{ marginTop: 12 }}>
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
            <p className="col-meta">{effectiveScope === 'mine' ? '当前没有分配给你的收集，可以切换到「全部」浏览。' : '还没有发布收集项目。'}</p>
          ) : (
            [...byTerm.entries()].map(([termLabel, list]) => (
              <section key={termLabel}>
                <div className="col-term"><h2>{termLabel}</h2></div>
                <div className="col-grid">
                  {list.map((it) => {
                    const hasOpen = it.rounds.some((r) => r.policy !== 'closed');
                    return (
                      <button key={it.id} className="col-card" onClick={() => void loadDetail(it.id)}>
                        <div className="col-card-top">
                          <span className={`col-code ${it.kind === 'org' ? 'org' : ''}`}>{it.code}</span>
                          <span className="col-meta">{it.groupNames.join(' / ') || '不限名单'}</span>
                        </div>
                        <h3>{it.name}</h3>
                        <div className="col-chips">
                          <span className={`col-chip ${hasOpen ? 'open' : ''}`}>{it.category} · {it.rounds.length} 批{hasOpen ? ' · 进行中' : ''}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))
          )}

          {isStaff && (
            <p className="col-meta" style={{ marginTop: 32 }}>
              <a href="/admin/" style={{ color: 'var(--muted)', textDecoration: 'underline', textUnderlineOffset: 3 }}>通用问卷与表单管理</a>
            </p>
          )}
        </>
      ) : activeRound ? (() => {
        const stat = detail.roundStats.find((s) => s.roundId === activeRound.id) || { total: 0, submitted: 0, late: 0, missing: 0 };
        const pct = stat.total ? Math.round(((stat.submitted + stat.late) / stat.total) * 100) : 0;
        const myRow = detail.board?.find((r) => r.isMe) || null;
        const rows = (detail.board || [])
          .filter((r) => groupFilter === 'ALL' || r.groupName === groupFilter)
          .filter((r) => statusFilter === 'ALL' || r.statuses[activeRound.id] === statusFilter)
          .sort((a, b) => (a.isMe ? -1 : b.isMe ? 1 : a.studentId.localeCompare(b.studentId)));

        return (
          <>
            <button className="col-back" onClick={() => { setSelectedId(null); setDetail(null); }}>‹ 返回</button>
            <div className="col-head">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className={`col-code ${detail.item.kind === 'org' ? 'org' : ''}`}>{detail.item.code}</span>
                <span className="col-meta">{detail.item.termLabel} · {detail.item.category}</span>
              </div>
              <h1>{detail.item.name}</h1>
              <p>{detail.item.groupNames.join(' / ')}（{detail.item.rosterCount} 人） · {POLICY_LABEL[activeRound.policy]}</p>
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
                return (
                  <div key={f.id} className="col-slot">
                    <div className="col-slot-info">
                      <div className="col-slot-title">{f.name} <span className={`col-badge ${st}`}>{STATUS_LABEL[st]}</span></div>
                      <div className="col-slot-req">.{f.extensions.join(' / .')} · 上限 {Math.round(f.maxBytes / 1048576)} MB</div>
                      {sub && (
                        <div className="col-slot-file">
                          <button type="button" style={{ border: 0, background: 'none', padding: 0, color: 'var(--brand)', font: 'inherit', cursor: 'pointer' }} onClick={() => void downloadSingle(detail.item.id, activeRound.id, f.id)}>{sub.storedName}</button>
                          <span className="col-meta">{formatBytes(sub.sizeBytes)} · {formatDateTime(sub.submittedAt)}{sub.revisions > 1 ? ` · 第 ${sub.revisions} 版` : ''}</span>
                        </div>
                      )}
                    </div>
                    <div>
                      {activeRound.policy !== 'closed' ? (
                        <button className={`col-btn ${sub ? '' : 'primary'}`} onClick={() => { pendingUpload.current = { itemId: detail.item.id, roundId: activeRound.id, fileId: f.id }; fileInput.current?.click(); }}>
                          {sub ? '替换提交' : '上传文件'}
                        </button>
                      ) : <span className="col-meta">已关闭</span>}
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
                  </div>
                </div>
              )}
            </section>

            <div className="col-stats">
              <div className="col-stat"><small>提交率</small><b>{pct}%</b></div>
              <div className="col-stat"><small>已提交</small><b style={{ color: 'var(--col-ok)' }}>{stat.submitted}</b></div>
              <div className="col-stat"><small>迟交</small><b style={{ color: 'var(--col-late)' }}>{stat.late}</b></div>
              <div className="col-stat"><small>未提交</small><b style={{ color: 'var(--col-miss)' }}>{stat.missing}</b></div>
            </div>

            {detail.board ? (
              <>
                <div className="col-panel-h">
                  <h3>进度看板</h3>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {detail.item.groupNames.length > 1 && (
                      <select className="col-select" value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}>
                        <option value="ALL">全部名单 ({detail.item.rosterCount})</option>
                        {detail.item.groupNames.map((g) => <option key={g} value={g}>{g}</option>)}
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
                        <th>学号</th><th>姓名</th><th>名单</th>
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
                            <td className="col-meta">{row.groupName}</td>
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
