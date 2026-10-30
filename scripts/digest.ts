// Digest a data release into what the site serves:
//
//   public/data/<version>/search/        wasm-search bundle
//   public/data/<version>/timetable/     index.json + classes/<class>.json
//   public/data/<version>/exams/         index.json + classes/<class>.json
//   public/data/<version>/classrooms/    index.json + days/<date>.json
//   public/data/<version>/space/<campus>/ places, ways, routing network, basemap, map styles
//   src/data/campus-release.json         which version the pages use
//
// Input is the latest release of the private repository named by DATA_REPOSITORY,
// read with DATA_TOKEN (or the gh login), or a local data directory given as DATA_DIR.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { compileBundle } from 'wasm-search/compile';
import type { SearchDocument } from 'wasm-search';
import { campusConfig } from '../campus.config.ts';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const read = async <T>(path: string): Promise<T> => JSON.parse(await readFile(path, 'utf8')) as T;
const write = async (path: string, value: unknown) => {
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, JSON.stringify(value));
};

// ---- facts of the data release -------------------------------------------------
interface Index { built_at: string; content: string[]; teaching: string[]; exams: string[]; rooms?: string[]; space?: string[] }
interface Source { id: string; name: string; url: string; kind: string }
interface Doc { id: string; url: string; title: string; text: string; published: string | null; updated: string | null; section: string | null; kind: 'page' | 'file' | 'link'; tags: string[]; files: { name: string; url: string; ext: string | null }[] }
interface Term { term: string; year: number; number: number; weeks: { week: number; start: string; end: string }[]; observed_at: string }
interface Period { period: number; start: string; end: string; part: string | null }
interface Klass { id: string; name: string; grade: string | null; college: string | null; major: string | null; campus: string | null; students: number | null; practice: string[] }
interface Meeting {
    id: string; course: { code: string | null; name: string; category: string | null; nature: string | null; credits: number | null; hours: number | null; hours_composition: string | null; assessment: string | null; exam: string | null };
    teacher: string | null; teacher_title: string | null; role: string | null;
    teaching_class: { id: string | null; name: string | null; size: number | null; enrolled: number | null; capacity: number | null };
    campus: string | null; location: string | null; room: string | null; weekday: number; periods: [number, number]; weeks: number[]; method: string | null; classes: string[];
}
interface ExamFact { id: string; class: string; course: { code: string | null; name: string }; teacher: string | null; campus: string | null; location: string | null; room: string | null; date: string; start: string; end: string; students: number | null; note: string | null }
type Slot = { date: string; start: string; end: string; campus: string | null; location: string | null; teacher: string | null; students: number | null };
interface ChangeFact { observed: string; class: string; course: { code: string | null; name: string }; change: 'added' | 'removed' | 'changed'; before: Slot[] | null; after: Slot[] | null }
interface ExamSource { file: string; url: string; notice: string; title: string }
interface Room { id: string; building: string; floor: string; number: string; campus: string; kinds: string[]; names: string[]; listed?: boolean; seats?: number }
interface FreeDay { date: string; observed_at: string; free: Record<string, string[]> }

// The data repository is private: its latest release is read through the API with a
// token that may read it (DATA_TOKEN in CI, the gh login locally).
function dataToken(): string | undefined {
    if (process.env.DATA_TOKEN?.trim()) return process.env.DATA_TOKEN.trim();
    const gh = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8' });
    return gh.status === 0 ? gh.stdout.trim() : undefined;
}

