// Member profiles and management in isolated browser sessions; every account request is a fixture.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const origin = new URL(process.env.STUDEV_WEB_URL || 'http://127.0.0.1:4324');
const output = process.env.STUDEV_MEMBERS_SMOKE_DIR || 'D:/Temp/codex/studev-design-lrmcp/members-web';
await mkdir(output,{recursive:true});
const browser = await chromium.launch({channel:'msedge',headless:true});
const results=[];
const member=(i)=>({id:`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`,nickname:i===1?'清风 <script>unsafe</script>':i===2?'很长的昵称'.repeat(7):`同学 ${i}`,signature:i===1?'一起学习，也一起发现。':i===2?'很长的签名'.repeat(24):'',avatarUrl:new URL(`/api/platform/avatars/${i}`,origin).href});
const members=Array.from({length:51},(_,i)=>member(i+1));
const session={user:{id:'fixture-user',nickname:'验收昵称',realName:'PRIVATE_REAL_NAME',studentId:'PRIVATE_STUDENT_ID',qq:'123456789',email:'private@example.invalid',role:'user',status:'active',revision:1,profileComplete:true,identityVerified:true},csrfToken:'fixture-only',mfaVerified:true};
try {
    for(const width of [390,1440]) {
        const context=await browser.newContext({viewport:{width,height:900},colorScheme:width===390?'dark':'light'});
        const calls=[]; let failNext=false;
        await context.route('**/*',route=>new URL(route.request().url()).origin===origin.origin?route.continue():route.abort());
        await context.route('**/api/platform/**',async route=>{
            const request=route.request(),url=new URL(request.url()); calls.push({path:url.pathname,method:request.method(),query:url.search});
            const json=(value,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
            if(url.pathname==='/api/platform/auth/session')return json(session);
            if(url.pathname==='/api/platform/sync')return json({tasks:[],settings:{}});
            if(url.pathname.startsWith('/api/platform/avatars/'))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44"><rect width="44" height="44" fill="#789"/></svg>'});
            if(url.pathname==='/api/platform/members') {
                if(failNext){failNext=false;return json({error:{message:'成员暂时无法读取'}},503);}
                const query=url.searchParams.get('query')||'',offset=Number(url.searchParams.get('offset')||0),limit=50;
                const filtered=members.filter(item=>item.nickname.includes(query));
                return json({items:filtered.slice(offset,offset+limit),total:filtered.length,offset,limit,
                    ...(url.searchParams.get('entry')==='1' ? {session} : {})});
            }
            if(url.pathname.startsWith('/api/platform/members/')) {
                const found=members.find(item=>url.pathname.endsWith('/'+item.id));
                return found?json({member:found,...(url.searchParams.get('entry')==='1' ? {session} : {})}):json({error:{message:'找不到这位成员'}},404);
            }
            return json({error:{message:'fixture endpoint unavailable'}},403);
        });
        const page=await context.newPage();
        await page.goto(new URL('/members/',origin).href);
        await page.waitForFunction(()=>document.querySelectorAll('.p-member-row').length===50);
        assert.equal(await page.locator('[data-members-count]').textContent(),'51 位成员');
        assert.equal(calls.filter(call=>call.path==='/api/platform/members').length,1);
        assert(!calls.some(call=>call.path==='/api/platform/auth/session'));
        await page.locator('[data-me]').click();
        await page.getByRole('link', { name: /^成员\s/ }).filter({ hasText: '昵称与签名' }).waitFor();
        await page.keyboard.press('Escape');
        await page.getByRole('button',{name:'加载更多',exact:true}).click();
        await page.waitForFunction(()=>document.querySelectorAll('.p-member-row').length===51);
        assert(await page.getByRole('button',{name:'加载更多',exact:true}).isHidden());
        await page.locator('.p-member-row').first().click();
        const heading = page.getByRole('heading', { name: members[0].nickname, exact: true });
        await heading.waitFor();
        assert.equal(await heading.textContent(), members[0].nickname);
        assert.equal(await page.locator('[data-members-profile] script').count(),0);
        const text=await page.locator('body').innerText();
        for(const privateValue of ['PRIVATE_REAL_NAME','PRIVATE_STUDENT_ID','123456789','private@example.invalid'])assert(!text.includes(privateValue));
        await page.screenshot({path:`${output}/${width}-profile.png`,fullPage:true});
        await page.goBack(); await page.locator('[data-members-search]').waitFor();
        await page.getByRole('searchbox',{name:'搜索昵称'}).fill('很长');
        await page.waitForFunction(()=>document.querySelectorAll('.p-member-row').length===1 && document.querySelector('.p-member-copy strong')?.textContent.startsWith('很长'));
        assert(calls.some(call=>new URLSearchParams(call.query).get('query')==='很长'));
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
        await page.screenshot({path:`${output}/${width}-search.png`,fullPage:true});
        failNext=true; await page.getByRole('searchbox',{name:'搜索昵称'}).fill('同学 3');
        await page.getByText('成员暂时无法读取',{exact:true}).waitFor();
        await page.getByRole('button',{name:'重试',exact:true}).click();
        await page.waitForFunction(()=>document.querySelectorAll('.p-member-row').length===11);
        await page.goto(new URL('/members/?id=missing',origin).href); await page.getByText('找不到这位成员',{exact:true}).waitFor();
        assert(calls.filter(call=>call.path.startsWith('/api/platform/members')).every(call=>call.method==='GET'));
        assert(calls.filter(call=>call.method!=='GET').every(call=>call.path==='/api/platform/sync'));
        assert(!calls.some(call=>call.path.includes('/admin/')||call.path.includes('/users')));
        results.push({width,passed:true,checks:['ordinary role','one authenticated request for the first page','Me entry','search nickname','pagination','profile and Back','literal user text','private fields absent','no horizontal overflow','503 retry','404','public member GET only; existing sync mocked']});
        await context.close();
    }
    for (const role of ['admin', 'owner']) {
        const context = await browser.newContext();
        const staff = { ...session, user: { ...session.user, id: 'fixture-' + role, role } };
        const managedUser = { ...session.user, id: members[0].id, memberships: [] };
        const calls = [];
        await context.route('**/api/platform/**', async route => {
            const { pathname, searchParams } = new URL(route.request().url());
            calls.push(pathname);
            if (pathname === '/api/platform/auth/session') return route.fulfill({ json: staff });
            if (pathname === '/api/platform/members') return route.fulfill({ json: { session: staff } });
            if (pathname === '/api/platform/admin/users') return route.fulfill({ json: { items: [managedUser] } });
            if (pathname === '/api/platform/organizations') return route.fulfill({ json: { items: [] } });
            if (pathname === '/api/platform/members/' + managedUser.id) return route.fulfill({ json: {
                member: members[0], ...(searchParams.get('entry') === '1' ? { session: staff } : {}),
            } });
            return route.fulfill({ status: 404, json: { error: { message: 'fixture endpoint unavailable' } } });
        });
        const page = await context.newPage();
        const checkManagement = async () => {
            await page.getByRole('row').filter({ hasText: managedUser.realName }).waitFor();
            assert.equal(await page.getByRole('combobox', { name: '查看身份' }).count(), 0);
            assert.equal(await page.getByRole('button', { name: '组织管理', exact: true }).count(), Number(role === 'owner'));
        };
        await page.goto(new URL('/members/', origin).href);
        await checkManagement();
        const managementReads = calls.filter(path => path === '/api/platform/admin/users').length;
        await page.goto(new URL('/members/?id=' + managedUser.id, origin).href);
        await page.getByRole('heading', { name: members[0].nickname, exact: true }).waitFor();
        assert.equal(await page.getByText(managedUser.realName, { exact: true }).count(), 0);
        assert.equal(await page.getByRole('button', { name: '组织管理', exact: true }).count(), 0);
        assert.equal(calls.filter(path => path === '/api/platform/admin/users').length, managementReads);
        await page.locator('[data-members-back]').click();
        await checkManagement();
        assert(!calls.includes('/api/platform/auth/session'));
        results.push({ role, passed: true, checks: ['session-based management', 'shared member profile', 'return to management'] });
        await context.close();
    }
    const context=await browser.newContext();
    await context.route('**/api/platform/**',route=>route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({error:{code:'AUTH_REQUIRED',message:'请先登录'}})}));
    const page=await context.newPage(); await page.goto(new URL('/members/?id=member',origin).href);
    await page.waitForURL(url=>url.pathname==='/login/'&&url.searchParams.get('next')==='/members/?id=member');
    results.push({guest:'redirects to login preserving selected profile',passed:true});
    await context.close();
    const setupContext=await browser.newContext();
    await setupContext.route('**/api/platform/members?**',route=>route.fulfill({json:{session:{...session,passwordChangeRequired:true}}}));
    const setup=await setupContext.newPage();
    await setup.goto(new URL('/members/',origin).href);
    await setup.waitForURL(url=>url.pathname==='/account/'&&url.searchParams.get('setup')==='1');
    results.push({setup:'directs accounts with outstanding setup to account settings',passed:true});
    await setupContext.close();
    await writeFile(`${output}/result.json`,JSON.stringify({passed:true,results},null,2));
    console.log(JSON.stringify({passed:true,contexts:results.length,output}));
} finally { await browser.close(); }
