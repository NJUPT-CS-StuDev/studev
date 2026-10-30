import { afterEach, describe, expect, it, vi } from 'vitest';
import { meeting, exam } from '../../../tests/campus-facts';
import { TeachingScheduleClient } from '@/timetable/model/TeachingScheduleClient';
import { ExamSnapshotClient } from '@/exams/model/ExamSnapshotClient';
import { ExamHistoryClient } from '@/exams/model/ExamHistoryClient';
import { ClassroomAvailabilityClient } from '@/classrooms/model/ClassroomAvailabilityClient';
import type { ExamChange, RoomDay, TeachingClass, TeachingTerm } from './facts';

afterEach(() => vi.unstubAllGlobals());
const term: TeachingTerm = { term: '2026-2027-1', year: 2026, number: 1, weeks: [{ week: 1, start: '2026-08-31', end: '2026-09-06' }], observed_at: '2026-10-25T14:12:05Z' };
const klass: TeachingClass = { id: 'B240402', name: 'B240402', campus: '仙林', college: null, grade: '2024', major: null, students: 30, practice: ['课程设计'] };
const periods = [{ period: 1, start: '08:00', end: '08:45', part: '上午' }];
const facts = [meeting(), meeting({ id: 'elective', classes: [] })];
const mockFiles = (files: Record<string, unknown>) => {
    const fetch = vi.fn(async (url: string) => new Response(JSON.stringify(files[url] ?? {}), { status: url in files ? 200 : 404 }));
    vi.stubGlobal('fetch', fetch);
    return fetch;
};

describe('fact readers', () => {
    it('loads separate teaching fact files and keeps elective meetings outside the class shard', async () => {
        const base = '/data/release/teaching/' + term.term;
        const fetch = mockFiles({
            [base + '/term.json']: term, [base + '/classes.json']: [klass], [base + '/periods.json']: periods,
            [base + '/classes/B240402.json']: { class: klass, meetings: [facts[0]] }, [base + '/meetings.json']: facts,
        });
        const client = new TeachingScheduleClient(base);
        const loaded = await client.loadClass(' b240402 ');
        expect(loaded).toEqual({ term, periods, classes: [klass], classInfo: klass, meetings: [facts[0]] });
        expect(fetch.mock.calls.map(([url]) => url)).not.toContain(base + '/meetings.json');
        expect(await client.suggest('B2404')).toEqual(['B240402']);
        expect((await client.loadCatalog()).flatMap(c => c.meetings)).toEqual(facts);
        await client.loadCatalog(); await client.loadClass('B240402');
        expect(fetch).toHaveBeenCalledTimes(5);
    });
    it('loads raw exam changes for removed classes without reconstructing snapshots', async () => {
        const base = '/data/release/exams/2025-2026-2';
        const change: ExamChange = { observed: '2026-06-12', class: 'REMOVED', course: { code: 'JS101', name: '算法' }, change: 'removed', before: [{ date: '2026-07-01', start: '08:00', end: '09:50', location: '教1-101', campus: '仙林', teacher: null, students: null }], after: null };
        const sources = [{ file: '2026-06-12-安排.xlsx', url: 'https://example.test/exams.xlsx', notice: 'https://example.test/', title: '考试安排' }];
        const fetch = mockFiles({
            [base + '/index.json']: { classes: ['B240402', 'REMOVED'], sources },
            [base + '/classes/B240402.json']: { exams: [exam()], changes: [] },
            [base + '/classes/REMOVED.json']: { exams: [], changes: [change] },
            [base + '/changes.json']: [change],
        });
        const exams = new ExamSnapshotClient(base), history = new ExamHistoryClient(exams);
        expect((await exams.search('B240402', null)).classMode.exams).toEqual([exam()]);
        expect(await history.loadClass('REMOVED')).toEqual([change]);
        expect(await history.loadClass('MISSING')).toBeNull();
        expect(await history.sources()).toEqual(sources);
        expect(await history.initialize()).toEqual({ sources, changes: [change] });
        expect(fetch.mock.calls.map(([url]) => url).filter(url => url === base + '/index.json')).toHaveLength(1);
    });
    it('loads a room day through the published term and returns free and occupied unchanged', async () => {
        const base = '/data/release/rooms';
        const index = { term: term.term, weeks: term.weeks, periods, rooms: [], buildings: [], campuses: [] };
        const day: RoomDay = { date: '2026-08-31', week: 1, weekday: 1, free: { 1: ['教1-101'] }, observed_at: '2026-10-25T14:46:45Z', occupied: { '教1-102': [{ kind: 'exam', id: 'exam', course: '算法', classes: ['B240402'], teachers: ['甲'], periods: [1, 2] }] } };
        const fetch = mockFiles({ [base + '/index.json']: index, [base + '/' + term.term + '/' + day.date + '.json']: day });
        const client = new ClassroomAvailabilityClient(base);
        expect(await client.initialize()).toEqual(index);
        expect(await client.day(day.date)).toEqual(day);
        expect(await client.day(day.date)).toEqual(day);
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(await client.day('2026-08-30')).toBeNull();
    });
});
