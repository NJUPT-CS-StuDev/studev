import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TeachingTerm, TeachingPeriod, TeachingClass, TeachingMeeting, Exam, ExamChange, ExamSource, Lab, Room, Building, Campus } from '../../src/campus/world/facts.ts';

export interface FactTerms { teaching: string[]; exams: string[]; labs: string[]; rooms?: string[] }
const read = async <T>(path: string): Promise<T> => JSON.parse(await readFile(path, 'utf8')) as T;
const write = async (path: string, value: unknown) => { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, JSON.stringify(value)); };
interface MapPlace { id: string; kind: string; parent?: string; name?: string; names?: readonly string[] }

/** Package facts while deriving academic room indexes from canonical map ids. */
export async function packageFacts(dir: string, out: string, index: FactTerms, mapPlaces: MapPlace[]) {
    const teachingTerm = index.teaching.at(-1); if (!teachingTerm) throw new Error('the data release has no teaching term');
    const from = join(dir, 'teaching', teachingTerm); const to = join(out, 'teaching', teachingTerm); await mkdir(to, { recursive: true });
    for (const file of ['term.json', 'periods.json', 'classes.json', 'meetings.json']) await copyFile(join(from, file), join(to, file));
    const classes = await read<TeachingClass[]>(join(from, 'classes.json')); const meetings = await read<TeachingMeeting[]>(join(from, 'meetings.json')); const byClass = new Map(classes.map(c => [c.id, [] as TeachingMeeting[]])); for (const meeting of meetings) for (const id of meeting.classes) byClass.get(id)?.push(meeting); for (const c of classes) await write(join(to, 'classes', c.id + '.json'), { class: c, meetings: byClass.get(c.id) });
    const examTerm = index.exams.at(-1); if (examTerm) { const examFrom = join(dir, 'exams', examTerm); const exams = await read<Exam[]>(join(examFrom, 'exams.json')); const changes = await read<ExamChange[]>(join(examFrom, 'changes.json')); const sources = await read<ExamSource[]>(join(examFrom, 'sources.json')); const { at: checked } = await read<{ at: string }>(join(examFrom, 'checked.json')); const examTo = join(out, 'exams', examTerm); await mkdir(examTo, { recursive: true }); await copyFile(join(examFrom, 'changes.json'), join(examTo, 'changes.json')); await copyFile(join(examFrom, 'exams.json'), join(examTo, 'exams.json')); const examClasses = [...new Set([...exams.flatMap(e => e.classes), ...changes.map(c => c.class)])]; await write(join(examTo, 'index.json'), { classes: examClasses, sources, checked }); for (const c of examClasses) await write(join(examTo, 'classes', c + '.json'), { exams: exams.filter(e => e.classes.includes(c)), changes: changes.filter(change => change.class === c) }); }
    // Labs sit on the teaching term's own weeks, so only that term's are packaged: one file for all, one per class.
    const labTerm = index.labs.includes(teachingTerm) ? teachingTerm : undefined;
    if (labTerm) { const labs = await read<Lab[]>(join(dir, 'labs', labTerm, 'labs.json')); const labTo = join(out, 'labs', labTerm); await write(join(labTo, 'labs.json'), labs); const labClasses = [...new Set(labs.flatMap(lab => lab.classes))]; await write(join(labTo, 'index.json'), { classes: labClasses }); for (const c of labClasses) await write(join(labTo, 'classes', c + '.json'), { labs: labs.filter(lab => lab.classes.includes(c)) }); }
    const roomTerm = index.rooms?.at(-1); if (!roomTerm) throw new Error('the data release has no rooms term'); const term = await read<TeachingTerm>(join(dir, 'teaching', roomTerm, 'term.json')); const rawRooms = await read<any[]>(join(dir, 'places', 'rooms.json'));
    const places = new Map(mapPlaces.map(place => [place.id, place]));
    const rooms: Room[] = rawRooms.flatMap(raw => {
        const map = places.get(raw.id);
        // A room the map has not drawn is still a room: the teaching office says where it is.
        if (!map) {
            const name = String(raw.names?.[0] ?? raw.id.slice(raw.id.indexOf(':') + 1)).replace(/[－—–]/g, '-');
            // The name knows the building better than the office's grouping: 教东-101 is room 101 of 教东, a building of its own.
            const written = /^([^-()（）]+)-([^()（）]+)$/.exec(name);
            const building = written ? written[1]! : !raw.building || raw.building === '无楼号' ? '其他' : String(raw.building);
            const number = written ? written[2]! : name.startsWith(building) ? name.slice(building.length).replace(/^-/, '') || name : name;
            return [{ id: raw.id, building, floor: String(raw.floor ?? ''), number, campus: raw.campus, kinds: raw.kinds ?? [], names: raw.names ?? [], listed: raw.listed ?? false, seats: raw.seats }];
        }
        if (map.kind !== 'room') throw new Error(`a teaching room is not a room on the map: ${raw.id}`);

        let ancestor = map.parent ? places.get(map.parent) : undefined;
        let floor = '';
        while (ancestor && ancestor.kind !== 'building') {
            if (ancestor.kind === 'floor') floor = ancestor.id.slice(ancestor.id.lastIndexOf('/') + 1);
            ancestor = ancestor.parent ? places.get(ancestor.parent) : undefined;
        }
        if (!ancestor) throw new Error(`mapped room has no building ancestor: ${map.id}`);
        const building = ancestor.id.slice(ancestor.id.indexOf('/') + 1);
        const title = String(map.name ?? map.names?.[0] ?? raw.name ?? map.id.slice(map.id.lastIndexOf('/') + 1)).replace(/[－—–]/g, '-');
        const number = title.startsWith(building + '-') ? title.slice(building.length + 1) : title;
        return [{ id: raw.id, building, floor, number, campus: ancestor.id.slice(0, ancestor.id.indexOf('/')), kinds: raw.kinds ?? [], names: raw.names ?? [], listed: raw.listed ?? false, seats: raw.seats, exam_seats: raw.exam_seats }];
    });
    const buildingsById = new Map<string, Building>();
    for (const place of mapPlaces.filter(item => item.kind === 'building')) {
        const slash = place.id.indexOf('/');
        buildingsById.set(place.id, { id: place.id.slice(slash + 1), campus: place.id.slice(0, slash), floors: [] });
    }
    for (const room of rooms) {
        const building = buildingsById.get(`${room.campus}/${room.building}`);
        if (building && !building.floors.includes(room.floor)) building.floors.push(room.floor);
    }
    await write(join(out, 'rooms', 'index.json'), { term: roomTerm, weeks: term.weeks, periods: await read<TeachingPeriod[]>(join(dir, 'teaching', roomTerm, 'periods.json')), rooms, buildings: [...buildingsById.values()], campuses: [...new Set(rooms.map(room => room.campus))].map(id => ({ id, aliases: [] } satisfies Campus)) });
    const roomFrom = join(dir, 'rooms', roomTerm); const roomTo = join(out, 'rooms', roomTerm); await mkdir(roomTo, { recursive: true }); for (const file of await readdir(roomFrom)) await copyFile(join(roomFrom, file), join(roomTo, file));
    return { teaching: teachingTerm, ...(examTerm ? { exams: examTerm } : {}), ...(labTerm ? { labs: labTerm } : {}), rooms: roomTerm };
}
