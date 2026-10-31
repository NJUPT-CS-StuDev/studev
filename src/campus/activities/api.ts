import { PRODUCT_CONFIG } from '../app/config/product';
import { api, formatTime } from '../../client/platform/platform-client';
import { placePosition, type Space } from '../map/model/space';
export type ActivityPlace = { kind: 'campus'; id: string } | { kind: 'point'; name: string; position: [number, number] };
export interface ActivityInput { title: string; description: string; startsAt: string; endsAt: string; place: ActivityPlace; visibility: 'public' | 'unlisted' }
export interface Activity extends ActivityInput { id: string; organiser: { id: string; name: string }; revision: number; createdAt: string; updatedAt: string }
export const activityUrl = (id: string) => `${PRODUCT_CONFIG.ORIGIN}/map/?activity=${encodeURIComponent(id)}`;
export const activityTime = (a: Activity) => {
  const start = new Date(a.startsAt), end = new Date(a.endsAt);
  const sameDay = start.toDateString() === end.toDateString();
  return `${formatTime(a.startsAt)} — ${sameDay ? new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(end) : formatTime(a.endsAt)}`;
};
export const activityPlaceName = (p: ActivityPlace) => p.kind === 'campus' ? p.id : p.name;
export const activityPosition = (p: ActivityPlace, space: Space) => p.kind === 'point' ? p.position : space.byId.has(p.id) ? placePosition(space, space.byId.get(p.id)!) : undefined;
export const getActivity = async (id: string) => (await api<{ activity: Activity }>(`/activities/${encodeURIComponent(id)}`)).activity;
export const getActivities = (mine = false, after?: string) => api<{ items: Activity[]; next: string | null }>(`${mine ? '/me' : ''}/activities${after ? `?after=${encodeURIComponent(after)}` : ''}`);
