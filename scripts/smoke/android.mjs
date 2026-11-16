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
const product = JSON.parse(readFileSync(join(root, 'product.json'), 'utf8'));
const origin = product.origin;
const release = JSON.parse(readFileSync(join(root, 'src/data/campus-release.json'), 'utf8'));
const data = join(root, 'public/data', release.version);
const knowledge = JSON.parse(readFileSync(join(data, 'knowledge/knowledge.json'), 'utf8'));
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

const decode = text => text.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
function screen() {
    adb('shell', 'uiautomator', 'dump', '/sdcard/smoke.xml');
    const xml = adb('shell', 'cat', '/sdcard/smoke.xml');
    return [...xml.matchAll(/<node\b[^>]*>/g)].flatMap(([node]) => {
        const attrs = Object.fromEntries([...node.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, decode(value)]));
        const bounds = attrs.bounds?.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
        return bounds && +bounds[3] > +bounds[1] && +bounds[4] > +bounds[2] ? [{ ...attrs, text: attrs.text ?? '', words: `${attrs.text}|${attrs['content-desc']}`, left: +bounds[1], top: +bounds[2], right: +bounds[3], bottom: +bounds[4], x: (+bounds[1] + +bounds[3]) / 2, y: (+bounds[2] + +bounds[4]) / 2 }] : [];
    });
}
function healthy(step, nodes = screen()) {
    const error = nodes.find(node => /没能加载|没能打开|搜索需要联网|搜索数据有误|地图加载失败|无法规划|找不到路线|没有可用路线/.test(node.text));
    if (error) throw new Error(`${step}: ${error.text}`);
    alive(step);
}
function capture(name) {
    writeFileSync(join(evidence, `${name}.png`), execFileSync(adbPath, ['-s', serial, 'exec-out', 'screencap', '-p']));
    adb('shell', 'uiautomator', 'dump', '/sdcard/smoke.xml');
    writeFileSync(join(evidence, `${name}.xml`), adb('shell', 'cat', '/sdcard/smoke.xml'));
}
function alive(step) {
    if (!adb('shell', 'pidof', app).trim()) throw new Error(`the app is gone after: ${step}\n${adb('logcat', '-d', '-b', 'crash')}`);
    const crash = adb('logcat', '-d', '-b', 'crash').trim();
    if (crash.includes(`Process: ${app},`) || crash.includes(`Cmdline: ${app}\n`) || crash.includes(`>>> ${app} <<<`)) throw new Error(`the app crashed during: ${step}\n${crash}`);
    console.log(`ok  ${step}`);
}
async function find(match, step, seconds = 20) {
    for (let i = 0; i < seconds * 2; i++) {
        const hit = screen().find(node => typeof match === 'string' ? node.text === match || node.words.split('|').includes(match) : match(node));
        if (hit) return hit;
        alive(step);
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
async function scrollFind(match, step, attempts = 12) {
    for (let i = 0; i < attempts; i++) {
        const nodes = screen();
        const hit = nodes.find(node => typeof match === 'string' ? node.text === match || node.words.split('|').includes(match) : match(node));
        if (hit) return hit;
        healthy(step, nodes);
        const width = Math.max(...nodes.map(node => node.right));
        const height = Math.max(...nodes.map(node => node.bottom));
        adb('shell', 'input', 'swipe', String(Math.round(width * .55)), String(Math.round(height * .78)), String(Math.round(width * .55)), String(Math.round(height * .28)), '300');
        await sleep(300);
    }
    throw new Error(`not found while scrolling: ${step}`);
}
async function scrollTap(match, step) {
    const hit = await scrollFind(match, step);
    adb('shell', 'input', 'tap', String(Math.round(hit.x)), String(Math.round(hit.y)));
    await sleep(900);
    alive(step);
}
async function type(text, step) {
    adb('shell', 'input', 'text', text);
    await sleep(1200);
    alive(step);
}
const dismissKeyboard = () => adb('shell', 'input', 'keyevent', '111');
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
}
async function knowledgeLinks() {
    await link(`/knowledge/?course=${encodeURIComponent(course.id)}&topic=${encodeURIComponent(topic.id)}`, 'a knowledge topic');
    await find(topic.title, 'the topic explanation', 30);
    // A re-read must remain on the same topic, with no render-triggered navigation.
    for (let i = 0; i < 3; i++) { await sleep(500); if (!screen().some(node => node.text === topic.title)) throw new Error('knowledge topic changed without input'); }
    await scrollTap(reference.heading, 'follow the topic reference into its actual material');
    await find(reference.heading, 'the exact passage named by the backlink', 30);
    await scrollTap(backlink, 'follow the material knowledge chip back to the topic');
    await find(topic.title, 'the exact topic reached from its material backlink', 30);
    await link(`/knowledge/?course=${encodeURIComponent(course.id)}&material=${encodeURIComponent(reference.material)}#${encodeURIComponent(reference.anchor)}`, 'the same material anchor as a cold deep link');
    await find(reference.heading, 'the exact passage reopened by its URL', 30);
    healthy('topic/reference/material/backlink and anchored deep link');
    adb('shell', 'input', 'keyevent', '4');
    await find('目录 ▾', 'back to the course outline');
    adb('shell', 'input', 'keyevent', '4');
    await find(node => node.text.startsWith('筛选课程'), 'back to the course list');
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
    const nodes = screen(), width = Math.max(...nodes.map(node => node.right)), height = Math.max(...nodes.map(node => node.bottom));
    await tap(node => node.clickable === 'true' && node.x > width * .85 && node.y < height * .15 && !node.text, 'the personal profile button');
    await find('班级', 'the personal settings sheet');
    await find(node => node.text.includes('B240402'), 'the selected class is retained');
    await scrollFind('账号', 'the account entry in personal settings');
    await scrollFind(node => node.text.includes(`App ${product.android.versionName} · 数据 ${release.data_version}`), 'the installed app and campus data versions');
    healthy('personal settings show the selected class, account and released version');
    capture('personal-settings');
    adb('shell', 'input', 'keyevent', '4');
    await find('课表', 'return from personal settings');
}

try {
await device();
const installed = adb('shell', 'pm', 'list', 'packages', app).split(/\r?\n/).includes(`package:${app}`);
console.log(`installing ${apk} on ${serial}`);
adb('install', '-r', apk);
adb('logcat', '-c');
adb('shell', 'am', 'force-stop', app);
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
adb('shell', 'monkey', '-p', app, '-c', 'android.intent.category.LAUNCHER', '1');
await sleep(4000);
await chooseClass();
for (const scale of ['周', '学期', '清单', '天']) await tap(scale, `the ${scale} view`);
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
await personalViews();
console.log(`Android smoke passed; map and settings evidence: ${evidence}`);
} catch (error) {
    if (serial) {
        try { capture('failure'); } catch { /* Preserve the original failure if the app/device is already gone. */ }
    }
    throw error;
} finally {
    if (startedEmulator && serial) adb('emu', 'kill');
}
