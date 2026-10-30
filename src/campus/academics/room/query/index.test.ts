import { describe, expect, it } from 'vitest';
import { parseRoomIntent } from './index';
describe('room intent', () => {
    it('recognizes entry and named rooms without treating ordinary text as a room', () => {
        expect(parseRoomIntent('教室')).toEqual({kind: 'entry'});
        expect(parseRoomIntent('教2-313')).toEqual({kind: 'candidate', input: '教2-313'});
        expect(parseRoomIntent('图409')).toEqual({kind: 'candidate', input: '图409'});
        expect(parseRoomIntent('奖学金')).toBeNull();
    });
});
