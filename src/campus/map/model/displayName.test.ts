import { describe, expect, it } from 'vitest';
import { displayName } from './displayName';
import type { Place } from './space';
import vectors from './displayName.golden.json';

const base = (value: Partial<Place>): Place => ({ id: '仙林/建筑/024', kind: 'building', parent: '仙林', names: [], sources: ['map'], routing: { type: 'target', id: '仙林/建筑/024' }, category: '宿舍', ...value });

describe('displayName', () => {
    it('prefers an authored name over the stable id', () => expect(displayName(base({ names: ['菊苑18栋'] }))).toBe('菊苑18栋'));
    it('uses the nearest named context for a nameless building', () => {
        const campus = base({ id: '仙林', kind: 'campus', parent: '', names: ['仙林校区'], category: undefined });
        const place = base({ parent: campus.id });
        expect(displayName(place, new Map([[campus.id, campus]]))).toBe('宿舍 · 仙林校区');
    });
    it('falls back to the explicit nameless-building label when no ancestor is named', () => expect(displayName(base({ id: '仙林/菊苑18栋', parent: '' }))).toBe('未命名建筑'));
    it('uses category text for a nameless place', () => expect(displayName(base({ kind: 'place', category: '体育场', parent: '' }))).toBe('体育场 · 未命名地点'));
    it('matches the shared golden vectors', () => {
        for (const vector of vectors.cases) {
            const parents = new Map(vector.parents.map(parent => [parent.id, parent as Place]));
            expect(displayName(vector.place as Place, parents)).toBe(vector.expected);
        }
    });
});
