// Production-browser parity + interaction checks. Use a fresh, owned browser profile.
// node src/campus/academics/parity/capture.mjs http://127.0.0.1:4325 <shots-directory>
import puppeteer from 'puppeteer';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const base = process.argv[2] ?? 'http://127.0.0.1:4325';
const directory = process.argv[3] ?? 'D:/Temp/claude-wsl/agents/parity/shots';
mkdirSync(directory, {recursive:true});
const golden = JSON.parse(readFileSync('src/campus/academics/parity/golden.json','utf8'));
const browser = await puppeteer.launch({headless:true, args:['--no-sandbox','--disable-gpu']});
const reports = [];
try {
    for (const theme of ['light','dark']) {
        const context = await browser.createBrowserContext();
        const page = await context.newPage();
        await page.setViewport({width:412,height:914,deviceScaleFactor:2.625,isMobile:true,hasTouch:true});
        await page.emulateMediaFeatures([{name:'prefers-color-scheme',value:theme}]);
        await page.evaluateOnNewDocument(theme=>{
            localStorage.setItem('site-theme',theme);
            localStorage.setItem('studev_prefs',JSON.stringify({class:'B240402',campus:'仙林'}));
        },theme);
        const errors = [];
        page.on('pageerror',error=>errors.push(error.message));
        const go = async path => { await page.goto(base+path,{waitUntil:'networkidle0'}); };
        const shot = async (name,fullPage=false) => {
            await page.evaluate(()=>document.fonts.ready);
            await page.screenshot({path:join(directory,`web-${name}-${theme}.png`),fullPage});
        };
        const click = async (selector,text) => page.evaluate(({selector,text})=>{
            const target = [...document.querySelectorAll(selector)].find(el=>el.textContent.trim()===text);
            if (!target) throw new Error(`Missing ${selector}: ${text}`);
            target.click();
        },{selector,text});
        const cells = async () => page.$$eval('[data-meeting]',elements=>elements.map(el=>({
            id:el.dataset.meeting, state:el.dataset.state, colourIndex:Number(el.dataset.colour), slot:Number(el.dataset.slot),
            columns:Number(el.parentElement.style.getPropertyValue('--overlap-columns')),
            day:Number(el.parentElement.style.gridColumnStart)-1,
            periods:[Number(el.parentElement.style.gridRowStart)+Number(el.style.gridRowStart)-2,Number(el.parentElement.style.gridRowStart)+Number(el.style.gridRowEnd)-3],
            course:el.querySelector('strong')?.textContent??'', room:el.querySelector('span')?.textContent??'', note:el.querySelector('small')?.textContent??'',label:el.querySelector('em')?.textContent??'',
            background:getComputedStyle(el).backgroundColor, foreground:getComputedStyle(el).color,
        })));
        await go('/search/timetable/?class=B240402&week=9');
        await page.waitForSelector('[data-meeting]');
        assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),theme);
        const actual = await cells();
        const expected = golden.schedules[0].weeks.find(w=>w.week===9).cells;
        for (const cell of expected) {
            const match = actual.find(c=>c.id===cell.id); assert.ok(match,cell.id);
            for (const key of ['state','colourIndex','slot','columns','day','periods','course','room','note','label']) assert.deepEqual(match[key],cell[key],`${theme} ${cell.id} ${key}`);
        }
        assert.equal(actual.length,expected.length);
        writeFileSync(join(directory,`web-B240402-w9-cells-${theme}.json`),JSON.stringify(actual,null,2));
        await shot('B240402-w9-week'); await shot('B240402-w9-week-full',true);
        await (await page.$('.timetable-grid')).screenshot({path:join(directory,`web-B240402-w9-week-grid-${theme}.png`)});
        await click('button','日视图');
        await page.evaluate(()=>[...document.querySelectorAll('.timetable-day-picker button')][3].click());
        await shot('B240402-w9-day4'); await shot('B240402-w9-day4-full',true);
        assert.equal((await cells()).length,expected.filter(c=>c.day===4).length);
        await (await page.$('.timetable-grid')).screenshot({path:join(directory,`web-B240402-w9-day4-grid-${theme}.png`)});
        await page.evaluate(()=>[...document.querySelectorAll('.timetable-day-picker button')][5].click());
        await (await page.$('.timetable-grid')).screenshot({path:join(directory,`web-B240402-w9-day6-grid-${theme}.png`)});
        await go('/search/timetable/?class=B240402&week=3'); await page.waitForSelector('[data-meeting]');
        await click('button','日视图'); await page.evaluate(()=>[...document.querySelectorAll('.timetable-day-picker button')][3].click());
        await (await page.$('.timetable-grid')).screenshot({path:join(directory,`web-B240402-w3-day4-grid-${theme}.png`)});
        await go('/search/timetable/?class=B250105&week=9'); await page.waitForSelector('[data-meeting]');
        await click('button','日视图');
        for (const weekday of [1,6]) {
            await page.evaluate(d=>[...document.querySelectorAll('.timetable-day-picker button')][d-1].click(),weekday);
            const rendered = await cells();
            const expected = golden.schedules[1].weeks.find(w=>w.week===9).cells.filter(c=>c.day===weekday);
            assert.equal(rendered.length,expected.length);
            for (const cell of expected) {
                const match = rendered.find(c=>c.id===cell.id); assert.ok(match);
                for (const key of ['state','colourIndex','slot','columns','periods','course','room','note','label']) assert.deepEqual(match[key],cell[key]);
            }
            await (await page.$('.timetable-grid')).screenshot({path:join(directory,`web-B250105-w9-day${weekday}-grid-${theme}.png`)});
        }
        await go('/search/exam/?class=B240402'); await page.waitForSelector('h3');
        assert.deepEqual(await page.$$eval('[data-exam]',elements=>elements.map(e=>e.dataset.exam)),golden.exams[0].exams.map(e=>e.id));
        await shot('B240402-exams'); await shot('B240402-exams-full',true);
        await go('/search/classrooms/?date=2026-10-30&period=3&campus=仙林'); await page.waitForSelector('.classrooms-room');
        await page.click('.building-filter summary'); await click('.building-filter-actions button','全不选');
        assert.equal(await page.$$eval('.classrooms-room',els=>els.length),0);
        for (const id of ['教3','教4']) await click('.building-filter-options label',id);
        await shot('rooms-building-menu'); await click('.building-filter-actions button','完成');
        await page.waitForFunction(()=>document.querySelector('.classrooms-summary p')?.textContent.includes('25'));
        await shot('rooms-filter'); await shot('rooms-filter-full',true);
        const readRooms = () => page.$$eval('.classrooms-room',els=>({rooms:els.map(e=>e.getAttribute('aria-label').split('，')[0]).sort(),free:els.filter(e=>e.classList.contains('is-free')).map(e=>e.getAttribute('aria-label').split('，')[0]).sort()}));
        const roomCase = golden.rooms.cases.find(c=>c.date==='2026-10-30' && c.selection.from===3 && c.selection.minSeats===0 && JSON.stringify(c.selection.buildings)==='["教3","教4"]');
        assert.deepEqual(await readRooms(),roomCase.expected);
        await page.reload({waitUntil:'networkidle0'}); await page.waitForSelector('.classrooms-room');
        assert.deepEqual(await readRooms(),roomCase.expected);
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'phone horizontal overflow');
        assert.deepEqual(errors,[]);
        reports.push({theme,weekCells:actual.length,dayCells:expected.filter(c=>c.day===4).length,examCount:golden.exams[0].exams.length,matchingRooms:roomCase.expected.rooms.length,freeRooms:roomCase.expected.free.length,errors});
        await context.close();
    }
} finally { await browser.close(); }
writeFileSync(join(directory,'browser-results.json'),JSON.stringify(reports,null,2));
console.log(JSON.stringify(reports));
