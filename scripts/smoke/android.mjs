// Exercise the APK itself over the released campus data: an upgrade preserving its cache,
// then a fresh start, search, knowledge links, the map and a route.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const apk = process.argv[2];
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
    execFileSync(adbPath, ['-s', serial, 'push', data, cache], { stdio: 'ignore', timeout: 120_000 });
    adb('push', join(root, 'src/data/campus-release.json'), `${cache}/release-${product.android.versionCode}.json`);
    adb('shell', 'chown', '-R', owner, cache);
    console.log(`seeded the real compiled release in the emulator cache: ${release.version}`);
}

const decode = text => text.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
function screen() {
    const dumped = adb('shell', 'uiautomator', 'dump', '/sdcard/smoke.xml');
    if (!dumped.includes('dumped to: /sdcard/smoke.xml')) return [];
    const xml = adb('shell', 'cat', '/sdcard/smoke.xml');
    return [...xml.matchAll(/<node\b[^>]*>/g)].flatMap(([node]) => {
        const attrs = Object.fromEntries([...node.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, decode(value)]));
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
async function scrollFind(match, step, attempts = 12, direction = 1) {
    for (let i = 0; i < attempts; i++) {
        const nodes = screen();
        if (!nodes.length) { await sleep(500); continue; }
        const hit = nodes.find(node => typeof match === 'string' ? node.text === match || node.words.split('|').includes(match) : match(node));
        if (hit) return hit;
        healthy(step, nodes, true);
        const width = Math.max(...nodes.map(node => node.right));
        const height = Math.max(...nodes.map(node => node.bottom));
        adb('shell', 'input', 'swipe', String(Math.round(width * .55)), String(Math.round(height * (direction > 0 ? .78 : .28))), String(Math.round(width * .55)), String(Math.round(height * (direction > 0 ? .28 : .78))), '300');
        await sleep(300);
    }
    throw new Error(`not found while scrolling: ${step}`);
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
const startLink = path => adb('shell', 'am', 'start', '-n', `${app}/top.hicancan.studev.MainActivity`, '-a', 'android.intent.action.VIEW', '-d', quote(origin + path));
async function link(path, step) {
    startLink(path);
    await sleep(900);
    alive(step);
}
async function chooseClass() {
    await sleep(1500);
    if (!screen().some(node => node.text === '你在哪个班？')) return;
    await tap(node => node.class === 'android.widget.EditText', 'the class picker');
    await type('B240402', 'search a class');
    await tap(node => node.text.includes('计算机科学与技术'), 'choose B240402');
    dismissKeyboard();
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
    await find('教1-102', 'the route starts at the selected real classroom');
    await find('教1-101', 'the route ends at the selected real classroom');
    await find(node => /^\d+(?:\.\d+)? 分钟$/.test(node.text), 'a computed travel time', 30);
    await find(node => /^\d+(?:\.\d+)?\s*(?:米|公里)$/.test(node.text), 'a computed route length');
    await find('开始导航', 'the route is ready to navigate');
    healthy('a computed route with both endpoints, length and duration');
    capture('map-route');
    await tap('路线详情', 'the route maneuvers');
    await find('教1-102 → 教1-101', 'route details name both endpoints');
    await find(node => /到达|沿|进入|离开|转|前行/.test(node.text) && node.text !== '教1-102 → 教1-101', 'real maneuver instructions');
    healthy('the route detail instructions');
    capture('map-route-details');
    adb('shell', 'input', 'keyevent', '4');
    await tap('关闭路线规划', 'close the completed route preview');
}
async function personalViews() {
    await tap('AI', 'the AI board');
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
    await tap('帮助与关于', 'the about and update settings');
    await scrollFind(node => node.text.includes(`App ${product.android.versionName} · 数据 ${release.data_version}`), 'the installed app and campus data versions');
    healthy('personal settings show the selected class, account and released version');
    capture('personal-settings');
    adb('shell', 'input', 'keyevent', '4');
    await find('课表设置', 'back from about to the personal home');
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
    await find(node => node.text.includes('调用参数') && node.text.includes('调用结果') && node.text.includes(expected) && node.text.includes('TCP'), 'raw AI call arguments and the actual TCP result');
    healthy('real AI call details render without sending another prompt');
    capture('ai-call-details');
    adb('shell', 'input', 'keyevent', '4');
    await scrollTap(node => node['resource-id'] === summaryId, 'collapse the recorded AI calls', 15, -1);
    alive('the saved AI call record remains inspectable and can be collapsed');
}

try {
await device();
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
await chooseClass();
for (const [scale, name] of [['周', 'week'], ['学期', 'term'], ['任务', 'tasks'], ['天', 'day']]) {
    await tap(scale, `the ${scale} view`);
    capture(`timetable-${name}`);
}
await managedCourses();
await mapFloors();
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
await tap('教1-101', 'open 教1-101 on the map', 30);
await tap('去这里', 'route to it');
await sleep(1500);
if (screen().some(node => node.text === '暂不')) await tap('暂不', 'decline the location for now');
await find(node => node.text === '选择起点' || /条可选路线|分钟/.test(node.text), 'the route sheet', 20);
if (screen().some(node => node.text === '选择起点')) {
    await tap('选择起点', 'choose a start');
    await tap(node => node.text.startsWith('搜地点'), 'the start field');
    await type('102', 'search 102');
    dismissKeyboard();
    await tap('教1-102', 'start at 教1-102');
}
await find(node => /条可选路线|分钟/.test(node.text), 'a route (the wayfind kernel)', 30);
await routeDetails();
await knowledgeLinks();
await knowledgeFilters();
await referenceGroups();
await personalViews();
await aiTrace();
console.log(`Android smoke passed; map and settings evidence: ${evidence}`);
} catch (error) {
    if (serial) {
        try { capture('failure'); } catch { /* Preserve the original failure if the app/device is already gone. */ }
    }
    throw error;
} finally {
    if (startedEmulator && serial) adb('emu', 'kill');
}
