// Credentials arrive only over this child process's stdin. Never save browser state or print account values.
import { chromium } from 'playwright-core';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, extname, join } from 'node:path';
import assert from 'node:assert/strict';
import { totpCode } from '../../src/platform/server/totp.mjs';
let input='';for await(const chunk of process.stdin)input+=chunk;
let credential;
try { credential=JSON.parse(input.trim()); }
catch { input='';console.error('Credential input could not be decoded; no values logged.');process.exit(1); }
input='';
const origin='https://studev.hicancan.top';
const dist=resolve(import.meta.dirname,'../../dist');
const output='D:/Temp/codex/studev-web-experience';
const browser=await chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext({viewport:{width:390,height:844},locale:'zh-CN',colorScheme:'dark',serviceWorkers:'block'});
const page=await context.newPage();page.setDefaultTimeout(45_000);
const reads=[],blocked=[];let stage='initial',signedIn=false,success=false;
const safePath=path=>path.replace(/\/forms\/[^/]+/,'/forms/:id');
page.on('requestfinished',request=>{
  const url=new URL(request.url());
  if(url.origin===origin&&url.pathname.startsWith('/api/platform/')){
    const timing=request.timing();reads.push({stage,path:safePath(url.pathname),method:request.method(),ms:Math.round(timing.responseEnd)});
  }
});
await page.route(origin+'/**',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.pathname.startsWith('/api/platform/')){
    if(!['GET','HEAD'].includes(request.method())&&!['/api/platform/auth/login','/api/platform/auth/logout'].includes(url.pathname)){
      blocked.push(safePath(url.pathname));await route.abort('blockedbyclient');return;
    }
    await route.continue();return;
  }
  const local=url.pathname.startsWith('/_astro/')?url.pathname.slice(1):['/login/','/account/','/forms/','/fill/'].includes(url.pathname)?url.pathname.slice(1)+'index.html':null;
  if(!local){await route.continue();return;}
  const path=resolve(dist,local);assert(path.startsWith(dist));
  const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.woff2':'font/woff2','.svg':'image/svg+xml'};
  await route.fulfill({status:200,body:await readFile(path),contentType:types[extname(path)]||'application/octet-stream'});
});
async function logout(){
  if(!signedIn)return;
  await page.goto(origin+'/account/');
  await page.getByRole('heading',{name:'我的账号',exact:true}).waitFor();
  await page.getByRole('button',{name:'退出登录',exact:true}).click();
  await page.waitForURL(url=>url.pathname==='/login/');signedIn=false;
}
try{
  stage='password';await page.goto(origin+'/login/?next=%2Faccount%2F');
  assert.equal(await page.locator('[data-me]').count(),0);
  await page.locator('#login-student-id').fill(credential.studentId);
  await page.locator('#login-password').fill(credential.password);
  const first=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/platform/auth/login');
  await page.locator('[data-login-form] button[type=submit]').click();
  const firstResponse=await first,firstData=await firstResponse.json();
  if(firstData.mfaRequired||['MFA_REQUIRED','TOTP_REQUIRED'].includes(firstData.error?.code)){
    stage='mfa';await page.locator('#login-totp').waitFor();
    const counter=Math.floor(Date.now()/30_000);
    console.log('Using one current TOTP window; counter='+counter);
    await page.locator('#login-totp').fill(totpCode(credential.totpSecret,counter));
    const final=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/platform/auth/login');
    await page.locator('[data-login-form] button[type=submit]').click();
    assert.equal((await final).status(),200,'the single MFA attempt succeeds');
  }else assert.equal(firstResponse.status(),200,'password sign-in succeeds');
  signedIn=true;credential.password='';credential.totpSecret='';credential.studentId='';
  await page.waitForURL(url=>url.pathname==='/account/');
  await page.getByRole('heading',{name:'我的账号',exact:true}).waitFor();
  assert.equal(await page.locator('[data-me]').count(),0);
  assert.equal(await page.locator('[data-account-content]').isVisible(),true);
  assert.equal(reads.filter(item=>item.path==='/api/platform/auth/devices').length,0);
  assert.equal(reads.filter(item=>item.path==='/api/platform/admin/users').length,0);
  stage='devices';
  await page.getByRole('tab',{name:'登录设备',exact:true}).click();
  await page.locator('[data-account-devices] h3').first().waitFor();
  assert.equal(reads.filter(item=>item.path==='/api/platform/auth/devices').length,1);
  stage='forms';await page.goto(origin+'/forms/');
  await page.locator('[data-forms-list] > *').first().waitFor();
  const formLink=page.locator('[data-forms-list] a[href^="/fill/"]').first();
  if(await formLink.count()){
    stage='fill';await formLink.click();
    await page.locator('[data-fill-card]').waitFor();
    assert(!(await page.locator('[data-fill-status]').textContent()).includes('正在提交'));
    assert.equal(await page.locator('[data-fill-fields] .p-field').count()>0,true);
  }
  stage='logout';await logout();
  assert.deepEqual(blocked,[],'the read-only account visit performs no implicit writes');
  success=true;console.log('Live browser sign-in, account, devices, forms and current-session logout passed.');
}catch(error){console.error('Live browser verification failed at '+stage+' ('+error.name+'). Account values omitted.');process.exitCode=1;}
finally{
  if(signedIn){try{stage='cleanup';await logout();}catch{console.error('Current test session logout needs follow-up.');}}
  credential.password='';credential.totpSecret='';credential.studentId='';
  await writeFile(join(output,'platform-live-result.json'),JSON.stringify({success,stage,reads,blocked},null,2));
  console.log(JSON.stringify({success,stage,reads,blocked}));
  await context.close();await browser.close();
}
