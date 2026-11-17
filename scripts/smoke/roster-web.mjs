// Anonymous public organization roster through the same production projection and browser renderer.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright-core';
import {buildRosterSnapshot} from '../../src/platform/server/roster.mjs';
const origin=process.env.STUDEV_WEB_URL || 'http://127.0.0.1:4324';
const output=process.env.STUDEV_ROSTER_SMOKE_DIR || 'D:/Temp/codex/studev-roster-privacy/browser';
const firstId='00000000-0000-0000-0000-000000000051',secondId='00000000-0000-0000-0000-000000000052';
const people=[
 {id:firstId,realName:'保密𠮷',nickname:'',studentId:'PRIVATESTAFF01',qq:'10000851',role:'admin',status:'pending',term:'2026-2027',department:'主席团',title:'执行主席',signature:'一起成长',order:1},
 {id:secondId,realName:'保密姓名',nickname:'清风 <script>unsafe</script>',studentId:'PRIVATESTAFF02',qq:'10000852',role:'admin',status:'active',term:'2026-2027',department:'媒体宣传部',title:'部长',signature:'一起记录',order:2},
 {id:'00000000-0000-0000-0000-000000000053',realName:'普通用户',nickname:'不可发布',studentId:'PRIVATEUSER01',qq:'10000853',role:'user',status:'active',term:'2026-2027',department:'主席团'},
];
const snapshot=buildRosterSnapshot(people,'2026-2027','2026-11-17T00:00:00.000Z',origin);
await mkdir(output,{recursive:true});const receipts=[];
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 for(const [name,viewport,colorScheme] of [['phone',{width:390,height:844},'dark'],['desktop',{width:1440,height:1000},'light']]){
  const context=await browser.newContext({viewport,colorScheme,serviceWorkers:'block'}),calls=[],errors=[];
  await context.route('**/api/platform/**',route=>{
   const url=new URL(route.request().url());calls.push(url.pathname);
   if(url.pathname==='/api/platform/public/roster')return route.fulfill({contentType:'application/json',body:JSON.stringify(snapshot)});
   if(url.pathname===`/api/platform/members/${firstId}/avatar`)return route.fulfill({status:502,body:''});
   if(url.pathname===`/api/platform/members/${secondId}/avatar`)return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6V6sAAAAASUVORK5CYII=','base64')});
   return route.fulfill({status:403,contentType:'application/json',body:'{}'});
  });
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  const external=[];page.on('request',request=>{if(/qlogo|dst_uin|nk=/.test(request.url()))external.push(request.url());});
  await page.goto(new URL('/history/#people',origin).href);
  await page.waitForFunction(()=>document.querySelectorAll('[data-roster-container] article.member').length===2);
  const cards=page.locator('[data-roster-container] article.member');
  assert.equal(await cards.nth(0).getAttribute('id'),'member-'+firstId);
  assert.equal(await cards.nth(0).locator('h4').innerText(),'𠮷');
  assert.equal(await cards.nth(1).locator('h4').innerText(),'清风 <script>unsafe</script>');
  assert.equal(await cards.locator('script').count(),0);
  await page.waitForFunction(()=>document.querySelector('[data-roster-container] img')?.getAttribute('src')?.startsWith('data:image/svg+xml'));
  const fallback=decodeURIComponent(await cards.nth(0).locator('img').getAttribute('src'));assert(fallback.includes('𠮷'));
  const avatar=cards.nth(1).locator('img');await avatar.scrollIntoViewIfNeeded();
  await page.waitForFunction(id=>{const img=document.querySelector('#member-'+id+' img');return img?.complete&&img.naturalWidth>0;},secondId);
  assert.equal(await avatar.getAttribute('src'),origin+'/api/platform/members/'+secondId+'/avatar');
  const text=await page.locator('[data-roster-container]').innerText();
  for(const person of people)for(const privateValue of [person.realName,person.studentId,person.qq])assert(!text.includes(privateValue));
  assert(!text.includes('不可发布'));assert.equal(external.length,0);assert.equal(errors.length,0);
  assert(!calls.some(path=>/auth|admin/.test(path)));
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:`${output}/${name}.png`,fullPage:true});
  receipts.push({name,publicStaff:2,privateFieldsAbsent:true,opaqueAvatar:true,unicodeFallback:true,noAccountReads:true,noPageErrors:true,noHorizontalOverflow:true});
  await context.close();
 }
 await writeFile(output+'/result.json',JSON.stringify({ok:true,results:receipts},null,2));console.log(JSON.stringify({ok:true,results:receipts}));
}finally{await browser.close();}