async function locateData(): Promise<{ dir: string; version: string }> {
    const local = process.env.DATA_DIR;
    if (local) {
        const index = await read<Index>(join(local, 'index.json'));
        return { dir: local, version: `local-${index.built_at.replace(/\D/g, '').slice(0, 12)}` };
    }
    const token = dataToken();
    const repository = process.env.DATA_REPOSITORY?.trim();
    if (!repository || !token) throw new Error('set DATA_REPOSITORY and DATA_TOKEN (or log in with gh) to read the data release');
    const api = (path: string, accept = 'application/vnd.github+json') =>
        fetch(`https://api.github.com/repos/${repository}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: accept } });
    const latestResponse = await api('/releases/latest');
    if (!latestResponse.ok) throw new Error(`reading the latest data release: HTTP ${latestResponse.status}`);
    const latest = await latestResponse.json() as { tag_name: string; assets: { id: number; name: string }[] };
    // The release carries the facts archive and an evidence archive; the facts are wanted.
    const asset = latest.assets.find(a => a.name.endsWith('.tar.gz') && !a.name.startsWith('evidence'));
    if (!asset) throw new Error('the latest data release has no facts archive');
    const version = latest.tag_name;
    const dir = join(root, '.data', version);
    if (!existsSync(join(dir, 'index.json'))) {
        await mkdir(dir, { recursive: true });
        const archive = join(root, '.data', `${version}.tar.gz`);
        const download = await api(`/releases/assets/${asset.id}`, 'application/octet-stream');
        if (!download.ok) throw new Error(`downloading ${version}: HTTP ${download.status}`);
        await writeFile(archive, Buffer.from(await download.arrayBuffer()));
        const result = spawnSync('tar', ['-xzf', archive, '-C', dir], { stdio: 'inherit' });
        if (result.status !== 0) throw new Error('could not extract the data archive');
        await rm(archive);
    }
    return { dir, version };
}

// ---- search -----------------------------------------------------------------
function category(doc: Doc): string {
    const search = campusConfig.search;
    if (doc.kind === 'file') return search.fileCategory;
    if (doc.kind === 'link') return search.linkCategory;
    const text = [doc.title, doc.section ?? '', ...doc.tags].join(' ').toLowerCase();
    return search.categories.find(rule => rule.words.some(word => text.includes(word)))?.id ?? search.defaultCategory;
}

async function* searchDocuments(dir: string): AsyncGenerator<SearchDocument> {
    for (const source of await read<Source[]>(join(dir, 'content', 'sources.json'))) {
        for (const line of (await readFile(join(dir, 'content', `${source.id}.jsonl`), 'utf8')).split('\n')) {
            if (!line) continue;
            const doc = JSON.parse(line) as Doc;
            yield { ...doc, source: source.id, source_name: source.name, category: category(doc) };
        }
    }
}

// ---- timetable --------------------------------------------------------------
const termLabel = (n: number) => `第${'一二三'[n - 1] ?? n}学期`;

function meetingView(m: Meeting) {
    return {
        meeting_id: m.id,
        teaching_class_id: m.teaching_class.id,
        teaching_class_name: m.teaching_class.name,
        course_code: m.course.code,
        course_name: m.course.name,
        course_category: m.course.category,
        course_nature: m.course.nature,
        teacher: m.teacher,
        teacher_title: m.teacher_title,
        instructor_role: m.role,
        campus: m.campus,
        room_id: m.room,
        location: m.location,
        weekday: m.weekday,
        start_period: m.periods[0],
        end_period: m.periods[1],
        week_numbers: m.weeks,
        teaching_method: m.method,
        assessment_method: m.course.assessment,
        exam_method: m.course.exam,
        credits: m.course.credits,
        class_hours: m.course.hours,
        course_total_hours: m.course.hours,
        class_hours_composition: m.course.hours_composition,
        teaching_class_size: m.teaching_class.size,
        enrollment_count: m.teaching_class.enrolled,
        capacity: m.teaching_class.capacity,
        enrollment_note: null,
        direction: null,
        online_information: null,
        class_ids: m.classes,
    };
}

// ---- exams ------------------------------------------------------------------
const minutes = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));

function examView(e: ExamFact, term: string) {
    const fields = [e.class, e.course.code, e.course.name, e.teacher, e.campus, e.location, e.date, e.start, e.end, e.students, e.note];
    return {
        id: e.id,
        stable_key: e.id,
        history_key: `${e.class}|${e.course.code ?? e.course.name}`,
        content_fingerprint: createHash('sha1').update(JSON.stringify(fields)).digest('hex'),
        exam_period_id: term,
        class_name: e.class,
        course_name: e.course.name,
        course_code: e.course.code ?? '',
        teacher: e.teacher ?? '',
        campus: e.campus ?? '',
        location: e.location ?? '',
        raw_time: `${e.date} ${e.start}-${e.end}`,
        count: e.students ?? 0,
        start_timestamp: `${e.date}T${e.start}:00+08:00`,
        end_timestamp: `${e.date}T${e.end}:00+08:00`,
        duration_minutes: minutes(e.end) - minutes(e.start),
        date: e.date,
        notes: e.note ?? '',
    };
}

const slotField: Record<string, (slot: Slot) => string | number | null> = {
    raw_time: slot => `${slot.date} ${slot.start}-${slot.end}`,
    location: slot => slot.location,
    campus: slot => slot.campus,
    teacher: slot => slot.teacher,
    count: slot => slot.students,
};

function changeView(change: ChangeFact) {
    const fields = change.change !== 'changed' ? [] : Object.entries(slotField).flatMap(([field, value]) => {
        const before = [...new Set((change.before ?? []).map(value))];
        const after = [...new Set((change.after ?? []).map(value))];
        if (JSON.stringify(before) === JSON.stringify(after)) return [];
        const one = (values: (string | number | null)[]) => values.length === 1 ? values[0] ?? null : values.filter(v => v !== null) as string[];
        return [{ field, before: one(before), after: one(after) }];
    });
    return {
        type: change.change,
        history_key: `${change.class}|${change.course.code ?? change.course.name}`,
        course_name: change.course.name,
        course_code: change.course.code ?? '',
        teacher: (change.after ?? change.before ?? [])[0]?.teacher ?? '',
        fields,
    };
}

// ---- main -------------------------------------------------------------------
async function main() {
    // A build without access to the data release (EdgeOne's builder rebuilds after the CI
    // build) keeps the data this checkout already digested.
    const releaseFile = join(root, 'src', 'data', 'campus-release.json');
    if (!process.env.DATA_DIR && !(process.env.DATA_REPOSITORY && dataToken()) && existsSync(releaseFile)) {
        const { version: digested } = await read<{ version: string }>(releaseFile);
        if (existsSync(join(root, 'public', 'data', digested, 'timetable', 'index.json'))) {
            console.log(`no access to the data release; keeping the digested ${digested}`);
            return;
        }
    }
    const { dir, version } = await locateData();
    const index = await read<Index>(join(dir, 'index.json'));
    const outRoot = join(root, 'public', 'data');
    const out = join(outRoot, version);
    if (existsSync(outRoot)) {
        for (const entry of await readdir(outRoot)) await rm(join(outRoot, entry), { recursive: true, force: true });
    }
    console.log(`digesting ${version} from ${dir}`);

    const docs: SearchDocument[] = [];
    for await (const doc of searchDocuments(dir)) docs.push(doc);
    console.log('search', await compileBundle(docs, campusConfig.search.profile, join(out, 'search')));

    // Timetable of the latest captured term.
    const teachingTerm = index.teaching.at(-1);
    if (!teachingTerm) throw new Error('the data release has no teaching term');
    const tdir = join(dir, 'teaching', teachingTerm);
    const term = await read<Term>(join(tdir, 'term.json'));
    const periods = (await read<Period[]>(join(tdir, 'periods.json')))
        .map(p => ({ period: p.period, start_time: p.start, end_time: p.end, day_part: p.part ?? '' }));
    const weeks = term.weeks.map(w => ({ week: w.week, start_date: w.start, end_date: w.end }));
    const classes = await read<Klass[]>(join(tdir, 'classes.json'));
    const meetings = await read<Meeting[]>(join(tdir, 'meetings.json'));
    const termView = { academic_year: `${term.year}-${term.year + 1}`, term_number: term.number, weeks };
    const byClass = new Map<string, Meeting[]>(classes.map(c => [c.id, []]));
    for (const m of meetings) for (const id of m.classes) byClass.get(id)?.push(m);
    await write(join(out, 'timetable', 'index.json'), {
        observed_at: term.observed_at,
        term: termView,
        periods,
        classes: classes.map(c => ({ class_id: c.id, class_name: c.name, meeting_count: byClass.get(c.id)?.length ?? 0 })),
    });
    for (const c of classes) {
        const own = byClass.get(c.id) ?? [];
        await write(join(out, 'timetable', 'classes', `${c.id}.json`), {
            class: { class_id: c.id, class_name: c.name, grade: c.grade, college: c.college, major: c.major, campus: c.campus, students: c.students, practice: c.practice, meeting_ids: own.map(m => m.id) },
            meetings: own.map(meetingView),
        });
    }
    // Every teaching class of the term, for course search: retakes and electives a
    // class timetable does not list. Fields shared by a teaching class are written
    // once; each meeting is [id, weekday, first period, last period, weeks, location, room, teacher, title, role].
    const byTeachingClass = new Map<string, Meeting[]>();
    for (const m of meetings) {
        const key = m.teaching_class.id ?? m.id;
        byTeachingClass.set(key, [...(byTeachingClass.get(key) ?? []), m]);
    }
    await write(join(out, 'timetable', 'courses.json'), {
        observed_at: term.observed_at,
        courses: [...byTeachingClass].map(([id, list]) => {
            const { meeting_id: _id, teacher: _teacher, teacher_title: _title, instructor_role: _role, room_id: _room, location: _location,
                weekday: _weekday, start_period: _start, end_period: _end, week_numbers: _weeks,
                course_total_hours: _total, ...shared } = meetingView(list[0] as Meeting);
            return {
                ...Object.fromEntries(Object.entries(shared).filter(([, value]) => value !== null)),
                teaching_class_id: id,
                meetings: list.map(m => [m.id, m.weekday, m.periods[0], m.periods[1], m.weeks, m.location, m.room, m.teacher, m.teacher_title, m.role]),
            };
        }),
    });
    console.log('timetable', teachingTerm, classes.length, 'classes', byTeachingClass.size, 'teaching classes');

    // Exams of the latest published term.
    const examTerm = index.exams.at(-1);
    let examFacts: ExamFact[] = [];
    if (examTerm) {
        const edir = join(dir, 'exams', examTerm);
        examFacts = await read<ExamFact[]>(join(edir, 'exams.json'));
        const changes = await read<ChangeFact[]>(join(edir, 'changes.json'));
        const sources = existsSync(join(edir, 'sources.json')) ? await read<ExamSource[]>(join(edir, 'sources.json')) : [];
        const days = [...new Set(sources.map(s => s.file.slice(0, 10)))].sort();
        const latest = sources.at(-1);
        const updatedAt = `${days.at(-1) ?? index.built_at.slice(0, 10)}T00:00:00+08:00`;
        const [years = '', number = '1'] = [examTerm.slice(0, 9), examTerm.slice(10)];
        const examsByClass = new Map<string, ReturnType<typeof examView>[]>();
        for (const e of examFacts) {
            const list = examsByClass.get(e.class) ?? [];
            list.push(examView(e, examTerm));
            examsByClass.set(e.class, list);
        }
        const changesByDay = new Map<string, ChangeFact[]>();
        for (const c of changes) changesByDay.set(c.observed, [...(changesByDay.get(c.observed) ?? []), c]);
        const events = days.map((day, i) => {
            const own = changesByDay.get(day) ?? [];
            return {
                snapshot_id: day,
                previous_snapshot_id: days[i - 1] ?? null,
                source_updated_at: `${day}T00:00:00+08:00`,
                status: i === 0 ? 'baseline' : own.length ? 'changed' : 'unchanged',
                total_records: examFacts.length,
                total_classes: examsByClass.size,
                affected_class_count: new Set(own.map(c => c.class)).size,
                added: own.filter(c => c.change === 'added').length,
                removed: own.filter(c => c.change === 'removed').length,
                changed: own.filter(c => c.change === 'changed').length,
                unchanged: 0,
            };
        });
        const manifest = {
            exam_period_id: examTerm,
            academic_year: years,
            term_number: Number(number),
            term_label: termLabel(Number(number)),
            current_source_updated_at: updatedAt,
            observed_snapshot_count: days.length,
        };
        await write(join(out, 'exams', 'index.json'), {
            exam_period: { id: examTerm, academic_year: years, term_number: Number(number), term_label: termLabel(Number(number)) },
            source_url: latest?.notice ?? null,
            source_title: latest?.title ?? null,
            source_updated_at: updatedAt,
            classes: [...examsByClass].map(([class_name, list]) => ({ class_name, record_count: list.length })),
            history: { manifest, events: { exam_period_id: examTerm, observed_snapshot_count: days.length, events } },
        });
        for (const [className, list] of examsByClass) {
            const own = changes.filter(c => c.class === className);
            const eventDays = [...new Set(own.map(c => c.observed))].sort().reverse();
            const history = own.length ? {
                class_name: className,
                class_key: className,
                observed_snapshot_count: days.length,
                affected_event_count: eventDays.length,
                current_record_count: list.length,
                latest_affected_at: eventDays[0] ? `${eventDays[0]}T00:00:00+08:00` : null,
                events: eventDays.map(day => {
                    const dayChanges = own.filter(c => c.observed === day);
                    return {
                        snapshot_id: day,
                        previous_snapshot_id: days[days.indexOf(day) - 1] ?? null,
                        source_updated_at: `${day}T00:00:00+08:00`,
                        status: 'changed',
                        previous_record_count: list.length - dayChanges.filter(c => c.change === 'added').length + dayChanges.filter(c => c.change === 'removed').length,
                        current_record_count: list.length,
                        changes: dayChanges.map(changeView),
                    };
                }),
            } : null;
            await write(join(out, 'exams', 'classes', `${className}.json`), { class_name: className, exams: list, history });
        }
        console.log('exams', examTerm, examFacts.length, 'records');
    }

    // Classrooms. When the data release has the free-room page for the term, its room
    // list and its free periods decide; course and exam bookings then only say
    // what occupies a room. Without it, the rooms the timetable schedules and
    // their bookings are all there is.
    const freeDir = join(dir, 'rooms', teachingTerm);
    const measured = index.rooms?.includes(teachingTerm) ?? false;
    const scheduled = new Set(meetings.flatMap(m => m.room ? [m.room] : []));
    const rooms = (await read<Room[]>(join(dir, 'places', 'rooms.json'))).filter(r => measured ? r.listed : scheduled.has(r.id));
    const campuses = await read<{ id: string }[]>(join(dir, 'places', 'campuses.json'));
    const buildings = (await read<{ id: string; campus: string; floors: string[] }[]>(join(dir, 'places', 'buildings.json')))
        .map(b => ({ ...b, floors: b.floors.filter(level => rooms.some(r => r.building === b.id && r.floor === level)) }))
        .filter(b => b.floors.length);
    const floorId = (building: string, level: string) => `${building}/${level}`;
    const eligible = (kinds: string[]) => kinds.some(kind => campusConfig.classrooms.eligibleKinds.some(word => kind.includes(word)));
    await write(join(out, 'classrooms', 'index.json'), {
        term: { academic_year: termView.academic_year, term_number: term.number },
        weeks,
        periods,
        space: {
            campuses: campuses.filter(c => buildings.some(b => b.campus === c.id)).map(c => ({ campus_id: c.id, name: c.id })),
            buildings: buildings.map(b => ({ building_id: b.id, campus_id: b.campus, name: b.id, aliases: [] })),
            floors: buildings.flatMap(b => b.floors.map(level => ({ floor_id: floorId(b.id, level), building_id: b.id, level }))),
            families: rooms.map(r => ({
                space_family_id: r.id, building_id: r.building, floor_id: floorId(r.building, r.floor), room_number: r.number,
                aliases: r.names, kinds: r.kinds, availability_eligible: eligible(r.kinds) ? 'eligible' : 'ineligible',
                ...(r.seats ? { seats: r.seats } : {}),
            })),
        },
    });
    const roomById = new Map(rooms.map(r => [r.id, r]));
    let dayFiles = 0;
    for (const week of weeks) {
        for (let weekday = 1; weekday <= 7; weekday++) {
            const date = new Date(Date.parse(`${week.start_date}T00:00:00Z`) + (weekday - 1) * 86_400_000).toISOString().slice(0, 10);
            const byPeriod: Record<string, unknown[]> = {};
            for (const m of meetings) {
                const room = m.room ? roomById.get(m.room) : undefined;
                if (!room || m.weekday !== weekday || !m.weeks.includes(week.week)) continue;
                const booking = {
                    meeting_id: m.id, course_name: m.course.name, course_code: m.course.code, class_ids: m.classes, teacher: m.teacher,
                    location: m.location, space_family_id: room.id, floor_id: floorId(room.building, room.floor),
                    start_period: m.periods[0], end_period: m.periods[1],
                };
                for (let p = m.periods[0]; p <= m.periods[1]; p++) (byPeriod[String(p)] ??= []).push(booking);
            }
            const exams = examFacts.filter(e => e.date === date && e.room && roomById.has(e.room)).map(e => {
                const view = examView(e, examTerm ?? '');
                const room = roomById.get(e.room as string) as Room;
                return {
                    exam_id: view.id, stable_key: view.stable_key, class_name: view.class_name, course_name: view.course_name, course_code: view.course_code,
                    teacher: view.teacher, count: view.count, date, start_timestamp: view.start_timestamp, end_timestamp: view.end_timestamp,
                    duration_minutes: view.duration_minutes, location: view.location, campus: view.campus,
                    space_family_id: room.id, floor_id: floorId(room.building, room.floor),
                };
            });
            const freeFile = join(freeDir, `${date}.json`);
            const measuredDay = measured && existsSync(freeFile) ? await read<FreeDay>(freeFile) : null;
            const free = measuredDay ? Object.fromEntries(Object.entries(measuredDay.free).map(([p, ids]) => [p, ids.filter(id => roomById.has(id))])) : undefined;
            if (!Object.keys(byPeriod).length && !exams.length && !free) continue;
            await write(join(out, 'classrooms', 'days', `${date}.json`), {
                date, week: week.week, weekday, periods: byPeriod, exams,
                ...(measuredDay ? { free, checked_at: measuredDay.observed_at } : {}),
            });
            dayFiles++;
        }
    }
    console.log('classrooms', rooms.length, 'rooms', dayFiles, 'days', measured ? 'with free periods' : 'from the timetable only');

    // Campus space: the data as released, and the map styles bound to it. A style keeps two
    // tokens each client fills with its own base URLs: {data} (this campus's directory in
    // the data package) and {assets} (fonts and sprites, public/map/).
    for (const campus of index.space ?? []) {
        const from = join(dir, 'space', campus);
        const to = join(out, 'space', campus);
        await mkdir(to, { recursive: true });
        for (const file of ['places.json', 'places.geojson', 'ways.geojson', 'network.json', 'basemap.pmtiles']) {
            if (existsSync(join(from, file))) await copyFile(join(from, file), join(to, file));
        }
        // Places and rooms as their own small search bundle, so finding a place works offline
        // in the app and gives the same answer on the web.
        const places = await read<{ id: string; kind: string; names: string[]; houses?: string[]; parent?: string; floor?: string | null }[]>(join(from, 'places.json'));
        const placeDocs: SearchDocument[] = places.map(p => ({
            id: p.id, source: p.kind === 'room' ? 'rooms' : 'places', source_name: p.kind === 'room' ? '教室' : '地点',
            url: `/map/?place=${encodeURIComponent(p.id)}`, title: p.id,
            text: [...p.names, ...(p.houses ?? []), p.kind === 'room' ? `${p.parent ?? ''} ${p.floor ?? ''}楼` : ''].join(' '),
            published: null, updated: null, section: p.parent ?? null, kind: 'page', category: p.kind, tags: [], files: [],
        }));
        console.log('space search', await compileBundle(placeDocs, { aliases: [] }, join(to, 'search')));

        const shapes = await read<{ features: { properties: { kind: string }; geometry: unknown }[] }>(join(from, 'places.geojson'));
        const area = shapes.features.find(f => f.properties.kind === 'campus')?.geometry;
        for (const theme of ['light', 'dark']) {
            const template = await readFile(join(root, 'public', 'map', `style-${theme}.json`), 'utf8');
            const style = JSON.parse(template
                .replaceAll('{basemap}', '{data}/basemap.pmtiles')
                .replaceAll('{places}', '{data}/places.geojson')
                .replaceAll('{ways}', '{data}/ways.geojson')) as { layers: { id: string; source?: string; filter?: unknown }[] };
            // The campus speaks for itself: the basemap's own points of interest stop at its boundary.
            if (area) {
                for (const layer of style.layers) {
                    if (layer.source === 'basemap' && layer.id === 'pois') {
                        layer.filter = ['all', layer.filter ?? true, ['!', ['within', area]]];
                    }
                }
            }
            await write(join(to, `style-${theme}.json`), style);
        }
        console.log('space', campus);
    }

    await write(join(root, 'src', 'data', 'campus-release.json'), { version, base: `/data/${version}`, built_at: index.built_at });
}

await main();
