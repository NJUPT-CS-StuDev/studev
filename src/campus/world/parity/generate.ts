// Run from the repo root. No network; freezes the web's actual results for Android to pass.
// node_modules/.bin/esbuild src/campus/academics/parity/generate.ts --bundle --platform=node --format=esm --packages=external --alias:@=./src/campus --loader:.json=json --outfile=D:/Temp/claude-wsl/parity/generate.mjs
// node D:/Temp/claude-wsl/parity/generate.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { timetableCells } from '@/timetable/model/presentation';
import { courseIdentity, courseToneIndex } from '@/timetable/model/courseColors';
import { attendingExams } from '@/timetable/model/examAttendance';
import { eventsOn, holidayMap, nextEvent, planRuns, runTally, type Timeline } from '@/world/events';
import { courseName, courseShort, roomLabel } from '@/world/names';
import { isClassroom, makeRoomReader } from '@/world/rooms';
import type { CalendarTerm, MorningRun, RoomIndex } from '@/world/data';
import type { TeachingMeeting, TeachingPeriod, TeachingTerm, Exam, RoomDay } from '@/world/facts';

const read = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const release = read<{ version: string; teaching: string; exams?: string }>('src/data/campus-release.json');
const base = `public/data/${release.version}`;
const term = read<TeachingTerm>(`${base}/teaching/${release.teaching}/term.json`);
const periods = read<TeachingPeriod[]>(`${base}/teaching/${release.teaching}/periods.json`);
const calendar = read<{ terms: CalendarTerm[] }>(`${base}/calendar.json`).terms;
const run = read<Record<string, MorningRun>>(`${base}/morning-run.json`)[term.term]!;
const holidays = holidayMap(calendar);
const classes = ['B240402', 'B250105', 'B230402'];
const schedules = classes.map(id => {
    const { meetings } = read<{ meetings: TeachingMeeting[] }>(`${base}/teaching/${release.teaching}/classes/${id}.json`);
    return { class: id, meetings, weeks: [1, 3, 8, 9, 10, 16].map(week => ({ week, cells: timetableCells(meetings, week) })) };
});
const line: Timeline = { term, periods, meetings: schedules[0]!.meetings, exams: [], holidays, run: { rule: run, days: { '2026-09-08': 'done', '2026-09-10': 'done', '2026-11-05': 'plan', '2026-11-09': 'plan', '2026-12-18': 'plan' }, adjust: 5 } };
const brief = (event: ReturnType<typeof eventsOn>[number]) => ({ kind: event.kind, name: event.name, short: event.short, start: event.start, end: event.end, room: event.room });
const days = ['2026-09-25', '2026-10-01', '2026-10-12', '2026-11-05', '2026-11-09', '2026-12-18', '2026-12-21', '2027-01-01'].map(date => ({ date, events: eventsOn(line, date).map(brief) }));
const moments = [{ date: '2026-11-05', min: 13 * 60 + 5 }, { date: '2026-11-07', min: 7 * 60 }, { date: '2027-01-14', min: 22 * 60 }].map(now => ({ now, next: (event => event && brief(event))(nextEvent(line, now)), run: runTally(line.run!), plan: Object.keys(planRuns(line.run!, line, now)).sort() }));
const index = read<RoomIndex>(`${base}/rooms/index.json`);
const reader = makeRoomReader(periods);
const roomDays = ['2026-11-05', '2026-11-09'].map(date => read<RoomDay>(`${base}/rooms/${index.term}/${date}.json`));
const sampleRooms = index.rooms.filter(isClassroom).filter((_, position) => position % 9 === 0);
const rooms = roomDays.flatMap(day => [7 * 60 + 30, 8 * 60 + 10, 12 * 60, 13 * 60 + 5, 19 * 60, 22 * 60].flatMap(min => sampleRooms.map(room => {
    const state = reader(day, room.id, min);
    return { date: day.date, min, room: room.id, tier: state.tier, busy: state.busy, until: state.until, minutes: state.minutes };
})));
const colours = [
    { code: '  js101\u00a0', name: '忽略课程名' }, { code: 'A\tB', name: '保留代码内部空白' },
    { code: null, name: '\ufeff 😀课程\u3000' }, { code: ' ', name: '  两个\t\n空格  ' },
    { code: '\u001c', name: '不折叠非 ECMAScript 空白' }, { code: 'ß', name: '统一大小写' },
].map(course => ({ course, identity: courseIdentity({ course }), colourIndex: courseToneIndex({ course }) }));
const names = ['操作系统基础', '计算机通信与网络（双语）', '习近平新时代中国特色社会主义思想概论', '仙林/教4-309', '仙林/图书馆-201', '翻转课堂线上自学'].map(value => ({ value, course: courseName(value), short: courseShort(value), room: roomLabel(value) }));
const attendanceExams = [{ id: 'a', course: { code: 'X1', name: '甲' } }, { id: 'b', course: { code: 'X2', name: '乙' } }, { id: 'c', course: { code: null, name: '丙' } }] as Exam[];
const examAttendance = [
    { choices: {}, ownCodes: null }, { choices: { a: false }, ownCodes: null }, { choices: {}, ownCodes: ['X1'] }, { choices: { b: true }, ownCodes: ['X1'] },
].map(test => ({ ...test, expected: attendingExams(attendanceExams, test.choices as Record<string, boolean>, test.ownCodes && new Set(test.ownCodes)).map(exam => exam.id) }));
writeFileSync('src/campus/academics/parity/golden.json', JSON.stringify({ runDays: line.run!.days, source: { release: release.version, teaching: release.teaching }, term, periods, calendar, run, schedules, days, moments, rooms: { days: roomDays, cases: rooms }, edgeCases: { colours, names, attendanceExams, examAttendance } }, null, 1) + '\n');
console.log(JSON.stringify({ schedules: schedules.length, days: days.length, moments: moments.length, rooms: rooms.length }));
