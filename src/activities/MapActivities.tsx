import { useEffect, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import { CalendarDays, MapPin, Share2, ArrowUpRight, Plus } from 'lucide-react';
import type { Place, Space } from '../campus/map/model/space';
import { activityPlaceName, activityPosition, activityTime, activityUrl, getActivities, getActivity, type Activity } from './api';
import { errorText } from '../scripts/platform-client';
import './map-activities.css';

export default function MapActivities({ map, space, onPick, onRoute, routeOpen, placeSelected, onSelectionChange }: {
  map: maplibregl.Map | null; space: Space | null; onPick: () => void; onRoute: (place: Place) => void; routeOpen: boolean; placeSelected: boolean; onSelectionChange: (selected: boolean) => void;
}) {
  const [visible, setVisible] = useState(false), [items, setItems] = useState<Activity[]>([]), [selected, setSelected] = useState<Activity | null>(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [reload, setReload] = useState(0);
  const picking = new URLSearchParams(location.search).has('pickActivity');
  useEffect(() => { onSelectionChange(picking || (visible && selected !== null)); }, [picking, visible, selected, onSelectionChange]);
  useEffect(() => { if (placeSelected) setSelected(null); }, [placeSelected]);
  useEffect(() => {
    if (picking) return;
    let alive = true;
    setError('');
    getActivities().then(r => { if (alive) setItems(r.items); }).catch(e => { if (alive) setError(errorText(e)); });
    const id = new URLSearchParams(location.search).get('activity');
    if (id) getActivity(id).then(a => { if (alive) { setSelected(a); onPick(); } }).catch(e => { if (alive) setError(errorText(e)); });
    return () => { alive = false; };
  }, [reload]);
  useEffect(() => {
    if (!map || !picking) return;
    const pick = (e: maplibregl.MapMouseEvent) => { const edit = new URLSearchParams(location.search).get('editActivity'); location.assign(`/activities/?${edit ? `id=${encodeURIComponent(edit)}&edit=1` : 'new=1'}&lon=${e.lngLat.lng.toFixed(7)}&lat=${e.lngLat.lat.toFixed(7)}`); };
    map.on('click', pick); map.getCanvas().style.cursor = 'crosshair';
    return () => { map.off('click', pick); map.getCanvas().style.cursor = ''; };
  }, [map, picking]);
  useEffect(() => {
    if (!map || !space || !visible || picking) return;
    const all = selected && !items.some(a => a.id === selected.id) ? [...items, selected] : items;
    const markers = all.flatMap(a => {
      const at = activityPosition(a.place, space); if (!at) return [];
      const element = document.createElement('button'); element.type = 'button'; element.className = 'activity-map-marker';
      element.textContent = '活动'; element.setAttribute('aria-label', `活动：${a.title}`);
      element.addEventListener('click', event => { event.stopPropagation(); onPick(); setSelected(a); const url = new URL(location.href); url.searchParams.set('activity', a.id); history.replaceState(null, '', url); });
      return [new maplibregl.Marker({ element }).setLngLat(at).addTo(map)];
    });
    return () => { markers.forEach(m => m.remove()); };
  }, [map, space, visible, items, selected, picking]);
  useEffect(() => { if (selected && map && space) { const at = activityPosition(selected.place, space); if (at) map.easeTo({ center: at, zoom: Math.max(map.getZoom(), 16.5), offset: window.innerWidth > 720 ? [180, 0] : [0, -130] }); } }, [selected, map, space]);
  const close = () => { setSelected(null); const url = new URL(location.href); url.searchParams.delete('activity'); history.replaceState(null, '', url); };
  if (picking) return <section className="campus-map-card"><h2>选择集合点</h2><p>移动地图，点击活动集合的位置。</p><a href="/activities/?new=1">取消选点</a></section>;
  return <>
    <div className="activity-map-tools"><button type="button" className={error ? 'is-unavailable' : undefined} aria-pressed={visible} aria-disabled={error ? true : undefined} title={error || undefined} onClick={() => error ? setReload(reload + 1) : setVisible(!visible)}><CalendarDays size={16} />{error ? '活动不可用' : `活动${items.length > 0 ? ` · ${items.length}` : ''}`}</button><a href="/activities/">全部活动 <ArrowUpRight size={14} /></a></div>
    {visible && selected && !routeOpen && <section className="campus-map-card activity-map-sheet" aria-label="活动详情"><header><div><span className="activity-map-label">校园活动{selected.visibility === 'unlisted' ? ' · 仅凭链接访问' : ''}</span><h2>{selected.title}</h2></div><button type="button" className="campus-map-close" aria-label="关闭活动" onClick={close}>×</button></header><p><CalendarDays size={16} />{activityTime(selected)}</p><p><MapPin size={16} />{activityPlaceName(selected.place)}</p><p>{selected.organiser.name} 发起</p>{selected.description && <div className="activity-map-description">{selected.description}</div>}
      <button type="button" className="campus-map-primary" disabled={!space || !activityPosition(selected.place, space)} onClick={() => {
        if (!space) return;
        const p = selected.place;
        if (p.kind === 'campus') { const place = space.byId.get(p.id); if (place) onRoute({ ...place }); }
        else onRoute({ id: p.name, kind: 'activity-point', parent: '', names: [p.name], centre: p.position, sources: [], use: '活动集合点', routing: { type: 'position', position: p.position } });
      }}>去这里</button><div className="activity-map-actions"><button type="button" onClick={async () => { try { if (navigator.share) await navigator.share({ title: selected.title, url: activityUrl(selected.id) }); else { await navigator.clipboard.writeText(activityUrl(selected.id)); setNotice('链接已复制'); } } catch(e) { if (!(e instanceof DOMException && e.name === 'AbortError')) setNotice('请打开活动详情复制链接'); } }}><Share2 size={16} />分享活动</button><a href={`/activities/?id=${selected.id}`}>活动详情 <ArrowUpRight size={15} /></a></div>{notice && <p role="status">{notice}</p>}
    </section>}
    {!selected && !routeOpen && !placeSelected && <a className="activity-map-create" href="/activities/?new=1"><Plus size={15} />发起活动</a>}
  </>;
}
