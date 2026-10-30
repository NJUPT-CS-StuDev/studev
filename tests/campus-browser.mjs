// Run after starting astro dev --background --host 127.0.0.1 --port 4400.
// node tests/campus-browser.mjs before|after <chrome-devtools-mcp entry.js>
// Screenshots and DOM text go to CAMPUS_SHOTS_DIR (the task evidence directory by default).
import {writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {join,resolve,sep} from 'node:path';
const phase=process.argv[2]??'before';
const out=process.env.CAMPUS_SHOTS_DIR ?? 'D:/Temp/claude-wsl/agents/web-contract/shots';
const entry=process.argv[3] ?? process.env.CHROME_DEVTOOLS_MCP_ENTRY;
if(!entry) throw Error('Pass the installed chrome-devtools-mcp JavaScript entry path as the second argument.');
const tempRoot=process.platform === 'win32' ? 'D:/Temp/codex' : '/tmp/codex';
await mkdir(tempRoot,{recursive:true});
const taskDir=await mkdtemp(join(tempRoot,'web-contract-browser-'));
const child=spawn(process.execPath,[entry,'--headless','--user-data-dir='+join(taskDir,'profile'),'--no-usage-statistics','--no-performance-crux','--allow-unrestricted-paths'],{stdio:['pipe','pipe','inherit'],windowsHide:true,env:{...process.env,TEMP:taskDir,TMP:taskDir}});
const pending=new Map();let requestId=0;
const lines=createInterface({input:child.stdout});
lines.on('line',line=>{try{const r=JSON.parse(line);if(r.id&&pending.has(r.id)){const p=pending.get(r.id);pending.delete(r.id);clearTimeout(p.timeout);r.error?p.reject(Error(JSON.stringify(r.error))):p.resolve(r.result);}}catch{}});
const rpc=(method,params)=>new Promise((resolve,reject)=>{const id=++requestId;const timeout=setTimeout(()=>{pending.delete(id);reject(Error('MCP request timed out: '+method));},90000);pending.set(id,{resolve,reject,timeout});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
let pageId;
const call=async(name,args)=>{const r=await rpc('tools/call',{name,arguments:{...(pageId===undefined?{}:{pageId}),...args}});if(r.isError)throw Error(JSON.stringify(r));return r;};
try {
await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'studev-campus-qa',version:'1'}});
child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
const opened=await call('new_page',{url:'http://127.0.0.1:4400/search/',isolatedContext:'web-contract-'+phase});
const pageText=opened.content.filter(c=>c.type==='text').map(c=>c.text).join('\n');
pageId=Number(/(?:^|\n)(\d+):[^\n]*\[selected\]/.exec(pageText)?.[1]);
if(!Number.isInteger(pageId))throw Error('Could not find the newly created page: '+pageText);
const states=[
['timetable-landing','/search/timetable/','查询班级课表'],
['timetable-week','/search/timetable/?class=B240402&week=9','timetable-course'],
['timetable-detail','/search/timetable/?class=B240402&week=9','timetable-course',"document.querySelector('.timetable-course').click()"],
['course-search','/search/timetable/?q=高等数学','course-result'],
['course-electives','/search/timetable/?q=艺术','course-result'],
['course-manager','/search/timetable/?class=B240402&week=9&q=大学英语','course-result'],
['exam-landing','/search/exam/','考试安排更新记录'],
['exams-class','/search/exam/?class=B240402','B240402 考试安排'],
['exams-history','/search/exam/?class=B240402','考试安排更新记录',"document.querySelector('section[aria-labelledby=\"exam-history-title\"]').scrollIntoView()"],
['classrooms-free','/search/classrooms/?date=2026-09-01&period=3&campus=仙林','classrooms-room'],
['classrooms-room','/search/classrooms/?date=2026-09-01&period=3&campus=仙林&room=教2-313','room-drawer'],
['search','/search/web/?q=奖学金','相关结果'],
];
await mkdir(out,{recursive:true});
await call('emulate',{viewport:'1440x1000x1',colorScheme:'light',prefersReducedMotion:'reduce'});
for(const [name,path,ready,action] of states){
 await call('navigate_page',{url:'http://127.0.0.1:4400'+path,initScript:`localStorage.clear();localStorage.setItem('studev_prefs',JSON.stringify({class:'B240402',campus:'仙林'}));const RealDate=Date;window.Date=class extends RealDate{constructor(...a){super(...(a.length?a:['2026-10-30T12:00:00Z']));}static now(){return new RealDate('2026-10-30T12:00:00Z').getTime();}};`});
 await call('evaluate_script',{function:`async()=>{const deadline=performance.now()+25000;while(performance.now()<deadline){if(document.body.innerText.includes(${JSON.stringify(ready)})||document.querySelector('.'+${JSON.stringify(ready)}))break;await new Promise(r=>setTimeout(r,100));}await document.fonts.ready;const s=document.createElement('style');s.textContent='*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}astro-dev-toolbar{display:none!important}';document.head.appendChild(s);${action??''};await new Promise(r=>setTimeout(r,500));return {url:location.href,text:document.body.innerText};}`,filePath:`${out}/${phase}-${name}.json`});
 await call('take_screenshot',{filePath:`${out}/${phase}-${name}.png`,fullPage:false});
 console.log(phase,name);
}

if(phase === 'after') {
 await call('navigate_page',{url:'http://127.0.0.1:4400/search/timetable/?class=B240402&week=9&q=艺术'});
 await call('evaluate_script',{function:(async()=>{
  const wait=async(test)=>{for(let i=0;i<200;i++){if(test())return;await new Promise(r=>setTimeout(r,100));}throw Error('Interaction did not settle');};
  const assert=(ok,message)=>{if(!ok)throw Error(message);};
  const prefs=()=>JSON.parse(localStorage.getItem('studev_prefs'));
  await wait(()=>document.querySelector('.course-result button'));
  document.querySelector('.course-result button').click();
  await wait(()=>prefs().timetable?.['2026-2027-1']?.added.length===1);
  document.querySelector('[aria-label="关闭课程管理"]').click();
  await wait(()=>!document.querySelector('.course-manager'));
  document.querySelector('.timetable-manage').click();
  await wait(()=>document.querySelector('[aria-label^="移出 "]'));
  document.querySelector('[aria-label^="移出 "]').click();
  await wait(()=>!(prefs().timetable?.['2026-2027-1']?.added.length));
  const hide=document.querySelector('[aria-label^="不上 "]');
  hide.click();
  await wait(()=>prefs().timetable?.['2026-2027-1']?.hidden.length===1);
  document.querySelector('[aria-label^="恢复 "]').click();
  await wait(()=>!(prefs().timetable?.['2026-2027-1']?.hidden.length));
  document.querySelector('[aria-label="关闭课程管理"]').click();
  await wait(()=>!document.querySelector('.course-manager'));
  document.querySelector('[aria-label="下一周"]').click();
  await wait(()=>location.search.includes('week=10'));
  assert(document.querySelector('.timetable-toolbar h1').textContent==='第10周','Week navigation failed');
  return {addElective:true,removeElective:true,hideCourse:true,restoreCourse:true,nextWeek:true};
 }).toString(),filePath:out+'/after-timetable-interactions.json'});
 await call('navigate_page',{url:'http://127.0.0.1:4400/search/exam/?class=B240402'});
 await call('evaluate_script',{function:(async()=>{
  const wait=async(test)=>{for(let i=0;i<200;i++){if(test())return;await new Promise(r=>setTimeout(r,100));}throw Error('Exam interaction did not settle');};
  const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text);
  const selected=()=>document.querySelectorAll('input[type=checkbox]:checked').length;
  await wait(()=>document.querySelector('input[type=checkbox]'));
  const count=selected();
  button('取消全选').click();await wait(()=>selected()===0);
  button('全选').click();await wait(()=>selected()===count);
  document.querySelector('input[type=checkbox]').click();await wait(()=>selected()===count-1);
  // Capture the generated download without writing into the user's Downloads directory.
  HTMLAnchorElement.prototype.click=function(){window.qaCalendar=fetch(this.href).then(r=>r.text());};
  document.querySelector('[aria-label="导出 ICS 日历文件"]').click();
  await wait(()=>window.qaCalendar);
  const ics=await window.qaCalendar;
  if((ics.match(/BEGIN:VEVENT/g)??[]).length!==count-1)throw Error('Calendar export lost exams');
  const key=Object.keys(localStorage).find(key=>key.startsWith('studev:exam-selection:'));
  const state=JSON.parse(localStorage.getItem(key));
  if(state.selected.length!==count-1||!state.selected[0].course||'fingerprint' in state.selected[0])throw Error('Export did not store original facts');
  return {selectAll:true,clearSelection:true,toggleSelection:true,calendarEvents:count-1,rawExportState:true};
 }).toString(),filePath:out+'/after-exam-interactions.json'});
 console.log('after interactions passed');
}
} finally {
 child.stdin.end();
 await new Promise(resolve=>{if(child.exitCode!==null)resolve();else child.once('exit',resolve);});
 lines.close();
 if(resolve(taskDir).startsWith(resolve(tempRoot)+sep))await rm(taskDir,{recursive:true,force:true});
}
