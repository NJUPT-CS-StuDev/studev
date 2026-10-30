import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CalendarDays, MapPin, ArrowUpRight, Link, Plus, ArrowLeft, Users } from 'lucide-react';
import { api, errorText, session, type Session } from '../scripts/platform-client';
import { loadSpace, type Space } from '../campus/map/model/space';
import { activityPlaceName, activityTime, activityUrl, getActivities, getActivity, type Activity, type ActivityInput } from './api';
import './activities.css';

const localTime = (value: string) => { const d = new Date(value); return new Date(d.valueOf() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
export default function ActivityPage() {
  const [auth, setAuth] = useState<Session | null>(null), [ready, setReady] = useState(false);
  const [space, setSpace] = useState<Space | null>(null), [items, setItems] = useState<Activity[]>([]);
  const [selected, setSelected] = useState<Activity | null>(null), [editing, setEditing] = useState(false), [mine, setMine] = useState(false);
  const [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [next, setNext] = useState<string | null>(null), [deleting, setDeleting] = useState(false);
  const [point, setPoint] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [listStatus, setListStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const params = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
  const pinned = params.get('lon') && params.get('lat') ? [Number(params.get('lon')), Number(params.get('lat'))] : null;
  useEffect(() => {
    let alive = true;
    Promise.all([session(), loadSpace()]).then(([s, data]) => { if (alive) { setAuth(s); setSpace(data); } }).catch(e => { if (alive) setNotice(errorText(e)); }).finally(() => { if (alive) setReady(true); });
    if (params.has('new') || pinned || params.has('place') || params.has('edit')) { setEditing(true); setPoint(Boolean(pinned)); }
    if (pinned) { try { setDraft(JSON.parse(sessionStorage.getItem('studev.activity.draft') ?? 'null')); } catch { /* A new activity can still be entered. */ } }
    const id = params.get('id');
    if (id) getActivity(id).then(a => { if (alive) { setSelected(a); setPoint(Boolean(pinned) || a.place.kind === 'point'); } }).catch(e => { if (alive) setNotice(errorText(e)); });
    return () => { alive = false; };
  }, []);
  useEffect(() => { let alive = true; setListStatus('loading'); getActivities(mine).then(r => { if (alive) { setItems(r.items); setNext(r.next); setListStatus('loaded'); } }).catch(e => { if (alive) { setNotice(errorText(e)); setListStatus('error'); } }); return () => { alive = false; }; }, [mine]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true); setNotice('');
    try {
      const position = pinned ?? (selected?.place.kind === 'point' ? selected.place.position : null);
      if (point && !position) throw new Error('请先在地图上选择集合点。');
      const input: ActivityInput = { title: String(form.get('title')), description: String(form.get('description')), startsAt: new Date(String(form.get('startsAt'))).toISOString(), endsAt: new Date(String(form.get('endsAt'))).toISOString(), visibility: form.get('visibility') as 'public' | 'unlisted',
        place: point ? { kind: 'point', name: String(form.get('pointName')), position: position as [number, number] } : { kind: 'campus', id: String(form.get('place')) } };
      const result = await api<{ activity: Activity }>(selected ? `/activities/${selected.id}` : '/activities', { ...input, ...(selected ? { revision: selected.revision } : {}) });
      setSelected(result.activity); setEditing(false); history.replaceState(null, '', `/activities/?id=${result.activity.id}`);
      try { sessionStorage.removeItem('studev.activity.draft'); } catch { /* Saving does not depend on local storage. */ } setDraft(null);
      setNotice('活动已保存，可以分享给同行的人了。');
      try { const list = await getActivities(mine); setItems(list.items); setNext(list.next); } catch { /* The saved detail remains available if refreshing the list fails. */ }
    } catch (e) { setNotice(errorText(e)); } finally { setBusy(false); }
  }
  async function share(a: Activity) {
    try { if (navigator.share) await navigator.share({ title: a.title, url: activityUrl(a.id) }); else { await navigator.clipboard.writeText(activityUrl(a.id)); setNotice('活动链接已复制。'); } } catch (e) { if (!(e instanceof DOMException && e.name === 'AbortError')) setNotice('复制未完成，请使用下方的活动链接。'); }
  }
  const owner = selected && auth?.user.id === selected.organiser.id;
  return <main className="platform activities-page">
    <header className="p-heading"><div><p className="activity-eyebrow">在校园，一起出发</p><h1>校园活动</h1><p>把时间与地点，分享给同行的人。</p></div>{!editing && <button className="p-button" onClick={() => { setSelected(null); setEditing(true); setPoint(false); setDraft(null); }}><Plus size={17} />发起活动</button>}</header>
    {notice && <p className="p-message" role="status">{notice}</p>}
    {(editing || selected) && <button className="activity-back" onClick={() => { setEditing(false); setSelected(null); setDeleting(false); history.replaceState(null, '', '/activities/'); }}><ArrowLeft size={16} />全部活动</button>}
    {editing ? !ready || (params.has('id') && !selected) ? <p role="status">正在读取活动与账号…</p> : !auth ? <section className="p-card activity-signin"><Users size={32} /><h2>登录后发起活动</h2><p className="p-muted">使用和网页相同的学号与密码。</p><a className="p-button" href={`/login/?next=${encodeURIComponent(location.pathname + location.search)}`}>去登录</a></section> : <form ref={formRef} key={selected?.id ?? 'new'} className="p-card activity-editor" onSubmit={save}>
      <h2>{selected ? '编辑活动' : '发起一场活动'}</h2>
      <div className="p-field"><label htmlFor="activity-title">活动标题</label><input id="activity-title" name="title" required maxLength={80} defaultValue={draft?.title ?? selected?.title} placeholder="例如：周末校园摄影散步" /></div>
      <div className="p-grid"><div className="p-field"><label htmlFor="activity-start">开始时间</label><input id="activity-start" type="datetime-local" name="startsAt" required defaultValue={draft?.startsAt ?? (selected ? localTime(selected.startsAt) : '')} /></div><div className="p-field"><label htmlFor="activity-end">结束时间</label><input id="activity-end" type="datetime-local" name="endsAt" required defaultValue={draft?.endsAt ?? (selected ? localTime(selected.endsAt) : '')} /></div></div>
      <fieldset className="activity-place-choice"><legend>活动地点</legend><label><input type="radio" checked={!point} onChange={() => setPoint(false)} />校园地点</label><label><input type="radio" checked={point} onChange={() => setPoint(true)} />地图集合点</label></fieldset>
      {!point ? <div className="p-field"><label htmlFor="activity-place">搜索楼栋、教室或地点</label><input id="activity-place" name="place" list="activity-places" required defaultValue={selected?.place.kind === 'campus' ? selected.place.id : params.get('place') ?? ''} placeholder="输入地点名称，例如 教3" /><datalist id="activity-places">{Array.from(space?.byId.values() ?? []).map(p => <option key={p.id} value={p.id} />)}</datalist></div> : <div className="p-field"><label htmlFor="activity-point-name">集合点名称</label><input id="activity-point-name" name="pointName" required maxLength={80} defaultValue={draft?.pointName ?? (selected?.place.kind === 'point' ? selected.place.name : '')} placeholder="例如：图书馆南门外" /><p className="p-help">{pinned || selected?.place.kind === 'point' ? '已选择地图集合点。' : '请先选择地图集合点，再填写活动内容。'}</p><a className="p-button secondary" href={`/map/?pickActivity=1${selected ? `&editActivity=${selected.id}` : ''}`} onClick={() => { try { if (formRef.current) sessionStorage.setItem('studev.activity.draft', JSON.stringify(Object.fromEntries(new FormData(formRef.current)))); } catch { /* Map selection still works without draft storage. */ } }}>在地图上选点</a></div>}
      <div className="p-field"><label htmlFor="activity-description">活动介绍（选填）</label><textarea id="activity-description" name="description" maxLength={2000} rows={4} defaultValue={draft?.description ?? selected?.description} placeholder="写下集合方式、需要带的东西，以及其他想说的话。" /></div>
      <div className="p-field"><label htmlFor="activity-visibility">谁可以看到</label><select id="activity-visibility" name="visibility" defaultValue={draft?.visibility ?? selected?.visibility ?? 'public'}><option value="public">公开展示在活动列表和地图上</option><option value="unlisted">仅凭链接访问</option></select><p className="p-help">两种方式都能通过链接查看。「仅凭链接」不会出现在公开列表中。</p></div>
      <div className="p-actions"><button className="p-button" disabled={busy || !space}>{busy ? '正在保存…' : '保存活动'}</button><button className="p-button secondary" type="button" onClick={() => setEditing(false)}>取消</button></div>
    </form> : selected ? <article className="p-card activity-detail"><span className="activity-badge">{selected.visibility === 'public' ? '校园活动' : '仅凭链接访问'}</span><h2>{selected.title}</h2><p><CalendarDays size={20} />{activityTime(selected)}</p><p><MapPin size={20} />{activityPlaceName(selected.place)}</p><p><Users size={20} />{selected.organiser.name} 发起</p><div className="activity-description">{selected.description || '发起人还没有填写活动介绍。'}</div><div className="p-actions"><a className="p-button" href={`/map/?activity=${selected.id}`}><ArrowUpRight size={17} />在地图上查看</a><button className="p-button secondary" onClick={() => void share(selected)}><Link size={17} />分享活动</button>{owner && <button className="p-button secondary" onClick={() => { setEditing(true); setPoint(selected.place.kind === 'point'); }}>编辑</button>}{owner && <button className="p-button secondary" onClick={() => setDeleting(true)}>删除</button>}</div><a className="activity-share-url" href={activityUrl(selected.id)}>{activityUrl(selected.id)}</a>
      {deleting && <div role="alert" className="p-message"><p>删除后，原有分享链接将无法访问此活动。</p><div className="p-actions"><button className="p-button" disabled={busy} onClick={async () => { setBusy(true); try { await api(`/activities/${selected.id}/delete`, { revision: selected.revision }); setSelected(null); setItems(items.filter(a => a.id !== selected.id)); setDeleting(false); } catch(e) { setNotice(errorText(e)); } finally { setBusy(false); } }}>确认删除</button><button className="p-button secondary" onClick={() => setDeleting(false)}>取消</button></div></div>}
    </article> : <><nav className="p-tabs" aria-label="活动范围"><button className="p-tab" aria-pressed={!mine} onClick={() => setMine(false)}>近期活动</button>{auth && <button className="p-tab" aria-pressed={mine} onClick={() => setMine(true)}>我发起的</button>}<a className="activity-map-link" href="/map/">在地图上探索 <ArrowUpRight size={16} /></a></nav><div className="p-list activity-list">{items.map(a => <button className="p-card activity-item" key={a.id} onClick={() => { setSelected(a); history.replaceState(null, '', `/activities/?id=${a.id}`); }}><span className="activity-date"><CalendarDays size={21} />{new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' }).format(new Date(a.startsAt))}</span><h2>{a.title}</h2><p><MapPin size={16} />{activityPlaceName(a.place)}</p><p>{activityTime(a)}</p><p>{a.organiser.name} 发起 <ArrowUpRight size={17} /></p></button>)}</div>{listStatus === 'loading' && <p role="status">正在读取近期活动…</p>}{!items.length && listStatus === 'loaded' && <section className="p-card activity-signin"><CalendarDays size={32} /><h2>还没有近期活动</h2><p className="p-muted">一次散步、一场交流，都可以从这里开始。</p></section>}{next && <button className="p-button secondary" onClick={async () => { try { const r = await getActivities(mine, next); setItems([...items, ...r.items]); setNext(r.next); } catch(e) { setNotice(errorText(e)); } }}>更多活动</button>}</>}
  </main>;
}
