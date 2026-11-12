// Run from the repo root. No network; freezes the web's actual results for Android to pass.
// node_modules/.bin/esbuild src/campus/world/parity/generate.ts --bundle --platform=node --format=esm --packages=external --alias:@=./src/campus --loader:.json=json --outfile=D:/Temp/claude-wsl/parity/generate.mjs
// node D:/Temp/claude-wsl/parity/generate.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { courseIdentity, courseTones, timelineTones } from '@/timetable/model/courseColors';
import { personalLabs } from '@/timetable/model/labs';
import { offWeekLessons } from '@/timetable/model/weekPattern';
import { attendingExams } from '@/timetable/model/examAttendance';
import { EXAM_REMINDERS, examReminderMinutes } from '@/timetable/model/calendar';
import { clusters, eventsOn, holidayMap, lastLesson, layers, meetingAround, nextEvent, overlapping, sharingSlot, planRuns, runTally, weekShown, type EventKind, type Timeline } from '@/world/events';
import { courseName, courseShort, roomLabel } from '@/world/names';
import { isClassroom, makeRoomReader } from '@/world/rooms';
import { openingStatus, recommendations } from '../../map/model/homePolicy';
import type { Place } from '../../map/model/space';
import type { CalendarTerm, MorningRun, RoomIndex } from '@/world/data';
import type { TeachingMeeting, TeachingPeriod, TeachingTerm, Exam, Lab, RoomDay } from '@/world/facts';

