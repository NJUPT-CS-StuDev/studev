import { describe, expect, it } from 'vitest';
import tokens from '../../../../design/tokens.json';
import { courseHash, courseIdentity, courseToneIndex, allocateCourseTones } from './courseColors';
import { meeting } from '../../../../tests/campus-facts';
const luminance = (hex: string) => hex.slice(1).match(/../g)!.map(v => parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i]!,0);
describe('shared course palette', () => {
    it('uses stable Unicode-scalar FNV-1a and permits collisions without a class-dependent allocator', () => {
        expect(courseHash('hello')).toBe(1335831723);
        const value = meeting();
        expect(courseToneIndex(value)).toBe(allocateCourseTones([value, meeting({id:'other',course:{...value.course,code:'OTHER'}})]).get(courseIdentity(value)));
        expect(courseToneIndex({...value, course:{...value.course,code:'  abc  '}})).toBe(courseToneIndex({...value,course:{...value.course,code:'ABC'}}));
    });
    it('has twelve distinct hues with WCAG AA normal-text contrast in both themes', () => {
        for (const theme of Object.values(tokens.course)) {
            expect(Object.keys(theme)).toHaveLength(12);
            expect(new Set(Object.values(theme).map(t=>t.bg)).size).toBe(12);
            for (const {bg,fg} of Object.values(theme)) expect((Math.max(luminance(bg),luminance(fg))+.05)/(Math.min(luminance(bg),luminance(fg))+.05)).toBeGreaterThanOrEqual(4.5);
        }
    });
});
