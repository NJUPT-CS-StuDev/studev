import asyncio, os, json
from pathlib import Path
from playwright.async_api import async_playwright

BASE=os.environ.get('WEB_URL','http://127.0.0.1:4342')
OUT=Path(os.environ.get('WEB_SHOTS_DIR','D:/Temp/claude-wsl/agents/web-parity/shots'))

async def main():
    report=[]
    async with async_playwright() as p:
        browser=await p.chromium.launch(channel='chrome',headless=True)
        for device, viewport in [('desktop',{'width':1920,'height':1080}),('phone',{'width':412,'height':915})]:
            for theme in ['light','dark']:
                ctx=await browser.new_context(viewport=viewport,color_scheme=theme,service_workers='block',device_scale_factor=1)
                await ctx.add_init_script(f"localStorage.setItem('site-theme','{theme}')")
                page=await ctx.new_page()
                errors=[]
                page.on('pageerror',lambda error: errors.append(str(error)))
                page.on('console', lambda message: errors.append(message.text) if 'Map cannot fit' in message.text else None)
                await page.clock.set_fixed_time('2026-10-30T04:00:00Z')
                async def shot(name):
                    await page.wait_for_timeout(900)
                    await page.screenshot(path=str(OUT/f'{device}-{theme}-{name}.png'))
                await page.goto(BASE+'/map/',wait_until='networkidle')
                await page.locator('.campus-map-home').wait_for()
                await shot('map-home')
                await page.get_by_role('button',name='图书馆',exact=True).click()
                await shot('map-category-library')
                await page.get_by_role('button',name='返回热门推荐').click()
                search=page.get_by_role('textbox',name='搜索地点、楼栋或教室')
                await search.fill('tsg')
                await page.locator('.campus-map-results button').first.wait_for()
                titles=await page.locator('.campus-map-result-title').all_text_contents()
                assert '图书馆' in titles,titles
                await shot('search-tsg')
                await page.locator('.campus-map-results button').filter(has_text='图书馆').first.click()
                await page.get_by_role('heading',name='图书馆',exact=True).wait_for()
                assert await page.locator('.campus-map-hours').inner_text()
                await shot('place-library')
                await page.locator('.campus-map-hours summary').click()
                await shot('place-library-week')
                await page.goto(BASE+'/map/?place='+__import__('urllib.parse',fromlist=['quote']).quote('教3'),wait_until='networkidle')
                await page.get_by_role('heading',name='教3',exact=True).wait_for()
                assert await page.locator('.campus-map-hours').count()==0
                assert '开放时间待确认' not in await page.locator('.campus-map-card').inner_text()
                await page.get_by_role('button',name='路线',exact=True).click()
                await page.locator('.campus-map-from select').select_option(label='梅苑1栋')
                await page.locator('.campus-map-routes button').first.wait_for()
                routes=await page.locator('.campus-map-routes').inner_text()
                await shot('route-meiyuan1-jiao3-walk')
                await page.locator('.campus-map-directions summary').click()
                await shot('route-steps-walk')
                if await page.locator('.campus-map-routes button').count()>1:
                    await page.locator('.campus-map-routes button').nth(1).click()
                    await shot('route-alternative')
                await page.get_by_role('radio',name='骑行').click()
                await shot('route-meiyuan1-jiao3-bike')
                await page.goto(BASE+'/search/timetable/?class=B240402&week=5',wait_until='networkidle')
                await page.locator('.timetable-grid, .tt-grid, [data-course-id]').first.wait_for(timeout=10000) if await page.locator('.timetable-grid, .tt-grid, [data-course-id]').count() else await page.wait_for_timeout(1500)
                await shot('timetable')
                report.append({'device':device,'theme':theme,'search':titles,'walkRoutes':routes,'pageErrors':errors,'overflow':await page.evaluate('document.documentElement.scrollWidth>innerWidth')})
                assert not errors, errors
                print(device,theme,json.dumps(report[-1],ensure_ascii=False),flush=True)
                await ctx.close()
        await browser.close()
    (OUT/'map-proof.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')

asyncio.run(main())
