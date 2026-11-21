// Exercise the APK itself over the released campus data: an upgrade preserving its cache,
// then a fresh start, search, knowledge links, the map and a route.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const apk = process.argv[2];
const resume = process.argv.includes('--resume');
const personalOnly = process.argv.includes('--personal');
const routesOnly = process.argv.includes('--routes');
const entriesOnly = process.argv.includes('--entries');
if (!apk || !existsSync(apk)) throw new Error(`no APK at ${apk}`);
const root = fileURLToPath(new URL('../..', import.meta.url));
const sdk = process.env.ANDROID_HOME ?? 'D:\\Dev\\Android\\Sdk';
const adbPath = join(sdk, 'platform-tools', 'adb.exe');
const avd = process.env.STUDEV_SMOKE_AVD ?? 'studev-2';
const badging = execFileSync(join(sdk, 'build-tools', '36.1.0', 'aapt.exe'), ['dump', 'badging', apk], { encoding: 'utf8' });
const app = /package: name='([^']+)'/.exec(badging)?.[1] ?? (() => { throw new Error(`no package in ${apk}`); })();
if (!/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/.test(app)) throw new Error(`invalid package identity: ${app}`);
const product = JSON.parse(readFileSync(join(root, 'product.json'), 'utf8'));
const origin = product.origin;
const release = JSON.parse(readFileSync(join(root, 'src/data/campus-release.json'), 'utf8'));
const data = join(root, 'public/data', release.version);
const knowledge = JSON.parse(readFileSync(join(data, 'knowledge/knowledge.json'), 'utf8'));
const ownSchedule = JSON.parse(readFileSync(join(data, `teaching/${release.teaching}/classes/B240402.json`), 'utf8')).meetings;
const examIndex = JSON.parse(readFileSync(join(data, `exams/${release.exams}/index.json`), 'utf8'));
const examChanges = JSON.parse(readFileSync(join(data, `exams/${release.exams}/changes.json`), 'utf8'));
const teachingClasses = JSON.parse(readFileSync(join(data, `teaching/${release.teaching}/classes.json`), 'utf8'));
const affectedExam = examChanges.find(change => teachingClasses.some(klass => klass.id === change.class));
const latestExam = examIndex.history.at(-1);
const ownExamChanges = examChanges.filter(change => change.version === latestExam.id && change.class === 'B240402').length;
const examImpact = ownExamChanges ? `本班 ${ownExamChanges} 门考试有变动` : '本次更新未影响本班';
if (!affectedExam || !examIndex.history.some(version => version.baseline)) throw new Error('the actual release has no exam baseline or affected class');
const navigationMeeting = ownSchedule.find(meeting => meeting.teachers.length > 0 && meeting.course.code);
const navigationExam = JSON.parse(readFileSync(join(data, `exams/${release.exams}/exams.json`), 'utf8'))[0];
const managedCourse = ownSchedule.find(meeting => meeting.course.name.includes('计算机通信与网络')) ?? ownSchedule[0];
const managedName = managedCourse.course.name.replace(/[（(].*?[)）]/g, '').trim();
const course = knowledge.courses.find(c => c.name === '数据结构');
const texts = new Map();
const textOf = path => {
    if (!texts.has(path)) texts.set(path, readFileSync(join(data, 'knowledge', path), 'utf8'));
    return texts.get(path);
};
// Prefer a short real explanation whose question has a visible link back to that exact topic.
const candidates = knowledge.topics.filter(t => t.taught_by.includes(course.id)).sort((a, b) => textOf(a.path).length - textOf(b.path).length);
let topic, reference, backlink;
for (const candidate of candidates) {
    for (const ref of candidate.references) {
        if (!knowledge.materials.some(m => m.path === ref.material && m.course === course.id)) continue;
        const section = textOf(ref.material).split(/^### /m).find(part => part.startsWith(`${ref.heading}\n`));
        const named = [...(section ?? '').matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)].find(([, , href]) => decodeURIComponent(href) === candidate.path);
        if (named) { topic = candidate; reference = ref; backlink = named[1]; break; }
    }
    if (topic) break;
}
if (!topic) throw new Error('the released course has no question/topic backlink to exercise');
const places = JSON.parse(readFileSync(join(data, 'space/仙林/entities.json'), 'utf8'));
const model = JSON.parse(readFileSync(join(data, 'space/仙林/model.json'), 'utf8'));
const opening = places.find(place => place.id === product.campus.opens);
const floors = Object.entries(model.floors).filter(([id]) => id.startsWith(`${opening?.id}/`)).map(([, floor]) => floor.level).sort((a, b) => a - b);
const destination = places.find(place => place.id === '仙林/教1-101');
const start = places.find(place => place.id === '仙林/教1-102');
if (!opening || floors.length < 2 || !destination || !start) throw new Error('the released map has no opening floors or classroom route');
const evidence = process.env.STUDEV_SMOKE_DIR ?? 'D:\\Temp\\codex\\studev-android-smoke';
mkdirSync(evidence, { recursive: true });
const sleep = ms => new Promise(done => setTimeout(done, ms));
let serial;
let startedEmulator = false;
const adb = (...args) => execFileSync(adbPath, [...(serial ? ['-s', serial] : []), ...args], { encoding: 'utf8', timeout: 120_000 });

