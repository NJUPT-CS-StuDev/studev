import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { packageFacts } from '../../../scripts/data/package-facts';
import { exam, meeting } from '../../../tests/campus-facts';
import type { ExamChange, RoomDay, TeachingClass, TeachingTerm } from './facts';

const tempRoot = process.platform === 'win32' ? 'D:/Temp/codex' : '/tmp/codex';
let taskDir: string, input: string, output: string;
const term: TeachingTerm = { term: '2026-2027-1', year: 2026, number: 1, weeks: [{ week: 1, start: '2026-08-31', end: '2026-09-06' }], observed_at: '2026-10-25T14:12:05Z' };
const klass: TeachingClass = { id: 'B240402', name: 'B240402', grade: '2024', college: '计算机学院', major: '计算机', campus: '仙林', students: 30, practice: ['课程设计'] };
const facts = [meeting({ teachers: [{ name: '甲', title: '教授', role: '主讲', weeks: [1] }, { name: '乙', title: null, role: '辅讲', weeks: [2] }] }), meeting({ id: 'elective', classes: [], teaching_class: { id: null, name: null, size: null, enrolled: null, capacity: null } })];
const exams = [exam()];
const changes: ExamChange[] = [{ observed: '2026-06-12', class: 'REMOVED', course: { code: 'JS102', name: '离散数学' }, change: 'removed', before: [{ date: '2026-07-01', start: '08:00', end: '09:50', campus: '仙林', location: '教1-101', teacher: null, students: null }], after: null }];
const day: RoomDay = { date: '2026-08-31', week: 1, weekday: 1, observed_at: '2026-10-25T14:46:45Z', free: { 1: ['教1-102'], 2: ['教1-101'] }, occupied: { '教1-101': [{ kind: 'class', id: facts[0]!.id, course: '算法', teachers: ['甲'], classes: ['B240402'], periods: [1, 2] }] } };
const sources = [{ file: '2026-06-12-安排.xlsx', url: 'https://example.test/exams.xlsx', notice: 'https://example.test/', title: '考试安排' }];
const periods = [{ period: 1, start: '08:00', end: '08:45', part: '上午' }];
const rooms = [{ id: '教1-101', building: '教1', floor: '1', number: '101', campus: '仙林', names: ['教1－101'], kinds: ['多媒体'], listed: true, seats: 30 }, { id: '非列表房间', building: '其他', floor: '', number: '非列表房间', campus: '仙林', names: [], kinds: [] }];
const buildings = [{ id: '教1', campus: '仙林', floors: ['1', '2'] }], campuses = [{ id: '仙林', aliases: ['仙林校区'] }];
const json = async <T>(path: string) => JSON.parse(await readFile(join(output, path), 'utf8')) as T;

beforeAll(async () => {
    await mkdir(tempRoot, { recursive: true });
    taskDir = await mkdtemp(join(tempRoot, 'web-contract-tests-'));
    input = join(taskDir, 'input'); output = join(taskDir, 'package');
    const files: Record<string, unknown> = {
        ['teaching/' + term.term + '/term.json']: term,
        ['teaching/' + term.term + '/periods.json']: periods,
        ['teaching/' + term.term + '/classes.json']: [klass],
        ['teaching/' + term.term + '/meetings.json']: facts,
        'exams/2025-2026-2/exams.json': exams, 'exams/2025-2026-2/changes.json': changes, 'exams/2025-2026-2/sources.json': sources,
        ['rooms/' + term.term + '/' + day.date + '.json']: day,
        'places/rooms.json': rooms, 'places/buildings.json': buildings, 'places/campuses.json': campuses,
    };
    for (const [path, value] of Object.entries(files)) {
        await mkdir(join(input, path, '..'), { recursive: true });
        await writeFile(join(input, path), JSON.stringify(value, null, 2) + '\n');
    }
    await packageFacts(input, output, { teaching: [term.term], exams: ['2025-2026-2'], rooms: [term.term] });
});
afterAll(async () => {
    if (taskDir && resolve(taskDir).startsWith(resolve(tempRoot) + sep)) await rm(taskDir, { recursive: true, force: true });
});

describe('data package contract', () => {
    it('copies the teaching files, full meeting catalogue, room days and global changes byte for byte', async () => {
        for (const path of ['term', 'periods', 'classes', 'meetings'].map(name => 'teaching/' + term.term + '/' + name + '.json').concat(['rooms/' + term.term + '/' + day.date + '.json', 'exams/2025-2026-2/changes.json'])) {
            expect(await readFile(join(output, path))).toEqual(await readFile(join(input, path)));
        }
    });
    it('splits a class without changing the class, course, teachers or any meeting field', async () => {
        expect(await json('teaching/' + term.term + '/classes/B240402.json')).toEqual({ class: klass, meetings: [facts[0]] });
        expect(await json('teaching/' + term.term + '/meetings.json')).toEqual(facts);
    });
    it('retains changes for a class whose exams have all been removed', async () => {
        expect(await json('exams/2025-2026-2/index.json')).toEqual({ classes: ['B240402', 'REMOVED'], sources });
        expect(await json('exams/2025-2026-2/classes/B240402.json')).toEqual({ exams, changes: [] });
        expect(await json('exams/2025-2026-2/classes/REMOVED.json')).toEqual({ exams: [], changes });
    });
    it('keeps every place, floor and room kind without deriving eligibility or occupancy', async () => {
        expect(await json('rooms/index.json')).toEqual({ term: term.term, weeks: term.weeks, periods, rooms, buildings, campuses });
        expect(await json('rooms/' + term.term + '/' + day.date + '.json')).toEqual(day);
        expect(await readdir(output)).toEqual(['exams', 'rooms', 'teaching']);
    });
});