const read = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const release = read<{ version: string; teaching: string; exams?: string; labs: string }>('src/data/campus-release.json');
const base = `public/data/${release.version}`;
const term = read<TeachingTerm>(`${base}/teaching/${release.teaching}/term.json`);
const periods = read<TeachingPeriod[]>(`${base}/teaching/${release.teaching}/periods.json`);
const calendar = read<{ terms: CalendarTerm[] }>(`${base}/calendar.json`).terms;
const run = read<Record<string, MorningRun>>(`${base}/morning-run.json`)[term.term]!;
const holidays = holidayMap(calendar);
const classes = ['B240402', 'B250105', 'B230402'];
const schedules = classes.map(id => {
    const { meetings } = read<{ meetings: TeachingMeeting[] }>(`${base}/teaching/${release.teaching}/classes/${id}.json`);
    return { class: id, meetings, weeks: [1, 3, 8, 9, 10, 16].map(week => ({ week, cells: offWeekLessons(meetings, week, courseTones(meetings)) })) };
});
const line: Timeline = { term, periods, meetings: schedules[0]!.meetings, labs: [], exams: [], holidays, run: { rule: run, days: ['2026-09-08', '2026-09-10', '2026-11-05', '2026-11-09', '2026-12-18'], adjust: 5 } };
const brief = (event: ReturnType<typeof eventsOn>[number]) => ({ kind: event.kind, name: event.name, short: event.short, start: event.start, end: event.end, room: event.room });
const days = ['2026-09-25', '2026-10-01', '2026-10-12', '2026-10-23', '2026-11-05', '2026-11-09', '2026-12-18', '2026-12-21', '2027-01-01'].map(date => ({ date, events: eventsOn(line, date).map(brief) }));
const moments = [{ date: '2026-11-05', min: 13 * 60 + 5 }, { date: '2026-11-05', min: 7 * 60 + 30 }, { date: '2026-11-07', min: 7 * 60 }, { date: '2026-11-08', min: 20 * 60 }, { date: '2027-01-14', min: 22 * 60 }].map(now => ({ now, next: (event => event && brief(event))(nextEvent(line, now)), run: runTally(line.run!, now), plan: planRuns(line.run!, line, now), week: weekShown(line, now) }));
const lastDay = lastLesson(line);
const sharing = ['2026-11-12', '2026-11-19', '2026-11-20'].flatMap(date => eventsOn(line, date).filter(event => event.kind === 'class').map(event => ({ event: event.id, others: sharingSlot(line, event).map(other => other.id) })));
const around = line.meetings.slice(0, 8).flatMap(meeting => ['2026-08-31', '2026-11-09', '2027-01-11'].map(from => ({ meeting: meeting.id, from, date: meetingAround(line, meeting.id, from)?.date ?? null })));
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
].map(course => ({ course, identity: courseIdentity({ course }) }));
const tones = schedules.map(schedule => ({ class: schedule.class, tones: Object.fromEntries(courseTones(schedule.meetings)) }));
const names = ['操作系统基础', '计算机通信与网络（双语）', '习近平新时代中国特色社会主义思想概论', '仙林/教4-309', '仙林/图书馆-201', '翻转课堂线上自学'].map(value => ({ value, course: courseName(value), short: courseShort(value), room: roomLabel(value) }));
const attendanceExams = [{ id: 'a', course: { code: 'X1', name: '甲' } }, { id: 'b', course: { code: 'X2', name: '乙' } }, { id: 'c', course: { code: null, name: '丙' } }] as Exam[];
const examAttendance = [
    { choices: {}, ownCodes: null }, { choices: { a: false }, ownCodes: null }, { choices: {}, ownCodes: ['X1'] }, { choices: { b: true }, ownCodes: ['X1'] },
].map(test => ({ ...test, expected: attendingExams(attendanceExams, test.choices as Record<string, boolean>, test.ownCodes && new Set(test.ownCodes)).map(exam => exam.id) }));
const examReminders = EXAM_REMINDERS.flatMap(({ key }) => [8 * 60, 13 * 60 + 30, 18 * 60 + 30].map(start => ({ key, start, minutes: examReminderMinutes(key, start) })));
const placeRows = JSON.parse(readFileSync(`public/data/${release.version}/space/仙林/entities.json`, 'utf8')) as Place[];
const hourFacts = JSON.parse(readFileSync(`public/data/${release.version}/hours.json`, 'utf8')) as Record<string, { hours: Place['hours'] }>;
const places = placeRows.filter(place => place.featured).map(place => ({ ...place, ...(hourFacts[place.id] ? { hours: hourFacts[place.id]!.hours } : {}) }));
const from: [number, number] = [118.9262, 32.1146];
const recommend = [1, 3, 6, 7].flatMap(day => [6, 8, 12, 15, 17, 18, 20, 23].map(hour => ({ day, hour, minute: 30, expected: recommendations(places, { day, hour, minute: 30 }, from).map(({ place, status }) => ({ id: place.id, state: status.state })) })));
const hoursCases = [{ week: { '5': [['08:00', '12:00'], ['13:30', '17:00']] } }, { week: { '7': [['22:00', '02:00']] } }, { week: Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map(day => [String(day), [['00:00', '00:00']]])) }].flatMap(hours => [[5, 8, 0], [5, 11, 40], [5, 12, 0], [5, 13, 30], [1, 1, 50], [1, 2, 0], [7, 22, 0], [3, 12, 0]].map(([day, hour, minute]) => ({ hours, day, minute: hour! * 60 + minute!, state: openingStatus(hours as Place['hours'], { day: day!, hour: hour!, minute: minute! }).state })));
// Labs: a class whose lab takes a lecture's slot, one on a day off, and what hiding or adding a course does to them.
// B240402 has two labs at once on 11-09 and a lab starting halfway through a lecture on 12-07.
const labClass = 'B240402';
const labMeetings = read<{ meetings: TeachingMeeting[] }>(`${base}/teaching/${release.teaching}/classes/${labClass}.json`).meetings;
const classLabs = read<{ labs: Lab[] }>(`${base}/labs/${release.labs}/classes/${labClass}.json`).labs;
const everyLab = read<Lab[]>(`${base}/labs/${release.labs}/labs.json`);
const examined = classLabs.filter(lab => !holidays.has(lab.date))[1]!;
const labExam = { id: 'x', classes: [labClass], course: examined.course, teacher: null, campus: null, location: '教3－303', room: null, date: examined.date, start: examined.start, end: examined.end, students: null, note: null, source: 'x.xlsx', kind: 'event', subtype: 'exam' } as unknown as Exam;
const labLine: Timeline = { term, periods, meetings: labMeetings, labs: classLabs, exams: [labExam], holidays, run: null };
const labBrief = (event: ReturnType<typeof eventsOn>[number]) => ({ ...brief(event), id: event.id, lab: event.lab?.id ?? null });
const orders: (readonly EventKind[])[] = [['exam', 'lab', 'class', 'run'], ['class', 'run', 'exam', 'lab']];
const dayOff = everyLab.find(lab => holidays.has(lab.date))!;
const offLine: Timeline = { ...labLine, labs: [dayOff], exams: [] };
// A course taken with another class: its lessons, and that class's labs among others'.
const other = 'B260424';
const added = read<{ meetings: TeachingMeeting[] }>(`${base}/teaching/${release.teaching}/classes/${other}.json`).meetings.filter(meeting => everyLab.some(lab => courseIdentity(lab) === courseIdentity(meeting) && lab.classes.includes(other)));
const nearby = everyLab.filter(lab => lab.classes.some(name => name.startsWith('B2604'))).slice(0, 80);
const labCourse = courseIdentity(classLabs[0]!);
const labs = {
    class: labClass, meetings: labMeetings, labs: classLabs, exam: labExam,
    days: [...new Set(classLabs.map(lab => lab.date))].map(date => {
        const events = eventsOn(labLine, date);
        return {
            date, events: events.map(labBrief),
            alongside: events.map(event => overlapping(labLine, event).map(other => other.id)),
            layers: orders.map(order => layers(events, order).map(item => ({ id: item.event.id, under: item.under, over: item.over }))),
            clusters: orders.map(order => clusters(events, order).map(run => ({ front: run.front.id, events: run.events.map(event => event.id), start: run.start, end: run.end }))),
        };
    }),
    dayOff: { lab: dayOff, events: eventsOn(offLine, dayOff.date).map(labBrief) },
    moments: classLabs.slice(0, 3).map(lab => ({ date: lab.date, min: 7 * 60 })).map(now => ({ now, next: (event => event ? labBrief(event) : null)(nextEvent(labLine, now)) })),
    tones: Object.fromEntries(timelineTones(labLine)), last: lastLesson(labLine),
    personal: [
        { kept: labMeetings.map(meeting => meeting.id), added: [] as TeachingMeeting[], all: [] as Lab[] },
        { kept: labMeetings.filter(meeting => courseIdentity(meeting) !== labCourse).map(meeting => meeting.id), added: [] as TeachingMeeting[], all: [] as Lab[] },
        { kept: labMeetings.map(meeting => meeting.id), added, all: nearby },
    ].map(test => ({ ...test, expected: personalLabs(classLabs, labMeetings, labMeetings.filter(meeting => test.kept.includes(meeting.id)), test.added, test.all).map(lab => lab.id) })),
};
writeFileSync('src/campus/world/parity/golden.json', JSON.stringify({ labs, places, from, recommend, hoursCases, runDays: line.run!.days, lastLesson: lastDay, around, tones, sharing, source: { release: release.version, teaching: release.teaching }, term, periods, calendar, run, schedules, days, moments, rooms: { days: roomDays, cases: rooms }, edgeCases: { colours, names, attendanceExams, examAttendance, examReminders } }, null, 1) + '\n');
console.log(JSON.stringify({ schedules: schedules.length, days: days.length, moments: moments.length, rooms: rooms.length }));
