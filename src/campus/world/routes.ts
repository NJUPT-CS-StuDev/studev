// Outdoor routing ends at a published access point; a room's containment describes the rest of the destination.
import type { Place } from '@/map/model/space';
import { displayName } from '@/map/model/displayName';
import { roomLabel } from './names';

export const placeFloor = (place: Place) => place.floor ?? (place.kind === 'floor' ? place.id.slice(place.id.lastIndexOf('/') + 1) : undefined);
export const routeName = (place: Place, byId: ReadonlyMap<string, Place>) => place.kind === 'room' ? roomLabel(place.id) : displayName(place, byId);

/** The entity whose outdoor access was actually published, never an invented room entrance. */
export function routingPlace(place: Place, byId: ReadonlyMap<string, Place>): Place {
    const access = place.routing.type === 'target' ? byId.get(place.routing.id) : undefined;
    if (!access) throw new Error(`地图实体缺少导航接入点：${place.id}`);
    return access;
}

export function routeLocation(place: Place, byId: ReadonlyMap<string, Place>): string {
    const floor = placeFloor(place);
    return place.kind === 'floor' && floor ? `${routeName(routingPlace(place, byId), byId)} ${floor} 层`
        : [floor ? `${floor} 层` : '', routeName(place, byId)].filter(Boolean).join(' · ');
}

export function routeContext(from: Place | undefined, to: Place, byId: ReadonlyMap<string, Place>) {
    const access = routingPlace(to, byId), floor = placeFloor(to);
    const withinBuilding = access.kind === 'building' && from !== undefined && routingPlace(from, byId).id === access.id;
    const indoorDestination = access.kind === 'building' && access.id !== to.id;
    const building = routeName(access, byId), location = routeLocation(to, byId);
    return { access, withinBuilding, indoorDestination, building, floor, location,
        arrival: access.kind === 'building' ? `${building}入口` : building,
        continuation: indoorDestination ? `进入${building}后，前往${location}` : null,
        fromLocation: from ? routeLocation(from, byId) : null,
        viewUrl: `/map/?place=${encodeURIComponent(to.id)}${floor ? `&f=${encodeURIComponent(floor)}` : ''}` };
}

/** Normal time formatting preserves sub-minute routes without turning zero outdoor travel into one minute. */
export const routeDuration = (seconds: number) => seconds < 60 ? '不到 1 分钟' : `${Math.ceil(seconds / 60)} 分钟`;
