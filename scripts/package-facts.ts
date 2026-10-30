import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TeachingTerm, TeachingPeriod, TeachingClass, TeachingMeeting, Exam, ExamChange, ExamSource, Room, Building, Campus } from '../src/campus/academics/facts.ts';

export interface FactTerms { teaching: string[]; exams: string[]; rooms?: string[] }
const read = async <T>(path: string): Promise<T> => JSON.parse(await readFile(path, 'utf8')) as T;
const write = async (path: string, value: unknown) => {
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, JSON.stringify(value));
};

/** Package the current terms; preserve all objects and the order within each shard. */
export async function packageFacts(dir: string, out: string, index: FactTerms) {
    const teachingTerm = index.teaching.at(-1);
    if (!teachingTerm) throw new Error('the data release has no teaching term');
    // Splitting by administrative class preserves every fact object and its order.
    // The complete meetings file is only 4.02 MB (222,384 bytes gzip in the measured release),
    // loaded lazily for course search, so it needs no additional shard vocabulary.
    for (const termId of [teachingTerm]) {
        const from = join(dir, 'teaching', termId);
        const to = join(out, 'teaching', termId);
        await mkdir(to, { recursive: true });
        for (const file of ['term.json', 'periods.json', 'classes.json', 'meetings.json']) {
            await copyFile(join(from, file), join(to, file));
        }
        const classes = await read<TeachingClass[]>(join(from, 'classes.json'));
        const meetings = await read<TeachingMeeting[]>(join(from, 'meetings.json'));
        const byClass = new Map(classes.map(c => [c.id, [] as TeachingMeeting[]]));
        for (const meeting of meetings) for (const id of meeting.classes) byClass.get(id)?.push(meeting);
        for (const c of classes) await write(join(to, 'classes', c.id + '.json'), { class: c, meetings: byClass.get(c.id) });
        console.log('teaching', termId, classes.length, 'classes', meetings.length, 'meetings');
    }

    const examTerm = index.exams.at(-1);
    for (const termId of examTerm ? [examTerm] : []) {
        const from = join(dir, 'exams', termId);
        const exams = await read<Exam[]>(join(from, 'exams.json'));
        const changes = await read<ExamChange[]>(join(from, 'changes.json'));
        const sources = await read<ExamSource[]>(join(from, 'sources.json'));
        await mkdir(join(out, 'exams', termId), { recursive: true });
        await copyFile(join(from, 'changes.json'), join(out, 'exams', termId, 'changes.json'));
        // Include classes with removed exams, which still have published changes.
        const classes = [...new Set([...exams.map(e => e.class), ...changes.map(c => c.class)])];
        await write(join(out, 'exams', termId, 'index.json'), { classes, sources });
        for (const c of classes) await write(join(out, 'exams', termId, 'classes', c + '.json'), {
            exams: exams.filter(e => e.class === c), changes: changes.filter(change => change.class === c),
        });
        console.log('exams', termId, exams.length, 'records');
    }

    const roomTerm = index.rooms?.at(-1);
    if (!roomTerm) throw new Error('the data release has no rooms term');
    const term = await read<TeachingTerm>(join(dir, 'teaching', roomTerm, 'term.json'));
    await write(join(out, 'rooms', 'index.json'), {
        term: roomTerm,
        weeks: term.weeks,
        periods: await read<TeachingPeriod[]>(join(dir, 'teaching', roomTerm, 'periods.json')),
        rooms: await read<Room[]>(join(dir, 'places', 'rooms.json')),
        buildings: await read<Building[]>(join(dir, 'places', 'buildings.json')),
        campuses: await read<Campus[]>(join(dir, 'places', 'campuses.json')),
    });
    for (const termId of [roomTerm]) {
        const from = join(dir, 'rooms', termId);
        const to = join(out, 'rooms', termId);
        await mkdir(to, { recursive: true });
        for (const file of await readdir(from)) await copyFile(join(from, file), join(to, file));
        console.log('rooms', termId);
    }

    return { teaching: teachingTerm, ...(examTerm ? { exams: examTerm } : {}), rooms: roomTerm };
}
