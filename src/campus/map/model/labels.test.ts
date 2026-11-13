import { describe, expect, it } from 'vitest';
import { labelRule } from './labels';
import type { Place } from './space';

const entity = (id: string, kind: string, extra: Partial<Place> = {}): Place => ({ id, kind, names: [id], sources: ['map'], routing: { type: 'target', id }, ...extra });
const byId = new Map([entity('仙林', 'campus'), entity('仙林/三食堂', 'building', { parent: '仙林', category: '食堂', tier: 1 })].map(place => [place.id, place]));

describe('map labels', () => {
    it('names buildings by tier, a taught one first', () => {
        expect(labelRule(byId.get('仙林/三食堂')!, byId)).toEqual({ minZoom: 15.1, priority: 1 });
        expect(labelRule(entity('仙林/热水房', 'building', { parent: '仙林', category: '设施', tier: 3 }), byId)).toEqual({ minZoom: 16.8, priority: 3 });
        expect(labelRule(entity('仙林/教3', 'building', { parent: '仙林', category: '教学楼', tier: 1 }), byId, true)).toEqual({ minZoom: 14.5, priority: 0 });
    });
    it('names a place inside a building close up, one off campus later, and parking never', () => {
        expect(labelRule(entity('仙林/东门', 'place', { parent: '仙林', category: '校门', tier: 1 }), byId)).toEqual({ minZoom: 15.6, priority: 2 });
        expect(labelRule(entity('仙林/三食堂库迪咖啡', 'place', { parent: '仙林/三食堂', category: '咖啡茶饮', tier: 3 }), byId)).toEqual({ minZoom: 17.4, priority: 4 });
        expect(labelRule(entity('周边/麦当劳', 'place', { category: '快餐小吃', tier: 3 }), byId)).toEqual({ minZoom: 17.4, priority: 5 });
        expect(labelRule(entity('仙林/教1西侧停车场', 'place', { parent: '仙林', category: '停车场', tier: 3 }), byId)).toBeNull();
        expect(labelRule(entity('仙林/教3-601', 'room', { parent: '仙林/教3/6' }), byId)).toBeNull();
    });
});
