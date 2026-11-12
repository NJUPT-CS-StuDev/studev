// Run from the repo root. No network; freezes the web's actual results for Android to pass.
// node_modules/.bin/esbuild src/campus/world/parity/generate.ts --bundle --platform=node --format=esm --packages=external --alias:@=./src/campus --loader:.json=json --outfile=D:/Temp/claude-wsl/parity/generate.mjs
// node D:/Temp/claude-wsl/parity/generate.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { courseIdentity, courseTones, linkedCourse, sameCourse, timelineTones } from '@/timetable/model/courseColors';
import { attendingLabs, labCourseKey, labSheet, personalLabs } from '@/timetable/model/labs';
import { offWeekLessons } from '@/timetable/model/weekPattern';
import { customMeetings, parseWeeks, personalCourseName, type CustomCourse } from '@/timetable/model/courses';
import { moveTask, parseQuickTask, reminderAt, taskGroup, taskOrder, type Task, type TaskGroup } from '@/world/tasks';
import { availableSlots } from '@/world/planning';
import { reportTitle, suggestTasks } from '@/world/suggestions';
import { mergeTasks } from '@/world/sync';
import { preferenceKey, type EventPreferences } from '@/world/schedule';
import { dueOn, timeBounds } from '@/world/events';
import { readTimeline, schedulingTool, taskProposal, toolArguments } from '@/world/tools';
import tools from '@/world/tools.json';
import { attendingExams } from '@/timetable/model/examAttendance';
import { EXAM_REMINDERS, examReminderMinutes } from '@/timetable/model/calendar';
import { clusters, eventsOn, holidayMap, lastLesson, layers, meetingAround, nextEvent, overlapping, sharingSlot, planRuns, runTally, weekShown, type EventKind, type Timeline } from '@/world/events';
import { courseName, courseShort, roomLabel } from '@/world/names';
import { buildingWord, isClassroom, makeRoomReader } from '@/world/rooms';
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
    return { class: id, meetings, weeks: [1, 3, 8, 9, 10, 16].map(week => ({ week, cells: offWeekLessons(meetings, week) })) };
});
const line: Timeline = { term, periods, meetings: schedules[0]!.meetings, labs: [], exams: [], holidays, tasks: [], run: { rule: run, days: ['2026-09-08', '2026-09-10', '2026-11-05', '2026-11-09', '2026-12-18'], adjust: 5 } };
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
const labLine: Timeline = { term, periods, meetings: labMeetings, labs: classLabs, exams: [labExam], holidays, tasks: [], run: null };
const labBrief = (event: ReturnType<typeof eventsOn>[number]) => ({ ...brief(event), id: event.id, lab: event.lab?.id ?? null });
const orders: (readonly EventKind[])[] = [['exam', 'lab', 'class', 'run'], ['class', 'run', 'exam', 'lab']];
const dayOff = everyLab.find(lab => holidays.has(lab.date))!;
const offLine: Timeline = { ...labLine, labs: [dayOff], exams: [] };
// A course taken with another class: its lessons, and that class's labs among others'.
const other = 'B260424';
const added = read<{ meetings: TeachingMeeting[] }>(`${base}/teaching/${release.teaching}/classes/${other}.json`).meetings.filter(meeting => everyLab.some(lab => courseIdentity(lab) === courseIdentity(meeting) && lab.classes.includes(other)));
const nearby = everyLab.filter(lab => lab.classes.some(name => name.startsWith('B2604'))).slice(0, 80);
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
        { extraClasses: [] as string[], all: [] as Lab[] },
        { extraClasses: [...new Set(added.flatMap(meeting => meeting.classes))], all: nearby },
    ].map(test => ({ ...test, expected: personalLabs(classLabs, test.extraClasses, test.all).map(lab => lab.id) })),
    choices: [
        {}, { off: [labSheet(classLabs[0]!)] }, { drop: [labCourseKey(classLabs[0]!)] }, { skip: classLabs.slice(0, 3).map(lab => lab.id) },
    ].map(choices => ({ choices, expected: attendingLabs(classLabs, choices).map(lab => lab.id) })),
};
// Tasks: on the line where they have a time, due where they have only a day, grouped and ordered for the list.
const taskNow = { date: '2026-11-09', min: 16 * 60 };
const taskList: Task[] = [
    { id: 'a', title: '交毛概作业', date: '2026-11-10', start: 14 * 60, remind: [15, 1440], modified: 'm' },
    { id: 'b', title: '复习计网', date: '2026-11-09', start: 10 * 60, end: 11 * 60 + 30, due: { date: '2026-11-13', time: 23 * 60 + 59, remind: [60, 1440] }, priority: 3, modified: 'm' },
    { id: 'c', title: '毛概两个作业', due: { date: '2026-11-13', remind: [480] }, priority: 2, modified: 'm' },
    { id: 'd', title: '读论文', modified: 'm' },
    { id: 'e', title: '第一步', parent: 'b', date: '2026-11-09', start: 9 * 60, modified: 'm' },
    { id: 'f', title: '过期的', due: { date: '2026-11-01' }, modified: 'm' },
    { id: 'g', title: '下个月', date: '2026-12-20', start: 0, remind: [60], modified: 'm' },
];
const quickCourses = [...new Map(labMeetings.map(meeting => [courseIdentity(meeting), { identity: courseIdentity(meeting), names: [courseName(meeting.course.name), courseShort(meeting.course.name)] }])).values()];
const taskLine: Timeline = { ...labLine, tasks: taskList };
const tasks = {
    now: taskNow, list: taskList,
    days: ['2026-11-09', '2026-11-10', '2026-11-13'].map(date => ({ date, events: eventsOn(taskLine, date).map(labBrief), due: dueOn(taskLine, date).map(task => task.id), layers: layers(eventsOn(taskLine, date)).map(item => ({ id: item.event.id, under: item.under, over: item.over })) })),
    groups: taskList.map(task => ({ id: task.id, group: taskGroup(task, taskNow) })),
    order: [...taskList].sort(taskOrder).map(task => task.id),
    reminders: taskList.flatMap(task => (task.remind ?? []).map(remind => ({ id: task.id, remind, at: reminderAt(task, remind) }))),
    courses: quickCourses,
    sync: {
        mine: [{ id: 'a', title: '本机较新', modified: '2026-11-13T02:00:00.000Z' }, { id: 'b', title: '本机较旧', modified: '2026-11-13T01:00:00.000Z' }, { id: 'c', title: '同时', modified: '2026-11-13T01:00:00.000Z' }],
        theirs: [{ id: 'a', title: '别处较旧', modified: '2026-11-13T01:00:00.000Z' }, { id: 'b', title: '别处删了', modified: '2026-11-13T03:00:00.000Z', deleted: true as const }, { id: 'c', title: '别处同时', modified: '2026-11-13T01:00:00.000Z' }, { id: '0', title: '别处新加', modified: '2026-11-13T00:00:00.000Z' }],
        merged: [] as Task[],
        stamps: ['2026-11-13T01:00:00Z', '2026-11-13T01:00:00.5Z', '2026-11-13T01:00:00.123456Z'].map(at => ({ at, stamp: new Date(at).toISOString() })),
    },
    buildings: ['教三', '教三楼', '教3', '教学楼', '图科楼', '楼', '教十'].map(said => ({ said, word: buildingWord(said) })),
    suggestions: [{ now: { date: '2026-09-10', min: 600 }, setAside: [] as string[] }, { now: { date: '2026-10-01', min: 600 }, setAside: [] as string[] }, { now: { date: '2026-11-09', min: 600 }, setAside: [] as string[] }, { now: { date: '2026-11-09', min: 600 }, setAside: ['lab:' + classLabs.filter(lab => lab.date >= '2026-11-09')[0]!.id] }]
        .map(test => ({ ...test, expected: suggestTasks(taskLine, test.now, test.setAside) })),
    reportTitles: ['实验二：组网与路由器配置', 'Cachelab实验(上)', '数据库设计', '实验3: 进程调度'].map(project => ({ project, title: reportTitle(project) })),
    manual: [{ ...taskList[2]!, order: 1 }, { ...taskList[3]!, order: 0 }, ...taskList.filter((_, at) => at !== 2 && at !== 3)].sort(taskOrder).map(task => task.id),
    moves: ([['d', 'today', 0], ['c', 'tomorrow', 1], ['a', 'tomorrow', 0], ['b', 'someday', 0], ['a', 'later', 0], ['g', 'today', 5]] as [string, TaskGroup, number][]).map(([id, group, index]) => {
        const shown = taskList.filter(task => !task.parent && !task.done && taskGroup(task, taskNow) === group).sort(taskOrder);
        return { id, group, index, shown: shown.map(task => task.id), changed: moveTask(taskList.find(task => task.id === id)!, group, index, shown, taskNow) };
    }),
    parse: ['明天 14:00 交毛概作业', '下周五 毛概两个作业', '今天下午3点 复习计网', '周一晚上8点半 开会', '读论文', '周日 洗衣服', '中午12点 吃饭', '周五23:59前交报告', '明天18:00截止交作业',
        '大后天交实验报告', '今晚8点 背单词', '明早7点半跑步', '3天后 还书', '两周后 期中', '下下周三 答辩', '周末 大扫除', '这周六 聚餐', '11月20日 体测', '12/1 交论文', '25号 交电费', '十二号 开会',
        '月底前 交材料', '晚上8点到10点 自习', '14:00-16:00 实验课', '下午2点到4点半 社团', '3点15 打电话', '三点 开组会', '9am 早会', '有一点难的作业', '周五前 交作业 !!!', '复习 #计网 明天', '复习 #操作系统 !高',
        '1个月后 续费', '2月3日 返校', '2026-12-31 跨年', '明天早上8点 签到', '周三ddl 大作业', '第3-4节 上课'].map(input => ({ input, result: parseQuickTask(input, { date: '2026-11-12', min: 600 }, quickCourses) })),
};
tasks.sync.merged = mergeTasks(tasks.sync.mine, tasks.sync.theirs);
const scheduleDate = '2026-11-09';
const scheduleNow = { date: scheduleDate, min: 480 };
const scheduled = eventsOn(labLine, scheduleDate);
const slotRequest = { from: scheduleDate, to: scheduleDate, minutes: 30, earliest: 590, latest: 685 };
const semantics = {
    tools,
    toolTimeline: readTimeline(taskLine, scheduleDate, '2026-11-13'),
    toolSlots: schedulingTool(taskLine, { from: scheduleDate, to: scheduleDate, minutes: 30, task_id: 'b' }, scheduleNow),
    proposals: [
        { title: '新增报告', date: '2026-11-12', start: 1410, end: 1440, due_date: '2026-11-13', due_time: 1439 },
        { id: 'b', title: '移动复习', date: '2026-11-12', start: 600, end: 660 },
        { title: '仅截止', due_date: '2026-11-14' },
        { id: 'b', title: '标为完成', done: true },
    ].map(args => ({ args, expected: taskProposal(toolArguments('propose_task', args), taskLine) })),
    frames: [[], [{ id: 'early', title: '早起', date: scheduleDate, start: 0, end: 30, modified: 'm' }, { id: 'late', title: '晚间复习', date: scheduleDate, start: 1410, modified: 'm' }]].map(tasks => ({ tasks, expected: timeBounds(eventsOn({ ...labLine, tasks }, scheduleDate)) })),
    dueReminders: taskList.flatMap(task => (task.due?.remind ?? []).map(remind => ({ id: task.id, remind, at: reminderAt(task, remind, 'due') }))),
    scheduleDate, now: scheduleNow, request: slotRequest,
    cases: ['must', 'prefer', 'allow', 'layer-only'].map(mode => {
        const preferences: EventPreferences = Object.fromEntries(scheduled.map((event, i) => [preferenceKey(event, term.term), mode === 'layer-only' ? { layer: i + 1 } : { avoid: mode as 'must' | 'prefer' | 'allow' }]));
        const personal = { ...labLine, preferences };
        return { mode, preferences, events: eventsOn(personal, scheduleDate).map(event => ({ id: event.id, avoid: event.avoid, layer: event.layer })),
            layers: layers(eventsOn(personal, scheduleDate)).map(item => ({ id: item.event.id, under: item.under, over: item.over })),
            slots: availableSlots(personal, slotRequest, scheduleNow).slice(0, 4) };
    }),
};
// One's own courses become meetings; a name of one's own follows a course into its labs and exams.
const ownCourse: CustomCourse = { id: 'x1', name: '金工实习', days: [1, 3], periods: [1, 4], weeks: [16], room: '工程训练中心', teacher: '王老师' };
const ownNames = { [courseIdentity(linkedCourse(classLabs[0]!, labMeetings))]: '自己起的名', [courseIdentity(labMeetings.find(meeting => !sameCourse(classLabs[0]!, meeting))!)]: '另一个名' };
const courses = {
    custom: ownCourse,
    meetings: customMeetings(ownCourse).map(meeting => ({ id: meeting.id, teachingClass: meeting.teaching_class.id, name: meeting.course.name, weekday: meeting.weekday, periods: meeting.periods, weeks: meeting.weeks, room: meeting.room, teachers: meeting.teachers.map(teacher => teacher.name) })),
    names: ownNames,
    hidden: (() => {
        const names = { [courseIdentity(linkedCourse(classLabs[0]!, labMeetings))]: '自己的名（老师）' };
        const meetings = labMeetings.filter(meeting => !sameCourse(classLabs[0]!, meeting));
        const personal = { ...labLine, meetings, courseMeetings: labMeetings, names };
        return { meetings, names, date: classLabs[0]!.date, events: eventsOn(personal, classLabs[0]!.date).map(labBrief), tones: Object.fromEntries(timelineTones(personal)) };
    })(),
    renamed: {
        meetings: labMeetings.map(meeting => ({ id: meeting.id, name: personalCourseName(meeting, labMeetings, ownNames) ?? meeting.course.name })),
        labs: classLabs.map(lab => ({ id: lab.id, name: personalCourseName(lab, labMeetings, ownNames) ?? lab.course.name })),
        exams: [labExam].map(exam => ({ id: exam.id, name: personalCourseName(exam, labMeetings, ownNames) ?? exam.course.name })),
    },
    weeks: ['1-16', '1-8,10,12-14', '单1-15', '双 2-16', '3，5、7周', '0-3', '1-20', '9-3', '第一周', '', '16'].map(text => ({ text, weeks: parseWeeks(text, 18) })),
};
writeFileSync('src/campus/world/parity/golden.json', JSON.stringify({ semantics, courses, tasks, labs, places, from, recommend, hoursCases, runDays: line.run!.days, lastLesson: lastDay, around, tones, sharing, source: { release: release.version, teaching: release.teaching }, term, periods, calendar, run, schedules, days, moments, rooms: { days: roomDays, cases: rooms }, edgeCases: { colours, names, attendanceExams, examAttendance, examReminders } }, null, 1) + '\n');
console.log(JSON.stringify({ schedules: schedules.length, days: days.length, moments: moments.length, rooms: rooms.length }));
