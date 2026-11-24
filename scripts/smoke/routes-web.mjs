// Test the next immutable map through normal browser consumers; only its static transport is served locally.
import assert from 'node:assert/strict';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { CAMPUS_POINTER_PATH, campusPointer } from '../../src/campus/world/release.ts';

const root = resolve(import.meta.dirname, '../..');
const origin = process.env.STUDEV_WEB_URL || 'http://127.0.0.1:4324';
const output = process.env.STUDEV_ROUTES_SMOKE_DIR || 'D:/Temp/codex/studev-design-lrmcp/routes-web';
const release = JSON.parse(await readFile(join(root, 'src/data/campus-release.json'), 'utf8'));
const pointer = campusPointer(release);
const product = JSON.parse(await readFile(join(root, 'product.json'), 'utf8'));
const dataOrigin = new URL(product.campusOrigin).origin;
const mapUrl = (from, to, mode) => new URL('/map/?'+new URLSearchParams({from,nav:to,...(mode==='bike'?{mode}: {})}),origin).href;
async function settledMap(page, id) {
  await page.waitForFunction(()=>document.querySelectorAll('.labels .lb').length>0);
  await page.evaluate(async id=>{
    let previous='',stable=0;
    for(let frame=0;frame<180;frame++){
      await new Promise(resolve=>requestAnimationFrame(resolve));
      const label=document.querySelector(`.labels .lb[data-id="${id}"]`),box=label?.getBoundingClientRect();
      const state=box?`${box.x.toFixed(2)}:${box.y.toFixed(2)}:${box.width.toFixed(2)}`:'';
      stable=state===previous?stable+1:0;previous=state;
      if(stable>=8)return;
    }
  },id);
}
await mkdir(output,{recursive:true});
const browser = await chromium.launch({channel:'msedge',headless:true}), results=[];
try {
  for(const [name,viewport] of [['phone',{width:390,height:844}],['desktop',{width:1440,height:1000}]]) {
    const context=await browser.newContext({viewport,colorScheme:'dark',serviceWorkers:'block'});
    await context.addInitScript(({release,entry})=>{
      localStorage.setItem('studev-campus-release',JSON.stringify({release,entry}));
      localStorage.setItem('studev_ball_hinted','1');
    },{release:pointer,entry:new URL(CAMPUS_POINTER_PATH, dataOrigin).href});
    await context.route(`${dataOrigin}/**`,async route=>{
      const url=new URL(route.request().url()), path=join(root,'public',decodeURIComponent(url.pathname));
      if(url.pathname===CAMPUS_POINTER_PATH) return route.fulfill({json:pointer});
      try {
        const range=route.request().headers().range?.match(/^bytes=(\d+)-(\d+)$/);
        const contentType=url.pathname.endsWith('.json')?'application/json':url.pathname.endsWith('.png')?'image/png':'application/octet-stream';
        if(!range)return route.fulfill({body:await readFile(path),contentType});
        const file=await open(path);try{const stats=await file.stat(),start=Number(range[1]),end=Math.min(Number(range[2]),stats.size-1),bytes=Buffer.alloc(end-start+1);await file.read(bytes,0,bytes.length,start);return route.fulfill({status:206,body:bytes,contentType,headers:{'Content-Range':`bytes ${start}-${end}/${stats.size}`,'Accept-Ranges':'bytes'}});}finally{await file.close();}
      } catch {return route.fulfill({status:404,body:'Not found'});}
    });
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    let graphs=0, routerModules=0;
    page.on('request',request=>{
      const path=new URL(request.url()).pathname;
      if(path.endsWith('/network.json'))graphs++;
      if(/wayfind.*\.wasm$/i.test(path))routerModules++;
    });
    await page.goto(new URL('/map/',origin).href);
    await page.locator('.labels .lb').first().waitFor();
    assert.equal(graphs,0,'The base map does not load the outside routing network');
    assert.equal(routerModules,0,'The base map does not initialize the route engine');
    for(const [from,to,floor] of [['仙林/教1-102','仙林/教1-101','1'],['仙林/教1-101','仙林/教1-201','2'],['仙林/教1/2','仙林/教1-201','2']]) {
      await page.goto(mapUrl(from,to));await page.locator('.mbody h2').filter({hasText:'同在教1'}).waitFor();
      assert.equal(await page.locator('.from select').inputValue(),from,'The URL retains the requested origin room');
      assert((await page.locator('.mbody .meta').first().innerText()).includes(`${floor} 层`));
      assert.doesNotMatch(await page.locator('.mbody').innerText(),/\d+\s*分钟|\d+\s*米|到达教1-/,'An indoor position does not invent road travel');
      await settledMap(page,'仙林/教1');
      assert.equal(graphs,0,'Indoor routes do not load the outside routing network');
      assert.equal(routerModules,0,'Indoor routes do not initialize the route engine');
      await page.screenshot({path:join(output,`${name}-inside-${floor}${from.endsWith('/2')?'-floor-origin':''}.png`),fullPage:false});
      await page.getByRole('button',{name:'查看楼层',exact:true}).click();
      await page.waitForURL(url=>url.searchParams.get('place')===to&&!url.searchParams.has('nav')&&url.searchParams.get('f')===floor);
      await page.locator('.mbody h2').filter({hasText:to.split('/')[1]}).waitFor();
      await page.waitForFunction(floor=>document.querySelector('.floors button.on')?.textContent===floor,floor);
      await settledMap(page,'仙林/教1');
      await page.screenshot({path:join(output,`${name}-floor-${floor}${from.endsWith('/2')?'-origin':''}.png`),fullPage:false});
      results.push(`${name}: requested room origin and destination, indoor ${floor} floor, no invented distance or time`);
    }
    await page.goto(mapUrl('仙林/教1-101','仙林/教2-101'));
    await page.locator('.steps').getByText('到达教2入口',{exact:true}).waitFor();
    assert.equal(graphs,1,'The first outdoor route loads one routing graph');
    assert.equal(routerModules,1,'The first outdoor route loads the engine');
    assert.equal(await page.locator('.from select').inputValue(),'仙林/教1-101');
    assert.equal(await page.locator('.mbody .meta').first().innerText(),'到 教2入口');
    assert.equal(await page.locator('.steps li').last().innerText(),'进入教2后，前往1 层 · 教2-101');
    assert.match(await page.locator('.mbody h2').innerText(),/步行/);
    await settledMap(page,'仙林/教2');
    await page.screenshot({path:join(output,`${name}-entrance.png`),fullPage:false});
    await page.locator('.from select').selectOption('仙林/教2');
    await page.locator('.mbody h2').filter({hasText:'同在教2'}).waitFor();
    assert.equal(graphs,1);
    assert.equal(await page.locator('.steps').count(),0,'Changing to the same building discards the outdoor itinerary');
    assert.doesNotMatch(await page.locator('.mbody').innerText(),/\d+\s*分钟|\d+\s*米/);
    await page.goto(mapUrl('仙林/教1-101','仙林/教2-101','bike'));
    await page.getByRole('button',{name:'骑行',exact:true,pressed:true}).waitFor();
    await page.locator('.steps').getByText('到达教2入口',{exact:true}).waitFor();
    assert.match(await page.locator('.mbody h2').innerText(),/骑行/);
    await page.getByRole('button',{name:'步行',exact:true}).click();
    await page.waitForURL(url=>!url.searchParams.has('mode'));
    await page.getByRole('button',{name:'步行',exact:true,pressed:true}).waitFor();
    assert.deepEqual(errors,[]);
    results.push(`${name}: road arrival at the building entrance, real indoor continuation, immediate same-building change`);
    results.push(`${name}: shared bike URL preserves mode and choosing walk restores its default address`);
    await context.close();
  }
  await writeFile(join(output,'result.json'),JSON.stringify({checkedAt:new Date().toISOString(),release:release.version,map:release.map_base,passed:results},null,2));
  console.log(`ok  ${results.length} real map route scenarios`);
} finally {await browser.close();}
