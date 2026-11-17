import { expect, it } from 'vitest';
import type { Place } from '@/map/model/space';
import { placeFloor, routeContext, routeDuration, routingPlace } from './routes';

const place = (id: string, kind: string, target = id, parent?: string, floor?: string): Place => ({ id, kind, parent, floor, names: [id.split('/').at(-1)!], sources: [], routing: { type: 'target', id: target } });
const first = place('仙林/教1', 'building');
const second = place('仙林/教2', 'building');
const floor = place('仙林/教1/2', 'floor', first.id, first.id);
const room101 = place('仙林/教1-101', 'room', first.id, '仙林/教1/1', '1');
const room102 = place('仙林/教1-102', 'room', first.id, '仙林/教1/1', '1');
const room201 = place('仙林/教1-201', 'room', first.id, floor.id, '2');
const otherRoom = place('仙林/教2-101', 'room', second.id, '仙林/教2/1', '1');
const outside = place('仙林/东门', 'place');
const byId = new Map([first, second, floor, room101, room102, room201, otherRoom, outside].map(item => [item.id, item]));

it('uses actual shared building access for indoor positions, preserving the requested rooms and their floors', () => {
    expect(routingPlace(room101, byId)).toBe(first);
    const sameFloor = routeContext(room102, room101, byId);
    expect(sameFloor).toMatchObject({ withinBuilding: true, building: '教1', fromLocation: '1 层 · 教1-102', location: '1 层 · 教1-101' });
    expect(sameFloor.viewUrl).toBe('/map/?place=%E4%BB%99%E6%9E%97%2F%E6%95%991-101&f=1');
    expect(routeContext(room101, room201, byId)).toMatchObject({ withinBuilding: true, floor: '2', location: '2 层 · 教1-201' });
    expect(placeFloor(floor)).toBe('2');
    expect(routeContext(first, floor, byId)).toMatchObject({ withinBuilding: true, floor: '2' });
    expect(routeContext(floor, room201, byId)).toMatchObject({ withinBuilding: true, fromLocation: '教1 2 层', location: '2 层 · 教1-201' });
});

it('keeps cross-building road arrival at the entrance and continues with the actual indoor position', () => {
    const crossed = routeContext(room101, otherRoom, byId);
    expect(crossed).toMatchObject({ withinBuilding: false, indoorDestination: true, arrival: '教2入口', floor: '1', continuation: '进入教2后，前往1 层 · 教2-101' });
    expect(routeContext(undefined, otherRoom, byId).withinBuilding, 'a GPS point does not assert that someone is inside the building').toBe(false);
    expect(routeContext(first, outside, byId)).toMatchObject({ withinBuilding: false, indoorDestination: false, arrival: '东门', continuation: null });
    expect(routeContext(first, second, byId)).toMatchObject({ withinBuilding: false, arrival: '教2入口' });
});

it('does not invent a target or an indoor minute when the map or travel time does not supply one', () => {
    expect(() => routingPlace(place('仙林/未知-101', 'room', '仙林/不存在'), byId)).toThrow('缺少导航接入点');
    expect([0, 30, 60, 61].map(routeDuration)).toEqual(['不到 1 分钟', '不到 1 分钟', '1 分钟', '2 分钟']);
});
