// Isolated browser transport gates exercise the normal platform client while independent reads are pending.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const origin = process.env.STUDEV_WEB_URL || 'http://127.0.0.1:4322';
const output = process.env.STUDEV_WEB_SMOKE_DIR || 'D:/Temp/codex/studev-web-experience';
await mkdir(output, {recursive:true});
const gate = () => { let release; const ready = new Promise(resolve => {release=resolve;}); return {ready,release}; };
const user = { id:'browser-test', studentId:'B240000', realName:'验收用户', nickname:'验收用户', qq:'', email:'', role:'admin', status:'active', profileComplete:true, identityVerified:true, revision:1, totpEnabled:false, mustChangePassword:false, signature:'' };
const current = {user,csrfToken:'browser-transport-test',mfaVerified:true};
const form = {id:'browser-test',title:'页面验收表单',description:'填写过程中保留内容。',status:'published',access:'public',deadline:'',requireReview:false,allowEdit:false,maxPerUser:1,maxSubmissions:100,revision:1,fields:[{id:'question',type:'text',label:'填写内容',required:true}]};
const device = {id:'test-device',deviceName:'验收浏览器',createdAt:'2026-11-16T00:00:00Z',expiresAt:Date.parse('2026-12-16T00:00:00Z'),kind:'cookie',current:true};
const browser = await chromium.launch({channel:'msedge',headless:true});
const passed=[];
const record=value=>{passed.push(value);console.log(`ok  ${value}`);};
async function newPage(viewport) {
  const context=await browser.newContext({viewport,colorScheme:'dark',locale:'zh-CN',serviceWorkers:'block'});
  const page=await context.newPage();page.setDefaultTimeout(15_000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  return {context,page,errors};
}
async function shot(page,name){await page.screenshot({path:join(output,name+'.png'),animations:'disabled'});}
try {
  for(const [name,viewport] of [['phone',{width:390,height:844}],['desktop',{width:1440,height:1000}]]) {
    const {context,page,errors}=await newPage(viewport);
    const identity=gate();let sessions=0,syncs=0,authenticated=false;
    await page.route('**/api/platform/**',async route=>{
      const path=new URL(route.request().url()).pathname;
      if(path.endsWith('/auth/session')){sessions++;await identity.ready;await route.fulfill(authenticated?{json:current}:{status:401,json:{error:{message:'请登录。',code:'AUTH_REQUIRED'}}});}
      else if(path.endsWith('/forms/browser-test'))await route.fulfill({json:{form,canSubmit:true}});
      else if(path.endsWith('/sync')){syncs++;await route.fulfill({json:{tasks:[],settings:{}}});}
      else await route.fulfill({status:404,json:{error:{message:'Unexpected platform read'}}});
    });
    await page.goto(origin+'/fill/?id=browser-test');
    const answer=page.getByRole('textbox', {name:/^填写内容/});
    await answer.fill('身份查询期间填写的内容');
    assert(await page.locator('[data-fill-submit]').isDisabled());
    assert(!(await page.locator('[data-fill-status]').textContent()).includes('提交'));
    await shot(page,`${name}-form-pending-identity`);
    identity.release();
    await page.waitForFunction(()=>!document.querySelector('[data-fill-submit]').disabled);
    assert.equal(await answer.inputValue(),'身份查询期间填写的内容');
    assert.equal(sessions,1,'navigation and form share one in-flight session');
    authenticated=true;
    await page.reload();
    await page.waitForFunction(()=>!document.querySelector('[data-fill-submit]').disabled);
    assert.equal(syncs,0,'a form does not start unrelated campus sync');
    const syncResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/platform/sync');
    await page.locator('[data-me]').click();
    await syncResponse;
    assert.equal(syncs,1,'opening campus settings explicitly starts its synchronization');
    assert.deepEqual(errors,[]);await context.close();
    record(`${name}: public form editable before identity completes, submission phase honest, one session request`);

    const account=await newPage(viewport), counts={session:0,devices:0,members:0},unexpected=[];
    let deviceGate=null, failAccount=false;
    await account.page.route('**/api/platform/**',async route=>{
      const path=new URL(route.request().url()).pathname;
      if(path.endsWith('/auth/session')){counts.session++;await route.fulfill(failAccount?{status:503,json:{error:{message:'账号读取暂时中断。'}}}:{json:current});}
      else if(path.endsWith('/auth/devices')){counts.devices++;if(deviceGate)await deviceGate.ready;await route.fulfill({json:{items:[device]}});}
      else if(path.endsWith('/admin/users')){counts.members++;await route.fulfill({json:{items:[]}});}
      else {unexpected.push(path);await route.fulfill({status:404,json:{error:{message:'Unexpected platform read'}}});}
    });
    await account.page.goto(origin+'/account/');
    await account.page.getByRole('heading',{name:'我的账号',exact:true}).waitFor();
    assert.equal(await account.page.locator('[data-me]').count(),0,'the account destination has no repeated personal-menu entry');
    assert.equal(await account.page.locator('astro-island[component-url*="MeApp"]').count(),0,'the account destination mounts no unused campus preferences island');
    assert.equal(new URL(account.page.url()).pathname,'/account/','a real session is not rejected for missing localStorage hints');
    assert.deepEqual(counts,{session:1,devices:0,members:0},'profile does not fetch devices or the staff roster');
    await shot(account.page,`${name}-account-profile`);
    await account.page.getByRole('tab',{name:'账号安全',exact:true}).click();
    await account.page.getByRole('heading',{name:'账号安全',exact:true}).waitFor();
    assert(await account.page.locator('[data-profile-form]').isHidden());
    await shot(account.page,`${name}-account-security`);
    await account.page.getByRole('tab',{name:'登录设备',exact:true}).click();
    await account.page.locator('[data-account-devices] h3').waitFor();
    assert.equal(counts.devices,1);
    deviceGate=gate();
    await account.page.getByRole('button',{name:'刷新设备',exact:true}).click();
    await account.page.getByText('正在刷新设备…',{exact:true}).waitFor();
    assert(await account.page.locator('[data-account-devices] h3').isVisible(),'previous device rows remain visible during refresh');
    assert(await account.page.getByRole('button',{name:'刷新设备',exact:true}).isDisabled());
    deviceGate.release();deviceGate=null;
    await account.page.waitForFunction(()=>!document.querySelector('[data-devices-refresh]').disabled);
    await account.page.getByRole('button',{name:'退出此设备',exact:true}).click();
    await account.page.getByRole('button',{name:'取消',exact:true}).click();
    assert.equal(counts.devices,2,'cancel restores the row without another read');
    await account.page.getByRole('tab',{name:'我的账号',exact:true}).click();
    await account.page.getByRole('tab',{name:'登录设备',exact:true}).click();
    assert.equal(counts.devices,2,'reopening the loaded panel shares its current contents');
    await shot(account.page,`${name}-account-devices`);
    failAccount=true;
    await account.page.goto(origin+'/account/');
    await account.page.getByRole('button',{name:'重新读取账号',exact:true}).waitFor();
    assert(await account.page.locator('[data-account-status]').isVisible(),'account failures are visible');
    failAccount=false;
    await account.page.getByRole('button',{name:'重新读取账号',exact:true}).click();
    await account.page.getByRole('heading',{name:'我的账号',exact:true}).waitFor();
    assert.deepEqual(account.errors,[]);assert.deepEqual(unexpected,[],'closed account avatar does not start unrelated campus synchronization');await account.context.close();
    record(`${name}: account tabs, lazy device/roster reads, preserved rows, cancel without fetch and visible failure retry`);

    const visual=await newPage(viewport);
    await visual.page.goto(origin+'/search/');
    await visual.page.getByRole('textbox',{name:'搜索',exact:true}).waitFor();
    if(name==='phone') {
      const search=await visual.page.locator('.sfield').boundingBox(), avatar=await visual.page.locator('[data-me]').boundingBox();
      assert(Math.abs(search.y+search.height/2-avatar.y-avatar.height/2)<1,'search and avatar share one centre');
      assert.equal(search.height,36);assert(search.x+search.width<=avatar.x);
    }
    await shot(visual.page,`${name}-search-shared-components`);
    if(name==='phone') {
      await visual.page.locator('[data-me-name]').evaluate(element=>{element.textContent='测试最长显示昵称';});
      const search=await visual.page.locator('.sfield').boundingBox(), avatar=await visual.page.locator('[data-me]').boundingBox();
      assert(search.x+search.width<=avatar.x,'the longest displayed nickname still has its own header space');
      await shot(visual.page,`${name}-search-long-name`);
    }
    assert.deepEqual(visual.errors,[]);await visual.context.close();
    record(`${name}: search geometry and shared component visual evidence`);
  }
  await writeFile(join(output,'platform-result.json'),JSON.stringify({origin,passed},null,2));
} finally {await browser.close();}
