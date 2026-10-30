// Arrange untouched screenshots for review; originals remain alongside the comparisons.
// node src/campus/academics/parity/compare.mjs <shots-directory>
import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const directory = process.argv[2] ?? 'D:/Temp/claude-wsl/agents/parity/shots';
const appDirectory = join(directory,'parity-shots');
const golden = JSON.parse(readFileSync('src/campus/academics/parity/golden.json','utf8'));
const tokens = JSON.parse(readFileSync('design/tokens.json','utf8'));
const app = JSON.parse(readFileSync(join(appDirectory,'app-B240402-w9-cells.json'),'utf8'));
assert.deepEqual(app,golden.schedules[0].weeks.find(w=>w.week===9).cells);
const comparisons = [];
const width = 1080, gap = 24, header = 60;
for (const theme of ['light','dark']) {
    const marker = JSON.parse(readFileSync(join(appDirectory,`app-assertions-${theme}.json`),'utf8'));
    assert.equal(marker.assertions,'passed');
    const pairs = [
        ['week',`web-B240402-w9-week-${theme}.png`,`app-B240402-w9-week-${theme}-top.png`],
        ['day',`web-B240402-w9-day4-grid-${theme}.png`,`app-B240402-w9-day4-${theme}-bottom.png`],
        ['exams',`web-B240402-exams-${theme}.png`,`app-B240402-exams-${theme}.png`],
        ['rooms',`web-rooms-filter-${theme}.png`,`app-rooms-filter-${theme}.png`],
        ['buildings',`web-rooms-building-menu-${theme}.png`,`app-rooms-building-menu-${theme}.png`],
        ['suspended',`web-B240402-w3-day4-grid-${theme}.png`,`app-B240402-w3-day4-${theme}-bottom.png`],
        ['parallel',`web-B250105-w9-day1-grid-${theme}.png`,`app-B250105-w9-day1-${theme}-bottom.png`],
        ['overlap',`web-B250105-w9-day6-grid-${theme}.png`,`app-B250105-w9-day6-${theme}-bottom.png`],
    ];
    for (const [name,webFile,appFile] of pairs) {
        const left = await sharp(join(directory,webFile)).resize({width}).png().toBuffer();
        const right = await sharp(join(appDirectory,appFile)).resize({width}).png().toBuffer();
        const height = Math.max((await sharp(left).metadata()).height,(await sharp(right).metadata()).height);
        const labels = Buffer.from(`<svg width="${width*2+gap}" height="${header}"><rect width="100%" height="100%" fill="${tokens.color[theme].surface}"/><g font-family="sans-serif" font-size="26" fill="${tokens.color[theme].ink}"><text x="24" y="40">Web · 412 CSS px · ${theme} · ${name}</text><text x="${width+gap+24}" y="40">Android · emulator-5556 · ${theme} · ${name}</text></g></svg>`);
        const filename = `compare-${name}-${theme}.png`;
        await sharp({create:{width:width*2+gap,height:height+header,channels:4,background:tokens.color[theme].paper}})
            .composite([{input:labels,left:0,top:0},{input:left,left:0,top:header},{input:right,left:width+gap,top:header}]).png().toFile(join(directory,filename));
        comparisons.push(filename);
    }
}
writeFileSync(join(directory,'comparison-results.json'),JSON.stringify({cellEquality:'all 17 native cells match the shared web golden, including day/periods/state/colour/notes/columns',comparisons},null,2));
console.log(JSON.stringify({matchedCells:app.length,comparisons:comparisons.length}));
