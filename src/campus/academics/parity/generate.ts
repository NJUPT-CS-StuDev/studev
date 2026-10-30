// Run from the repo root. No network, no changes to source data; freeze the web's actual results.
// node_modules/.bin/esbuild src/campus/academics/parity/generate.ts --bundle --platform=node --format=esm --packages=external --alias:@=./src/campus --outfile=D:/Temp/codex/parity/generate.mjs
// node D:/Temp/codex/parity/generate.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { timetableCells } from '@/timetable/model/presentation';
import { courseIdentity, courseToneIndex } from '@/timetable/model/courseColors';
import { examPresentation } from '@/exams/model/presentation';
import { roomSelectionResult, type RoomSelection } from '@/classrooms/model/roomSelection';
import { toggleBuilding } from '@/classrooms/model/buildingSelection';
import type { TeachingMeeting, TeachingPeriod, TeachingTerm, Exam, RoomDay } from '@/academics/facts';
import type { ClassroomIndexFile } from '@/classrooms/model/ClassroomAvailabilityClient';

const read = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const release = read<{version:string; teaching:string; exams:string}>('src/data/campus-release.json');
const base = `public/data/${release.version}`;
const term = read<TeachingTerm>(`${base}/teaching/${release.teaching}/term.json`);
const periods = read<TeachingPeriod[]>(`${base}/teaching/${release.teaching}/periods.json`);
const schedules = ['B240402', 'B250105', 'B230402'].map(klass => {
    const {meetings} = read<{meetings:TeachingMeeting[]}>(`${base}/teaching/${release.teaching}/classes/${klass}.json`);
    return { class:klass, meetings, weeks:[1,3,8,9,10,16].map(week => ({week, cells:timetableCells(meetings,week)})) };
});
const exams = ['B240402', 'B250105', 'B230402'].map(klass => {
    const {exams} = read<{exams:Exam[]}>(`${base}/exams/${release.exams}/classes/${klass}.json`);
    const first = exams[0]!;
    const start = Date.parse(`${first.date}T${first.start}:00+08:00`);
    const end = Date.parse(`${first.date}T${first.end}:00+08:00`);
    const times = [start-2*86_400_000, start-86_400_000, start-1, start, end-1, end, end+86_400_000].map(time=>new Date(time).toISOString());
    return { class:klass, exams, cases:times.map(now=>({now, cells:exams.map(exam=>examPresentation(exam,new Date(now)))})) };
});
const index = read<ClassroomIndexFile>(`${base}/rooms/index.json`);
const days = ['2026-09-02','2026-10-26','2026-10-30'].map(date=>read<RoomDay>(`${base}/rooms/${index.term}/${date}.json`));
const roomCases = days.flatMap(day => ['仙林','三牌楼'].flatMap(campus => {
    const ids = index.buildings.filter(b=>b.campus===campus && index.rooms.some(r=>r.building===b.id && r.listed)).map(b=>b.id).sort();
    return [null, [], ids.slice(0,1), ids.slice(0,2)].flatMap(buildings => [[1,1],[6,9],[10,12]].map(([from,until])=> {
        const selection: RoomSelection = {campus,buildings,everything:false,query:'',minSeats:0,from:from!,until:until!};
        return { date:day.date, selection, expected:roomSelectionResult(index,day,selection) };
    }));
}));
for (const selection of [
    {campus:'仙林', buildings:['教3','教4'],everything:false,query:'',minSeats:0,from:3,until:3},
    {campus:'仙林', buildings:null, everything:true,query:'图',minSeats:0,from:1,until:4},
    {campus:'仙林', buildings:['教3','教4'],everything:false,query:'３',minSeats:60,from:3,until:5},
    {campus:'仙林', buildings:['教3'],everything:false,query:'',minSeats:150,from:8,until:9},
] satisfies RoomSelection[]) roomCases.push({ date:days[2]!.date, selection, expected:roomSelectionResult(index,days[2]!,selection) });
const inputsHash = createHash('sha256').update(JSON.stringify({schedules:schedules.map(s=>s.meetings),exams:exams.map(e=>e.exams),index,days})).digest('hex');
// Supplemental policy inputs are synthetic strings, never added to campus facts.
const colours = [
    {code:'  js101\u00a0',name:'忽略课程名'}, {code:'A\tB',name:'保留代码内部空白'},
    {code:null,name:'\ufeff 😀课程\u3000'}, {code:' ',name:'  两个\t\n空格  '},
    {code:'\u001c',name:'不折叠非 ECMAScript 空白'}, {code:'ß',name:'统一大小写'},
].map(course=>({course,identity:courseIdentity({course}),colourIndex:courseToneIndex({course})}));
const buildingTransitions = [
    {selected:null as string[] | null, all:['教3','实验楼'],toggle:'教3'},
    {selected:['教3','实验楼'],all:['教3','教4','实验楼'],toggle:'教4'},
    {selected:[],all:['教3','教4'],toggle:'教3'},
].map(test=>({...test,expected:toggleBuilding(test.selected,test.all,test.toggle)}));
const invalidExams = [
    {...exams[0]!.exams[0]!,date:'2026-02-31'}, {...exams[0]!.exams[0]!,start:'24:00'},
    {...exams[0]!.exams[0]!,date:'',start:'',end:'',location:null,room:null},
].map(exam=>({exam,now:'2026-10-30T00:00:00Z',expected:examPresentation(exam,new Date('2026-10-30T00:00:00Z'))}));
writeFileSync('src/campus/academics/parity/golden.json',JSON.stringify({source:{release:release.version,teaching:release.teaching,exams:release.exams,inputsHash},term,periods,schedules,exams,rooms:{index,days,cases:roomCases},edgeCases:{colours,buildingTransitions,invalidExams}},null,2)+'\n');
console.log(JSON.stringify({schedules:schedules.length,weeks:schedules.flatMap(s=>s.weeks).length,cells:schedules.flatMap(s=>s.weeks.flatMap(w=>w.cells)).length,examCases:exams.flatMap(e=>e.cases).length,roomCases:roomCases.length,inputsHash}));
