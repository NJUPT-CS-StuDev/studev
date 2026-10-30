// DATA_DIR=<njupt-data/out> node tests/verify-campus-package.mjs
// Verify the complete built package against the producer, including every shard.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const input = process.env.DATA_DIR;
if (!input) throw new Error('Set DATA_DIR to njupt-data/out.');
const read = async (base, path) => JSON.parse(await readFile(join(base, path), 'utf8'));
const release = await read(root, 'src/data/campus-release.json');
const out = join(root, 'public/data', release.version);
const sameFile = async path => assert.deepEqual(await readFile(join(out, path)), await readFile(join(input, path)), path);
for (const name of ['term', 'periods', 'classes', 'meetings']) await sameFile('teaching/' + release.teaching + '/' + name + '.json');
const classes = await read(input, 'teaching/' + release.teaching + '/classes.json');
const meetings = await read(input, 'teaching/' + release.teaching + '/meetings.json');
for (const klass of classes) assert.deepEqual(await read(out, 'teaching/' + release.teaching + '/classes/' + klass.id + '.json'), {
    class: klass, meetings: meetings.filter(m => m.classes.includes(klass.id)),
});
const exams = await read(input, 'exams/' + release.exams + '/exams.json');
const changes = await read(input, 'exams/' + release.exams + '/changes.json');
const examClasses = [...new Set([...exams.map(e => e.class), ...changes.map(c => c.class)])];
assert.deepEqual(await read(out, 'exams/' + release.exams + '/index.json'), { classes: examClasses, sources: await read(input, 'exams/' + release.exams + '/sources.json') });
await sameFile('exams/' + release.exams + '/changes.json');
for (const klass of examClasses) assert.deepEqual(await read(out, 'exams/' + release.exams + '/classes/' + klass + '.json'), {
    exams: exams.filter(e => e.class === klass), changes: changes.filter(c => c.class === klass),
});
const term = await read(input, 'teaching/' + release.rooms + '/term.json');
assert.deepEqual(await read(out, 'rooms/index.json'), {
    term: release.rooms, weeks: term.weeks, periods: await read(input, 'teaching/' + release.rooms + '/periods.json'),
    rooms: await read(input, 'places/rooms.json'), buildings: await read(input, 'places/buildings.json'), campuses: await read(input, 'places/campuses.json'),
});
const days = await readdir(join(input, 'rooms', release.rooms));
for (const file of days) await sameFile('rooms/' + release.rooms + '/' + file);
console.log(JSON.stringify({ version: release.version, teachingClasses: classes.length, meetings: meetings.length, examClasses: examClasses.length, exams: exams.length, changes: changes.length, roomDays: days.length, result: 'All copied files and class shards match njupt-data.' }, null, 2));
