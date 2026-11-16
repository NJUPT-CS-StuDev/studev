// Exercise the APK itself over the released campus data: an upgrade preserving its cache,
// then a fresh start, search, knowledge links, the map and a route.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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
const origin = JSON.parse(readFileSync(join(root, 'product.json'), 'utf8')).origin;
const release = JSON.parse(readFileSync(join(root, 'src/data/campus-release.json'), 'utf8'));
const knowledge = JSON.parse(readFileSync(join(root, 'public/data', release.version, 'knowledge/knowledge.json'), 'utf8'));
const course = knowledge.courses.find(c => c.name === '数据结构');
const topic = knowledge.topics.find(t => t.taught_by.includes(course.id) && t.references.some(ref => knowledge.materials.some(m => m.path === ref.material && m.course === course.id)));
const reference = topic.references.find(ref => knowledge.materials.some(m => m.path === ref.material && m.course === course.id));
const material = knowledge.materials.find(m => m.path === reference.material);
const sleep = ms => new Promise(done => setTimeout(done, ms));
let serial;
let startedEmulator = false;
const adb = (...args) => execFileSync(adbPath, [...(serial ? ['-s', serial] : []), ...args], { encoding: 'utf8', timeout: 120_000 });

async function device() {
    const online = () => [...adb('devices').matchAll(/^(emulator-\d+)\s+device$/gm)].map(m => m[1]);
    serial = online()[0];
    if (serial) return;
    console.log(`starting emulator ${avd}`);
    startedEmulator = true;
    spawn(join(sdk, 'emulator', 'emulator.exe'), ['-avd', avd, '-no-window', '-no-snapshot-save', '-no-audio'], { detached: true, stdio: 'ignore' }).unref();
    for (let i = 0; i < 120; i++) {
        serial = online()[0];
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
        return bounds ? [{ ...attrs, text: attrs.text ?? '', words: `${attrs.text}|${attrs['content-desc']}`, x: (+bounds[1] + +bounds[3]) / 2, y: (+bounds[2] + +bounds[4]) / 2 }] : [];
    });
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
}
async function knowledgeLinks() {
    await link(`/knowledge/?course=${encodeURIComponent(course.id)}&topic=${encodeURIComponent(topic.id)}`, 'a knowledge topic');
    await find(topic.title, 'the topic explanation', 30);
    // A re-read must remain on the same topic, with no render-triggered navigation.
    for (let i = 0; i < 3; i++) { await sleep(500); if (!screen().some(node => node.text === topic.title)) throw new Error('knowledge topic changed without input'); }
    await link(`/knowledge/?course=${encodeURIComponent(course.id)}&material=${encodeURIComponent(material.path)}#${encodeURIComponent(reference.anchor)}`, 'a linked material passage');
    await find(reference.heading, 'the exact passage named by the backlink', 30);
    adb('shell', 'input', 'keyevent', '4');
    await find('目录 ▾', 'back to the course outline');
    adb('shell', 'input', 'keyevent', '4');
    await find(node => node.text.startsWith('筛选课程'), 'back to the course list');
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
// A second process reuses exactly what the first search cached.
adb('shell', 'am', 'force-stop', app);
adb('shell', 'monkey', '-p', app, '-c', 'android.intent.category.LAUNCHER', '1');
await sleep(2000);
await search101();
alive('search after reopening with cached data');

// Only the selected emulator is reset for the independent first-run exercise.
adb('shell', 'pm', 'clear', app);
adb('logcat', '-c');
adb('shell', 'monkey', '-p', app, '-c', 'android.intent.category.LAUNCHER', '1');
await sleep(4000);
await chooseClass();
for (const scale of ['周', '学期', '清单', '天']) await tap(scale, `the ${scale} view`);
await tap('地图', 'the map', 30);
await sleep(4000); alive('the map, drawn');
// Leaving while uncached searches fetch blocks must not release the engine they still use.
for (const query of ['考试', '创新', '通信']) {
    startLink(`/search/?q=${encodeURIComponent(query)}`);
    await sleep(250);
    await link('/', `leave the in-flight search for ${query}`);
}
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
alive('a route');
await knowledgeLinks();
await tap('AI', 'the AI board');
await tap('课表', 'back to the timetable');
console.log('Android smoke passed');
} finally {
    if (startedEmulator && serial) adb('emu', 'kill');
}
