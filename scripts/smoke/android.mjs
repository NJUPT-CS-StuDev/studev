// The Android app as it ships, opened and used on an emulator before it is released: chosen a class, the four boards,
// a search and a route, so the native kernels, the map and the sheets are all exercised. After every step the app
// must still be running and must have written nothing to the crash log. Usage: node android.mjs <apk>
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const apk = process.argv[2];
if (!apk || !existsSync(apk)) throw new Error(`no APK at ${apk}`);
const sdk = process.env.ANDROID_HOME ?? 'D:\\Dev\\Android\\Sdk';
const adbPath = join(sdk, 'platform-tools', 'adb.exe');
const avd = process.env.STUDEV_SMOKE_AVD ?? 'studev-2';
// The package as the APK names it: the release, or a debug build checked the same way.
const badging = execFileSync(join(sdk, 'build-tools', '36.1.0', 'aapt.exe'), ['dump', 'badging', apk], { encoding: 'utf8' });
const app = /package: name='([^']+)'/.exec(badging)?.[1] ?? (() => { throw new Error(`no package in ${apk}`); })();
const sleep = ms => new Promise(done => setTimeout(done, ms));
const adb = (...args) => execFileSync(adbPath, args, { encoding: 'utf8', timeout: 120_000 });

async function device() {
    if (/\tdevice$/m.test(adb('devices'))) return;
    console.log(`starting emulator ${avd}`);
    spawn(join(sdk, 'emulator', 'emulator.exe'), ['-avd', avd, '-no-window', '-no-snapshot-save', '-no-audio'], { detached: true, stdio: 'ignore' }).unref();
    adb('wait-for-device');
    for (let i = 0; i < 120; i++) { if (adb('shell', 'getprop', 'sys.boot_completed').trim() === '1') return; await sleep(2000); }
    throw new Error('the emulator did not finish booting');
}

/** What the screen shows: each node's words and where it is. */
function screen() {
    adb('shell', 'uiautomator', 'dump', '/sdcard/smoke.xml');
    const xml = adb('shell', 'cat', '/sdcard/smoke.xml');
    return [...xml.matchAll(/<node [^>]*?text="([^"]*)"[^>]*?content-desc="([^"]*)"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g)]
        .map(([, text, desc, x1, y1, x2, y2]) => ({ words: `${text}|${desc}`, text, x: (+x1 + +x2) / 2, y: (+y1 + +y2) / 2 }));
}
function alive(step) {
    if (!adb('shell', 'pidof', app).trim()) throw new Error(`the app is gone after: ${step}\n${adb('logcat', '-d', '-b', 'crash')}`);
    const crash = adb('logcat', '-d', '-b', 'crash').trim();
    if (crash) throw new Error(`the app crashed during: ${step}\n${crash}`);
    console.log(`ok  ${step}`);
}
async function find(match, step, seconds = 20) {
    for (let i = 0; i < seconds * 2; i++) {
        const hit = screen().find(node => typeof match === 'string' ? node.text === match || node.words.split('|').includes(match) : match(node));
        if (hit) return hit;
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

await device();
console.log(`installing ${apk}`);
try { adb('install', '-r', apk); }
catch (error) {
    // A copy signed with another key (a debug build kept on the emulator) is replaced, not updated.
    if (!/INSTALL_FAILED_UPDATE_INCOMPATIBLE/.test(String(error.stderr ?? error.message))) throw error;
    adb('uninstall', app);
    adb('install', apk);
}
adb('shell', 'pm', 'clear', app);
adb('logcat', '-c');
adb('shell', 'monkey', '-p', app, '-c', 'android.intent.category.LAUNCHER', '1');
await sleep(4000);
alive('open the app');

await tap(node => node.text.startsWith('比如'), 'the class picker');
await type('B240402', 'search a class');
await tap(node => node.text.includes('计算机科学与技术'), 'choose B240402');
dismissKeyboard();
for (const scale of ['周', '学期', '清单', '天']) await tap(scale, `the ${scale} view`);
await tap('地图', 'the map', 30);
await sleep(4000); alive('the map, drawn');
await tap('搜索', 'the search board');
await tap(node => node.text.startsWith('搜课程'), 'the search field');
await type('101', 'search 101');
await find(node => /条结果/.test(node.text), 'search results (the search kernel)', 30);
dismissKeyboard();
await tap(node => node.text === '教1-101', 'open 教1-101 on the map', 30);
await tap('去这里', 'route to it');
// A first route asks for the location: the smoke goes on without it, choosing where to start instead.
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
await tap('知识', 'the knowledge board');
await tap('AI', 'the AI board');
await tap('课表', 'back to the timetable');
console.log('Android smoke passed');