async function device() {
    const online = () => [...adb('devices').matchAll(/^(emulator-\d+)\s+device$/gm)].map(m => m[1]);
    const selected = () => online().find(id => execFileSync(adbPath, ['-s', id, 'emu', 'avd', 'name'], { encoding: 'utf8' }).split(/\r?\n/)[0].trim() === avd);
    serial = selected();
    if (serial) return;
    console.log(`starting emulator ${avd}`);
    startedEmulator = true;
    spawn(join(sdk, 'emulator', 'emulator.exe'), ['-avd', avd, '-no-window', '-no-snapshot-save', '-no-audio'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    for (let i = 0; i < 120; i++) {
        serial = selected();
        if (serial && adb('shell', 'getprop', 'sys.boot_completed').trim() === '1') return;
        await sleep(2000);
    }
    throw new Error('the emulator did not finish booting');
}

/** Populate the selected emulator's ordinary release cache before the new release is public. */
async function seedRelease() {
    if (process.env.STUDEV_SMOKE_ONLINE === '1') return;
    if (!/^emulator-\d+$/.test(serial ?? '')) throw new Error('release seeding is restricted to the owned emulator');
    if (!/^[A-Za-z0-9._-]+$/.test(release.version)) throw new Error('invalid compiled release identity');
    adb('root'); adb('wait-for-device');
    const owner = adb('shell', 'stat', '-c', '%u:%g', `/data/user/0/${app}`).trim();
    if (!/^\d+:\d+$/.test(owner)) throw new Error(`invalid emulator app owner: ${owner}`);
    const cache = `/data/user/0/${app}/files/campus`;
    adb('shell', 'mkdir', '-p', cache);
    adb('shell', 'chown', owner, `/data/user/0/${app}/files`);
    const facts = `${cache}${release.base}`;
    adb('shell', 'mkdir', '-p', facts);
    for (const entry of readdirSync(data)) {
        if (['space', 'knowledge', 'search', 'search-base', 'texts'].includes(entry)) continue;
        execFileSync(adbPath, ['-s', serial, 'push', join(data, entry), facts], { stdio: 'ignore', timeout: 120_000 });
    }
    for (const base of [release.map_base, release.knowledge_base, release.search_base, release.texts_base, release.search_stable_base].filter(Boolean)) {
        const parent = `${cache}${base.slice(0, base.lastIndexOf('/'))}`;
        adb('shell', 'mkdir', '-p', parent);
        execFileSync(adbPath, ['-s', serial, 'push', join(root, 'public', base), parent], { stdio: 'ignore', timeout: 120_000 });
    }
    adb('push', join(root, 'src/data/campus-release.json'), `${cache}/release.json`);
    adb('shell', 'chown', '-R', owner, cache);
    console.log(`seeded the real compiled release in the emulator cache: ${release.version}`);
}

const decode = text => text.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
function screen() {
    const dumped = adb('shell', 'uiautomator', 'dump', '/sdcard/smoke.xml');
    if (!dumped.includes('dumped to: /sdcard/smoke.xml')) return [];
    const xml = adb('shell', 'cat', '/sdcard/smoke.xml');
    return [...xml.matchAll(/<node\b[^>]*>/g)].flatMap(([node]) => {
        const attrs = Object.fromEntries([...node.matchAll(/([\w-]+)=(["'])([\s\S]*?)\2/g)].map(([, key, , value]) => [key, decode(value)]));
        const bounds = attrs.bounds?.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
        return bounds && +bounds[3] > +bounds[1] && +bounds[4] > +bounds[2] ? [{ ...attrs, text: attrs.text ?? '', words: `${attrs.text}|${attrs['content-desc']}`, left: +bounds[1], top: +bounds[2], right: +bounds[3], bottom: +bounds[4], x: (+bounds[1] + +bounds[3]) / 2, y: (+bounds[2] + +bounds[4]) / 2 }] : [];
    });
}
function healthy(step, nodes = screen(), quiet = false) {
    const error = nodes.find(node => /暂时无法加载|没能加载|没能打开|搜索需要联网|搜索数据有误|地图加载失败|无法规划|找不到路线|没有可用路线/.test(node.text));
    if (error) throw new Error(`${step}: ${error.text}`);
    alive(step, quiet);
}
function capture(name) {
    writeFileSync(join(evidence, `${name}.png`), execFileSync(adbPath, ['-s', serial, 'exec-out', 'screencap', '-p']));
    adb('shell', 'uiautomator', 'dump', '/sdcard/smoke.xml');
    writeFileSync(join(evidence, `${name}.xml`), adb('shell', 'cat', '/sdcard/smoke.xml'));
}
function alive(step, quiet = false) {
    if (!adb('shell', 'pidof', app).trim()) throw new Error(`the app is gone after: ${step}\n${adb('logcat', '-d', '-b', 'crash')}`);
    const crash = adb('logcat', '-d', '-b', 'crash').trim();
    if (crash.includes(`Process: ${app},`) || crash.includes(`Cmdline: ${app}\n`) || crash.includes(`>>> ${app} <<<`)) throw new Error(`the app crashed during: ${step}\n${crash}`);
    if (!quiet) console.log(`ok  ${step}`);
}
async function find(match, step, seconds = 20) {
    for (let i = 0; i < seconds * 2; i++) {
        const hit = screen().find(node => typeof match === 'string' ? node.text === match || node.words.split('|').includes(match) : match(node));
        if (hit) return hit;
        alive(step, true);
        await sleep(500);
    }
    throw new Error(`not on screen after ${seconds}s: ${step}`);
}
async function tap(match, step, seconds) {
    const hit = await find(match, step, seconds);
    adb('shell', 'input', 'tap', String(Math.round(hit.x)), String(Math.round(hit.y)));
    await sleep(900);
    alive(step);
}
async function scrollFind(match, step, attempts = 12, direction = 1, distance = .50) {
    for (let i = 0; i < attempts; i++) {
        const nodes = screen();
        if (!nodes.length) { await sleep(500); continue; }
        const hit = nodes.find(node => typeof match === 'string' ? node.text === match || node.words.split('|').includes(match) : match(node));
        if (hit) return hit;
        healthy(step, nodes, true);
        const width = Math.max(...nodes.map(node => node.right));
        const height = Math.max(...nodes.map(node => node.bottom));
        const x = String(Math.round(width * .55));
        const start = String(Math.round(height * (.53 + distance * direction / 2)));
        const end = String(Math.round(height * (.53 - distance * direction / 2)));
        adb('shell', 'input', 'swipe', x, start, x, end, '300');
        await sleep(300);
    }
    throw new Error(`not found while scrolling: ${step}; on screen: ${screen().map(node => node.text).filter(Boolean).join(' | ')}`);
}
async function scrollTap(match, step, attempts, direction) {
    const hit = await scrollFind(match, step, attempts, direction);
    adb('shell', 'input', 'tap', String(Math.round(hit.x)), String(Math.round(hit.y)));
    await sleep(900);
    alive(step);
}
async function type(text, step) {
    adb('shell', 'input', 'text', text);
    await sleep(1200);
    alive(step);
}
const dismissKeyboard = () => {
    const input = adb('shell', 'dumpsys', 'input_method');
    // The IME service can retain mIsInputViewShown=true after it lost its target.
    // InputMethodManager's mInputShown is the actual display request; sending
    // Back for that stale service flag would dismiss a sheet or the whole app.
    const requested = /\bmInputShown=(true|false)\b/.exec(input);
    const shown = requested ? requested[1] === 'true' : /\bisInputViewShown=true\b/.test(input);
    if (shown) adb('shell', 'input', 'keyevent', '4');
};
async function fillField(label, value, step) {
    await scrollTap(node => (node.class === 'android.widget.EditText' && node.words.includes(label)) || node['content-desc'] === label, step);
    adb('shell', 'input', 'keyevent', '123', ...Array(140).fill('67'));
    await type(value, step);
    dismissKeyboard();
    await find(node => node.class === 'android.widget.EditText' && node.text === value, `${step}: the entered value remains`);
}
const quote = text => "'" + text.replaceAll("'", "'\\''") + "'";
const startLink = path => adb('shell', 'am', 'start', '-W', '-n', `${app}/top.hicancan.studev.MainActivity`, '-a', 'android.intent.action.VIEW', '-d', quote(origin + path));
async function link(path, step) {
    startLink(path);
    await sleep(900);
    alive(step);
}
async function chooseClass() {
    await link('/', 'open the personal timetable before checking the saved class');
    const entry = await find(node => node.text === '你在哪个班？' || node.text === '周', 'the loaded class picker or personal timetable');
    if (entry.text !== '你在哪个班？') return;
    await tap(node => node.class === 'android.widget.EditText', 'the class picker');
    await type('B240402', 'search a class');
    await tap(node => node.text.includes('计算机科学与技术'), 'choose B240402');
    // Selecting a class closes this sheet and its keyboard together. A second
    // Back can leave the app while InputMethodManager still reports the old IME.
}
async function examHistory() {
    await link('/?scale=exam', 'open the personal exam arrangements');
    // The latest version can be expanded into a long list of changes. Keep its
    // small header in view between swipes rather than jumping into that list.
    await scrollFind(node => node.text.startsWith(examImpact), 'the released class impact is reported', 26, 1, .24);
    await scrollTap(node => node.text.includes('首次记录'), 'open the original exam baseline');
    capture('exam-unaffected-baseline');
    await link(`/?who=${encodeURIComponent(`class:${affectedExam.class}`)}&scale=exam`, 'open the actual affected class exams');
    const version = examIndex.history.find(item => item.id === affectedExam.version);
    const date = version.published.slice(0, 10);
    const said = `${Number(date.slice(5, 7))}月${Number(date.slice(8))}日`;
    await scrollTap(node => node.text === said + ' 官方发布', 'select a real exam update affecting this class');
    await scrollFind(node => node.text.includes(affectedExam.course.name), 'the affected course is named');
    const sitting = affectedExam.after?.[0] ?? affectedExam.before?.[0];
    await scrollFind(node => node.text.includes(sitting.date) && node.text.includes(sitting.start), 'the actual added or previous sitting is explained');
    await scrollFind(`本版采用的文件 · ${version.files.length} 份`, 'the selected version shows its files directly');
    await scrollFind(node => node.text.includes(version.files[0].file.replace(/^\d{4}-\d{2}-\d{2}-/, '')), 'the original official filename is visible');
    await scrollFind(node => node.words.includes('官方公告：'), 'the announcement remains directly accessible');
    await scrollFind(node => node.words.includes('官方附件：'), 'the official workbook remains directly accessible');
    capture('exam-affected-official-sources');
    healthy('real exam versions, baseline, class impact and official source links');
    await link('/', 'return to the personal timetable after exam acceptance');
}
async function searchNavigation() {
    for (const [query, title] of [['B240402', 'B240402'], [navigationMeeting.teachers[0].name, `${navigationMeeting.teachers[0].name} 老师`]]) {
        await link('/search/?' + new URLSearchParams({ q: query, scope: 'academic' }), 'search a real class or teacher');
        await tap(node => node.class !== 'android.widget.EditText' && node.text === query, 'open the real campus entity inside Android', 45);
        await find(title, 'the native timetable retains the selected entity');
    }
    await link('/search/?' + new URLSearchParams({ q: navigationMeeting.course.code, scope: 'academic' }), 'search a real course');
    const course = navigationMeeting.course.name.replace(/[（(].*?[)）]/g, '').trim();
    await tap(node => node.class !== 'android.widget.EditText' && node.text === course, 'open native course details', 45);
    await tap('这门课的全部时段', 'open the native course timetable');
    await find(course, 'the course remains inside Android');
    const examCourse = navigationExam.course.name.replace(/[（(].*?[)）]/g, '').trim();
    await link('/search/?' + new URLSearchParams({ q: `${examCourse} 考试 ${navigationExam.date}`, scope: 'academic' }), 'search a real exam');
    await tap(`${examCourse} 考试`, 'open the real exam result', 45);
    await find(examCourse, 'the exam opens its course inside Android');
    await find(node => node.text.includes(navigationExam.start) && node.text.includes(navigationExam.end), 'the exam link retains the actual day and time');
    capture('native-entity-search-navigation');
    healthy('class, teacher, course and exam results remain inside Android');
    await link('/', 'return to the personal timetable after entity navigation');
}
async function search101() {
    await link('/search/?q=101', 'search 101');
    await find(node => /条结果/.test(node.text), 'search results (the search kernel)', 45);
    await find('教1-101', 'a real classroom result', 30);
    dismissKeyboard();
    healthy('real search results, without a data or network error');
    capture('search-results');
}
async function knowledgeLinks() {
    await link(`/knowledge/?course=${encodeURIComponent(course.id)}&topic=${encodeURIComponent(topic.id)}`, 'a knowledge topic');
    await find(topic.title, 'the topic explanation', 30);
    // A re-read must remain on the same topic, with no render-triggered navigation.
    for (let i = 0; i < 3; i++) { await sleep(500); if (!screen().some(node => node.text === topic.title)) throw new Error('knowledge topic changed without input'); }
    await scrollTap(node => node['resource-id'] === `knowledge-reference:${reference.material}#${reference.anchor}`, 'follow the exact topic reference into its actual material');
    await find(reference.heading, 'the exact passage named by the backlink', 30);
    await scrollTap(backlink, 'follow the material knowledge chip back to the topic');
    await find(topic.title, 'the exact topic reached from its material backlink', 30);
    await link(`/knowledge/?course=${encodeURIComponent(course.id)}&material=${encodeURIComponent(reference.material)}#${encodeURIComponent(reference.anchor)}`, 'the same material anchor as a cold deep link');
    await find(reference.heading, 'the exact passage reopened by its URL', 30);
    healthy('topic/reference/material/backlink and anchored deep link');
    adb('shell', 'input', 'keyevent', '4');
    await find(course.name, 'back to the course outline');
    if (screen().some(node => node.text === '目录 ▾')) throw new Error('the course homepage repeats its own outline button');
    adb('shell', 'input', 'keyevent', '4');
    await find('搜索课程、代码或章节', 'back to the course list');
    await find(node => node.class === 'android.widget.EditText', 'the course-list search field');
}
async function referenceGroups() {
    const military = knowledge.topics.find(topic => topic.id === '军事理论/现代国防观');
    if (!military) throw new Error('the released knowledge has no military-theory reference case');
    const grouped = Map.groupBy(military.references, reference => reference.material);
    const [material, refs] = [...grouped].sort((a, b) => b[1].length - a[1].length)[0];
    const identity = ref => `knowledge-reference:${material}#${ref.anchor}`;
    await link(`/knowledge/?course=${encodeURIComponent('军事理论')}&topic=${encodeURIComponent(military.id)}`, 'a topic with many references');
    await scrollFind(`展开全部 ${refs.length} 处`, 'the long reference group starts collapsed');
    if (screen().some(node => node['resource-id'] === identity(refs[3]))) throw new Error('the collapsed reference group exposes more than three references');
    await scrollTap(`展开全部 ${refs.length} 处`, 'expand the complete reference group');
    // Preview excerpts can reflow above this group while scrolling. Re-anchor
    // at its expanded heading before looking for the exact fourth reference.
    await scrollFind('收起', 'the expanded reference group heading', 12, -1);
    await scrollFind(node => node['resource-id'] === identity(refs[3]), 'the fourth exact reference appears after expansion');
    await scrollTap('收起', 'collapse the complete reference group', 12, -1);
    await find(`展开全部 ${refs.length} 处`, 'the reference group can be expanded again');
    capture('knowledge-reference-group');
    await link(`/knowledge/?course=${encodeURIComponent('体育理论')}`, 'a course homepage that is already an outline');
    await find('体育理论', 'the physical-education course homepage');
    if (screen().some(node => node.text === '目录 ▾')) throw new Error('the course homepage offers a redundant outline menu');
    healthy('large reference groups and the course homepage');
}
async function pickFilter(label, value) {
    await tap(node => node['content-desc'].startsWith(`${label}：`), `open the ${label} dropdown`);
    await tap(value, `choose ${value} in the ${label} filter`);
}
async function knowledgeFilters() {
    await link('/knowledge/', 'the compact knowledge catalog');
    const scope = '2024级 · 计算机科学与技术';
    await find(scope, 'the inherited knowledge scope');
    if (screen().some(node => node.text === '入学年份')) throw new Error('the knowledge homepage exposes advanced filter fields');
    await tap('筛选', 'open the knowledge filter sheet');
    for (const label of ['入学年份', '专业', '学年', '课程类别', '修读要求']) await find(label, `the ${label} filter belongs to the sheet`);
    await pickFilter('学年', '大四');
    capture('knowledge-filter-sheet');
    await tap('取消', 'cancel draft knowledge filters');
    await find(scope, 'cancelling retains the inherited knowledge scope');
    if (screen().some(node => /项筛选$/.test(node.text))) throw new Error('cancelling draft filters applied them');
    await tap('筛选', 'reopen knowledge filters');
    await pickFilter('学年', '大二');
    await tap('应用筛选', 'apply knowledge filter choices together');
    await find('1 项筛选', 'the applied filter appears in the compact scope summary');
    await tap('筛选', 'open the applied knowledge filters');
    await tap('重置', 'reset only the draft to the personal scope');
    await tap('应用筛选', 'apply the reset personal knowledge scope');
    await find(scope, 'reset restores the inherited knowledge scope');
    if (screen().some(node => /项筛选$/.test(node.text))) throw new Error('reset retains advanced filters');
    healthy('knowledge filter sheet cancel, apply and reset');
    capture('knowledge-catalog');
}
async function managedCourses() {
    await link('/', 'open the personal timetable');
    await tap('未登录', 'the labeled personal entry');
    await tap('课表设置', 'open timetable settings');
    await tap('我的课程', 'one list for public and personal courses');
    await tap(node => node.class === 'android.widget.EditText', 'the personal course search');
    await type(managedCourse.course.code, 'find the actual teaching class');
    dismissKeyboard();
    await tap(managedName, 'open the actual course details');
    await find('上课安排', 'the course details contain its arrangements');
    await scrollTap('编辑名称', 'open personal course-name editing');
    await fillField('课表中的名称', 'SmokeRenamed', 'rename the public course for this person');
    capture('course-name-edit');
    await scrollTap('保存名称', 'save the personal course name');
    await find('SmokeRenamed', 'the course details show the saved personal name');
    await scrollTap('编辑名称', 'reopen personal name editing');
    await scrollTap('恢复原名', 'restore the published course name');
    await scrollTap('隐藏这门课', 'hide the public teaching class');
    await tap(node => node.checkable === 'true', 'include hidden courses in management');
    await tap(managedName, 'hidden courses retain their details');
    await scrollFind('相关实验', 'hiding a lecture retains its related laboratory facts');
    await scrollTap('恢复到课表', 'restore the hidden public course');
    await tap('自定义课程', 'add a personal course through the same manager');
    await fillField('课程名称', 'SmokeCourse', 'name a personal course');
    await fillField('地点', 'SmokeRoom', 'set its place');
    await fillField('教师', 'SmokeTeacher', 'set its teacher');
    capture('custom-course-form');
    await scrollTap('添加课程', 'save the personal course');
    await tap(node => node.class === 'android.widget.EditText', 'clear the course search');
    adb('shell', 'input', 'keyevent', '123', ...Array(80).fill('67'));
    dismissKeyboard();
    await scrollTap('SmokeCourse', 'open the new course details');
    await find('SmokeTeacher', 'the personal teacher is visible in details');
    await scrollFind(node => node.text.includes('SmokeRoom'), 'the personal place is visible in details');
    await scrollTap('编辑课程', 'edit the same personal course');
    await fillField('课程名称', 'SmokeEdited', 'edit its name without replacing the course identity');
    await fillField('地点', 'SmokeRoom2', 'edit its place');
    await scrollTap('保存修改', 'save the same personal course');
    await find('SmokeEdited', 'the original detail now shows the edited course');
    await scrollFind(node => node.text.includes('SmokeRoom2'), 'the edited arrangement is shown');
    await scrollTap('删除自定义课程', 'remove the personal course from this isolated test instance');
    if (screen().some(node => node.text === 'SmokeEdited')) throw new Error('the removed course remains in the course list');
    healthy('public course rename/hide/restore, independent labs and personal course create/edit/delete');
    capture('managed-courses');
    adb('shell', 'input', 'keyevent', '4');
    await tap('实验安排', 'the experiments belong to timetable settings');
    await find('实验安排', 'the experiment manager');
    adb('shell', 'input', 'keyevent', '4');
    await find('我的课程', 'back from experiments to timetable settings');
    adb('shell', 'input', 'keyevent', '4');
    await find('帮助与关于', 'back from timetable settings to the personal home');
    adb('shell', 'input', 'keyevent', '4');
    await find('地图', 'back from the personal home to the campus entries');
}
async function mapFloors() {
    await tap('地图', 'the campus map', 30);
    await find(opening.names[0], `the projected ${opening.names[0]} building label`, 30);
    healthy('the map has real building labels');
    capture('map-campus');
    await link(`/map/?place=${encodeURIComponent(opening.id)}&f=${floors[0]}`, 'unfold the configured opening building');
    await find(`${opening.names[0]} ${floors[0]} 层`, 'the selected building and its actual first floor', 30);
    const width = Math.max(...screen().map(item => item.right));
    await tap(node => node.text === String(floors[1]) && node.x > width * .8, 'change the visible map floor');
    await find(`${opening.names[0]} ${floors[1]} 层`, 'the second floor replaces the first');
    await link(`/map/?place=${encodeURIComponent(destination.id)}`, 'open a real classroom in its floor model');
    await find('教1-101', 'the selected room title', 30);
    await find(node => node.text.startsWith(`教1 ${destination.floor} 层`), 'the room belongs to its released building/floor');
    // This short number is the projected room label; the information sheet says 教1-101 instead.
    await find(destination.names[0], 'the selected room label is drawn over its floor', 30);
    healthy('the building, floor and room scene');
    capture('map-room');
}
async function routeDetails() {
    const path = (from, to, mode = 'walk') => `/map/?from=${encodeURIComponent(from)}&nav=${encodeURIComponent(to)}${mode === 'bike' ? '&mode=bike' : ''}`;
    for (const [from, to, name] of [['仙林/教1-102', '仙林/教1-101', 'same-floor'], ['仙林/教1-101', '仙林/教1-201', 'same-building'], ['仙林/教1-101', '仙林/教1-101', 'same-room']]) {
        await link(path(from, to), `open the ${name} navigation link with both endpoints`);
        await find('同在教1', 'shared building access is presented as indoor locations', 30);
        const nodes = screen();
        if (nodes.some(node => /^\d+(?:\.\d+)?\s*(?:米|公里)$/.test(node.text) || node.text === '开始导航')) throw new Error('indoor-only directions invented a road distance or trip');
        await find(node => node.text.startsWith('目的地：') && node.text.includes(to.slice(to.indexOf('/') + 1)), 'the requested room remains the destination');
        capture(`map-route-${name}`);
    }
    await link(path('仙林/教1-101', '仙林/教1/2'), 'navigate to an actual floor entity');
    await find('同在教1', 'a floor shares the real building access');
    await tap('查看楼层', 'open the actual requested floor');
    await find('教1 2 层', 'the floor link opens floor 2 instead of a guessed free floor');
    capture('map-route-floor');
    await link(path('仙林/不存在的起点', '仙林/教1-101'), 'open an invalid explicit origin');
    await find('没有找到出发地。', 'an invalid explicit origin does not silently become GPS');
    await link(path('仙林/教1-101', '仙林/教2-101', 'bike'), 'open a cross-building cycling route');
    await find('道路路线到教2入口', 'the measured road leg ends at the building entrance', 30);
    if (screen().some(node => node.text === '避开楼梯')) throw new Error('a cycling link was changed back to walking');
    await find(node => node.text.includes('进入教2后') && node.text.includes('教2-101'), 'the room position follows the entrance');
    await find(node => /^(?:不到 1|\d+(?:\.\d+)?) 分钟$/.test(node.text), 'a computed road travel time', 30);
    await find(node => /^\d+(?:\.\d+)?\s*(?:米|公里)$/.test(node.text) && parseFloat(node.text) > 0, 'a positive measured cross-building road distance');
    await find('开始导航', 'the route is ready to navigate');
    healthy('a computed route with both endpoints, length and duration');
    capture('map-route');
    await tap('路线详情', 'the route maneuvers');
    await find('教1-101 → 教2-101', 'route details preserve both requested room endpoints');
    await find(node => /到达|沿|进入|离开|转|前行/.test(node.text) && node.text !== '教1-101 → 教2-101', 'real maneuver instructions');
    healthy('the route detail instructions');
    capture('map-route-details');
    adb('shell', 'input', 'keyevent', '4');
    await tap('关闭路线规划', 'close the completed route preview');
}
async function entryLinks() {
    for (const path of ['/ai/', '/knowledge/', '/members/', '/account/', '/login/']) {
        const handlers = adb('shell', 'cmd', 'package', 'query-activities', '--brief', '-a', 'android.intent.action.VIEW', '-c', 'android.intent.category.BROWSABLE', '-d', quote(origin + path));
        if (!handlers.includes(`${app}/`)) throw new Error(`the native entry is not registered: ${path}`);
    }
    for (const path of ['/admin/', '/club/']) {
        const handlers = adb('shell', 'cmd', 'package', 'query-activities', '--brief', '-a', 'android.intent.action.VIEW', '-c', 'android.intent.category.BROWSABLE', '-d', quote(origin + path));
        if (handlers.includes(`${app}/`)) throw new Error(`an unsupported site page was captured by the native app: ${path}`);
    }
    await link('/ai/', 'open the AI shared address');
    await find('问点什么', 'the AI address reaches the native composer');
    capture('entry-ai');
    await link('/knowledge/', 'open the knowledge shared address');
    await find('知识', 'the knowledge page');
    await find('课程目录', 'the native knowledge directory');
    capture('entry-knowledge');
    await link('/account/', 'open the account shared address');
    await find('登录 StuDev', 'the account link reaches native sign-in');
    await link('/members/', 'open members over an already-open account');
    await find('登录后查看成员', 'the new member address replaces the old account layer');
    capture('entry-members');
    await link('/login/', 'open sign-in over an already-open member page');
    await find('登录 StuDev', 'the native sign-in address replaces members');
    capture('entry-account');
    healthy('shared addresses select their native screens and preserve site-only boundaries');
    await tap('返回', 'leave sign-in after entry acceptance');
}
async function unknownRoomDay() {
    const index = JSON.parse(readFileSync(join(data, 'rooms/index.json'), 'utf8'));
    const outside = new Date(`${index.weeks.at(-1).end}T12:00:00Z`);
    outside.setUTCFullYear(outside.getUTCFullYear() + 1);
    const date = outside.toISOString().slice(0, 10);
    if (existsSync(join(data, `rooms/${index.term}/${date}.json`))) throw new Error('the unknown-day case is covered by the actual release');
    const building = start.id.slice(0, start.id.lastIndexOf('-'));
    await link(`/map/?place=${encodeURIComponent(building)}&f=1&t=${date}T12:00`, 'a building outside the released teaching dates');
    await find('暂无这一天的排课数据', 'missing building occupancy is explicitly unknown', 30);
    if (screen().some(node => /间空闲|这一层此刻没有空教室/.test(node.text))) throw new Error('unknown building occupancy is presented as zero available rooms');
    capture('map-unknown-day');
    await link(`/map/?place=${encodeURIComponent(start.id)}&t=${date}T12:00`, 'a room outside the released teaching dates');
    await find('暂无这一天的排课数据', 'missing room occupancy is explicitly unknown', 30);
    await link(`/map/?place=${encodeURIComponent(opening.id)}&f=${floors[0]}`, 'return to the released current-day occupancy');
    await find(node => /\d+\s*\/\s*\d+ 间空闲/.test(node.text), 'known occupancy returns after the unknown date', 30);
    healthy('unknown room-day data stays distinct from zero availability');
}
async function personalViews() {
    await tap('AI', 'the AI board');
    const opening = await find(node => node.text === '有什么可以帮你？' || node['content-desc'] === '新对话', 'an empty board or a retained conversation');
    if (opening['content-desc'] === '新对话') await tap(node => node['content-desc'] === '新对话', 'open an empty board without removing the retained conversation');
    await find('有什么可以帮你？', 'the empty conversation board');
    await find('问点什么', 'the AI composer');
    await find('免费额度', 'the configured provider selector');
    healthy('the AI entry, without sending a prompt');
    await tap('课表', 'back to the timetable');
    await tap('未登录', 'the labeled personal profile button');
    await find('课表设置', 'the personal settings home');
    await tap('课表设置', 'the timetable settings');
    await find(node => node.text.includes('B240402'), 'the selected class is retained');
    await tap('返回', 'back from timetable settings');
    // 检查更新 stands on the first page of 我, with the installed app and the data it reads.
    const currentRelease = JSON.parse(adb('exec-out', 'cat', `/data/user/0/${app}/files/campus/release.json`));
    await scrollFind(node => node.text.includes(`App ${product.android.versionName} · 数据 ${currentRelease.data_version}`), 'the installed app and current cached campus data versions');
    // The check answers in a dialog over the page it was asked from.
    await tap('检查更新', 'check for updates');
    const answers = ['已是最新', '校园数据已更新', '暂时连不上', '新数据暂时无法读取'];
    await find(node => answers.includes(node.text) || node.text.startsWith('发现新版本'), 'the update check answers over 我');
    await tap(node => node.text === '好' || node.text === '稍后', 'close the update answer');
    await find('帮助与关于', 'the update answer closes back to 我');
    await tap('帮助与关于', 'the about settings');
    await find('意见反馈', 'feedback in the about settings');
    healthy('personal settings show the selected class, account and released version');
    capture('personal-settings');
    adb('shell', 'input', 'keyevent', '4');
    await find('课表设置', 'back from about to the personal home');
    await tap('成员', 'open members inside the app');
    await find('登录后查看成员', 'members asks a visitor to sign in');
    capture('members-sign-in');
    await tap('返回', 'return from member browsing');
    await find('课表设置', 'members returns to the same personal home');
    adb('shell', 'input', 'keyevent', '4');
    await find('课表', 'return from personal settings');
}

async function aiTrace() {
    // This emulator alone owns the test app's records; the connected physical phone is never selected here.
    if (!/^emulator-\d+$/.test(serial)) throw new Error('AI fixture seeding requires the owned test emulator');
    const messages = JSON.parse(readFileSync(join(root, 'scripts/smoke/fixtures/ai-tcp.json'), 'utf8'));
    const nodes = [], chosen = {};
    let parent = '';
    messages.forEach((message, index) => {
        const id = `ai-replay-message-${index}`;
        nodes.push({ id, parent, message }); chosen[parent] = id; parent = id;
    });
    const kept = { current: 'ai-replay', chats: [{ id: 'ai-replay', title: '', updated: Date.now(), thread: { nodes, chosen } }] };
    const escapeXml = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
    const local = join(evidence, 'ai_chat.xml');
    writeFileSync(local, `<?xml version="1.0" encoding="utf-8" standalone="yes"?><map><string name="chats">${escapeXml(JSON.stringify(kept))}</string></map>`);
    adb('shell', 'am', 'force-stop', app);
    adb('root'); adb('wait-for-device');
    if (adb('shell', 'id', '-u').trim() !== '0') throw new Error('the owned emulator does not permit its isolated chat fixture');
    const owner = adb('shell', 'stat', '-c', '%u:%g', `/data/user/0/${app}`).trim();
    if (!/^\d+:\d+$/.test(owner)) throw new Error('the test application has no valid data owner');
    const incoming = `/data/local/tmp/studev-${app}-ai_chat.xml`;
    const directory = `/data/user/0/${app}/shared_prefs`;
    adb('push', local, incoming);
    adb('shell', 'mkdir', '-p', directory);
    adb('shell', 'cp', incoming, `${directory}/ai_chat.xml`);
    adb('shell', 'chown', owner, directory, `${directory}/ai_chat.xml`);
    adb('shell', 'chmod', '660', `${directory}/ai_chat.xml`);
    adb('shell', 'restorecon', '-R', directory);
    adb('shell', 'rm', incoming);
    adb('shell', 'monkey', '-p', app, '-c', 'android.intent.category.LAUNCHER', '1');
    await sleep(2000);
    await tap('AI', 'open the saved real AI conversation');
    const summaryId = 'ai-steps:ai-replay-message-0';
    await scrollTap(node => node['resource-id'] === summaryId, 'expand the recorded AI calls', 15, -1);
    const calls = messages.flatMap(message => message.tool_calls || []);
    const read = calls.find(call => call.function.name === 'read');
    if (!read) throw new Error('the recorded conversation contains no original-text read');
    for (const call of calls) await scrollFind(node => node['resource-id'] === `ai-call:${call.id}`, `the preserved ${call.function.name} call ${call.id}`, 15);
    await scrollTap(node => node['resource-id'] === `ai-call:${read.id}`, 'inspect an original-text read', 15, -1);
    const expected = JSON.parse(read.function.arguments).id;
    await find(node => node['resource-id'] === 'ai-call-arguments' && node.text.includes(expected), 'raw AI call arguments');
    await find(node => node['resource-id'] === 'ai-call-result' && node.text.includes('TCP'), 'the actual TCP call result');
    healthy('real AI call details render without sending another prompt');
    capture('ai-call-details');
    adb('shell', 'input', 'keyevent', '4');
    await scrollTap(node => node['resource-id'] === summaryId, 'collapse the recorded AI calls', 15, -1);
    alive('the saved AI call record remains inspectable and can be collapsed');
}

try {
await device();
if (entriesOnly) {
    await entryLinks();
    console.log(`Android native shared-address acceptance passed: ${evidence}`);
} else if (routesOnly) {
    await routeDetails();
    console.log(`Android room/building/road routing acceptance passed: ${evidence}`);
} else if (personalOnly) {
    for (let layer = 0; layer < 2; layer++) {
        const nodes = screen();
        if (!nodes.some(node => node.text === '课表设置' || node.text === '检查更新')) break;
        adb('shell', 'input', 'keyevent', '4');
        await sleep(900);
    }
    await personalViews();
    await aiTrace();
    console.log(`Android personal and AI trace acceptance passed: ${evidence}`);
} else {
if (resume) {
    const expected = /versionCode='(\d+)'/.exec(badging)?.[1];
    const installedVersion = /versionCode=(\d+)/.exec(adb('shell', 'dumpsys', 'package', app))?.[1];
    if (!expected || installedVersion !== expected) throw new Error('resume requires the same installed application version');
    console.log(`resuming the remaining acceptance flow of ${app} ${expected} on ${serial}`);
} else {
const installed = adb('shell', 'pm', 'list', 'packages', app).split(/\r?\n/).includes(`package:${app}`);
console.log(`installing ${apk} on ${serial}`);
adb('install', '-r', apk);
adb('logcat', '-c');
adb('shell', 'am', 'force-stop', app);
await seedRelease();
adb('shell', 'monkey', '-p', app, '-c', 'android.intent.category.LAUNCHER', '1');
await sleep(4000);
alive(installed ? 'open the upgraded app with its previous data' : 'open the app');
await chooseClass();
await search101();
await knowledgeLinks();
// Installing the same signed artifact preserves the class and already-read release shards.
adb('install', '-r', apk);
adb('shell', 'am', 'force-stop', app);
adb('shell', 'monkey', '-p', app, '-c', 'android.intent.category.LAUNCHER', '1');
await sleep(2000);
if (screen().some(node => node.text === '你在哪个班？')) throw new Error('reinstall lost the selected class');
await search101();
alive('search after a cache-preserving signed reinstall');

// Only the selected emulator is reset for the independent first-run exercise.
adb('shell', 'pm', 'clear', app);
adb('logcat', '-c');
await seedRelease();
adb('shell', 'monkey', '-p', app, '-c', 'android.intent.category.LAUNCHER', '1');
await sleep(4000);
}
await chooseClass();
for (const [scale, name] of [['天', 'day'], ['周', 'week'], ['学期', 'term'], ['考试', 'exams'], ['任务', 'tasks']]) {
    await tap(scale, `the ${scale} view`);
    capture(`timetable-${name}`);
}
await tap('学期', 'open the academic year calendar');
await tap(node => node.text.startsWith('第一学期'), 'open the published first term');
await scrollTap(node => node.text.includes('算法与数据结构设计') || node.words.includes('算法与数据结构设计'), 'open the real practice course details');
await find('不占课表格子', 'practice notes match the term');
await find(node => node['content-desc'] === '陈兴国 的课表', 'the practice teacher links to a timetable');
capture('practice-detail');
adb('shell', 'input', 'keyevent', '4');
await find(node => node.text.startsWith('第一学期'), 'return from practice details');
capture('timetable-first-term');
await tap(node => node.text.startsWith('第二学期'), 'open the published second term');
await scrollFind(node => node.text.includes('暑假'), 'the second term has its published summer break');
capture('timetable-second-term');
await examHistory();
await searchNavigation();
await link('/search/?scope=community', 'open the community scope');
await find(node => node.text.includes('全部来源'), 'community resolves the names of its sources', 30);
await tap(node => node.text.includes('全部来源'), 'show the community sources');
await find('南邮历年资料', 'the external exam archive has its published source name');
await find('南邮生存手册', 'the survival guide has its published source name');
await link('/', 'return to the timetable after browsing community sources');
await managedCourses();
await mapFloors();
await unknownRoomDay();
// Leaving while uncached searches fetch blocks must not release the engine they still use.
for (const query of ['考试', '创新', '通信']) {
    startLink(`/search/?q=${encodeURIComponent(query)}`);
    await sleep(250);
    await link('/', `leave the in-flight search for ${query}`);
}
// Replace a query while its previous search is still fetching, then verify only the final input/results.
startLink('/search/?q=101');
await sleep(150);
startLink('/search/?q=102');
await find(node => node.class === 'android.widget.EditText' && node.text === '102', 'the last query replaces the earlier query');
await find('教1-102', 'the final query produces its own room result', 30);
healthy('query replacement during a search');
await search101();
await routeDetails();
await knowledgeLinks();
await knowledgeFilters();
await referenceGroups();
await personalViews();
await aiTrace();
console.log(`Android smoke passed; map and settings evidence: ${evidence}`);
}
} catch (error) {
    if (serial) {
        try { capture('failure'); } catch { /* Preserve the original failure if the app/device is already gone. */ }
    }
    throw error;
} finally {
    if (startedEmulator && serial) adb('emu', 'kill');
}
