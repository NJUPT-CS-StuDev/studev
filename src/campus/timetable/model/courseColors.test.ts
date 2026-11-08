import { describe, expect, it } from 'vitest';
import tokens from '../../../../design/tokens.json';
import { courseIdentity, courseTones } from './courseColors';
const luminance = (hex: string) => hex.slice(1).match(/../g)!.map(v => parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i]!,0);
describe('shared course palette', () => {
    const hue = (tone: number) => { const [r, g, b] = Object.values(tokens.course.light)[tone]!.border.slice(1).match(/../g)!.map(v => parseInt(v, 16) / 255) as [number, number, number]; const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min; const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4; return (h * 60 + 360) % 360; };
    const apart = (left: number, right: number) => { const d = Math.abs(hue(left) - hue(right)); return Math.min(d, 360 - d); };
    const course = (code: string, weekday: number) => ({ weekday, course: { code, name: '' } });
    it('gives the courses of one day different tones, at least 60° apart for up to six', () => {
        const day = Array.from({ length: 6 }, (_, at) => course(`C${at}`, 2));
        const tones = [...courseTones(day).values()];
        expect(new Set(tones).size).toBe(6);
        for (const left of tones) for (const right of tones) if (left !== right) expect(apart(left, right)).toBeGreaterThan(55);
        expect(new Set(courseTones(Array.from({ length: 12 }, (_, at) => course(`C${at}`, 3))).values()).size).toBe(12);
        expect(courseIdentity({ course: { code: '  abc  ', name: 'x' } })).toBe('ABC');
    });
    it('shares a tone, when it must, only between courses that never meet on the same day', () => {
        const courses = Array.from({ length: 14 }, (_, at) => course(`C${String(at).padStart(2, '0')}`, 1 + (at % 5)));
        const tones = courseTones(courses);
        for (const left of courses) for (const right of courses) {
            if (left !== right && left.weekday === right.weekday) expect(tones.get(left.course.code)).not.toBe(tones.get(right.course.code));
        }
    });
    it('has twelve distinct hues with WCAG AA normal-text contrast in both themes', () => {
        for (const theme of Object.values(tokens.course)) {
            expect(Object.keys(theme)).toHaveLength(12);
            expect(new Set(Object.values(theme).map(t=>t.bg)).size).toBe(12);
            for (const {bg,fg} of Object.values(theme)) expect((Math.max(luminance(bg),luminance(fg))+.05)/(Math.min(luminance(bg),luminance(fg))+.05)).toBeGreaterThanOrEqual(4.5);
        }
    });
});
