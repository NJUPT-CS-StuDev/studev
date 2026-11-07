import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { packageFacts } from '../../../scripts/data/package-facts';
import type { Exam, ExamChange, Room, Building, TeachingClass, TeachingMeeting } from './facts';

const tempRoot = process.platform === 'win32' ? 'D:/Temp/codex' : '/tmp/codex';
const read = async <T>(path: string): Promise<T> => JSON.parse(await readFile(path, 'utf8')) as T;
let taskDir: string, input: string, output: string;
let release: { version: string; data_version: string; teaching: string; exams: string; rooms: string };
let places: Array<{ id: string; kind: string; parent?: string; names?: string[] }>;
beforeAll(async () => {
    await mkdir(tempRoot, { recursive: true });
    taskDir = await mkdtemp(join(tempRoot, 'web-contract-tests-'));
    output = join(taskDir, 'package');
    release = await read('src/data/campus-release.json');
    input = join('.data', release.data_version);
    places = await read(join('public/data', release.version, 'space/仙林/entities.json'));
    await packageFacts(input, output, { teaching: [release.teaching], exams: [release.exams], rooms: [release.rooms] }, places);
});
afterAll(async () => {
    if (taskDir && resolve(taskDir).startsWith(resolve(tempRoot) + sep)) await rm(taskDir, { recursive: true, force: true });
});

describe('the production map and data package contract', () => {
    it('copies real teaching facts, room days and global exam changes byte for byte', async () => {
        const files = ['term', 'periods', 'classes', 'meetings'].map(name => `teaching/${release.teaching}/${name}.json`);
        const days = await readdir(join(input, 'rooms', release.rooms));
        files.push(...days.map(day => `rooms/${release.rooms}/${day}`), `exams/${release.exams}/changes.json`);
        for (const path of files) expect(Buffer.compare(await readFile(join(output, path)), await readFile(join(input, path)))).toBe(0);
    });
    it('retains all original fields when splitting real class teaching and exam shards', async () => {
        const classes = await read<TeachingClass[]>(join(input, `teaching/${release.teaching}/classes.json`));
        const meetings = await read<TeachingMeeting[]>(join(input, `teaching/${release.teaching}/meetings.json`));
        for (const klass of classes.filter(item => ['B240402', 'B250105', 'B230402'].includes(item.id))) {
            expect(await read(join(output, `teaching/${release.teaching}/classes/${klass.id}.json`))).toEqual({ class: klass, meetings: meetings.filter(meeting => meeting.classes.includes(klass.id)) });
        }
        const exams = await read<Exam[]>(join(input, `exams/${release.exams}/exams.json`));
        const changes = await read<ExamChange[]>(join(input, `exams/${release.exams}/changes.json`));
        const index = await read<{ classes: string[] }>(join(output, `exams/${release.exams}/index.json`));
        for (const klass of index.classes) expect(JSON.stringify(await read(join(output, `exams/${release.exams}/classes/${klass}.json`)))).toBe(JSON.stringify({ exams: exams.filter(exam => exam.classes.includes(klass)), changes: changes.filter(change => change.class === klass) }));
    });
    it('keeps every listed room, uses map parents where the map has it and preserves partitioned classroom numbers', async () => {
        const index = await read<{ rooms: Room[]; buildings: Building[] }>(join(output, 'rooms/index.json'));
        const source = await read<Room[]>(join(input, 'places/rooms.json'));
        const mapped = new Set(places.filter(place => place.kind === 'room').map(place => place.id));
        expect(index.rooms.map(room => room.id).sort()).toEqual(source.map(room => room.id).sort());
        for (const room of index.rooms.filter(room => mapped.has(room.id))) expect(index.buildings.some(building => building.id === room.building && building.campus === room.campus)).toBe(true);
        for (const number of ['213-1', '312-1', '412-1']) expect(index.rooms.find(room => room.id === `仙林/教3-${number}`)).toMatchObject({ building: '教3', number, floor: number.slice(0, 1) });
    });
});
