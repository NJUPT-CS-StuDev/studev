"""Production-browser PWA acceptance. Install Playwright in the task venv first.

WEB_URL selects an Astro production preview bound to 127.0.0.1.
WEB_SHOTS_DIR and WEB_PWA_TEMP select artifacts and disposable Chrome profiles.
"""
import json, pathlib, os, time
from playwright.sync_api import sync_playwright

base=os.environ.get('WEB_URL','http://127.0.0.1:4342')
root=pathlib.Path(os.environ.get('WEB_PWA_TEMP','D:/Temp/codex/web-parity'))
shots=pathlib.Path(os.environ.get('WEB_SHOTS_DIR','D:/Temp/claude-wsl/agents/web-parity/shots')); shots.mkdir(parents=True, exist_ok=True)
run=str(time.time_ns())
proof=[]
with sync_playwright() as p:
    for device,viewport in [('desktop',{'width':1920,'height':1080}),('phone',{'width':412,'height':915})]:
        for theme in ['light','dark']:
            profile=root/f'pwa-profile-{run}-{device}-{theme}'
            context=p.chromium.launch_persistent_context(str(profile),channel='chrome',headless=True,viewport=viewport,color_scheme=theme,device_scale_factor=1)
            context.add_init_script(f"localStorage.setItem('site-theme','{theme}')")
            page=context.new_page()
            errors=[]
            page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto(base+'/map/',wait_until='networkidle')
            current=page.evaluate("fetch('/pwa-release.json').then(r=>r.json())")
            version=current['version']
            page.wait_for_function("navigator.serviceWorker.controller !== null",timeout=120000)
            page.wait_for_function("async v=>Boolean(await(await caches.open('studev-data-'+v)).match('/__studev_offline_ready__'))",arg=version,timeout=120000)
            page.get_by_role('link',name='下载 App',exact=True).click()
            page.wait_for_function("document.querySelector('[data-pwa-status]').textContent.includes('已保存')")
            page.wait_for_function("document.querySelector('[data-pwa-size]').textContent.includes('MB')")
            page.screenshot(path=str(shots/f'{device}-{theme}-pwa-install.png'))
            size=page.locator('[data-pwa-size]').inner_text()
            manifest=page.evaluate("fetch('/manifest.webmanifest').then(r=>r.json())")
            session=context.new_cdp_session(page)
            installability=session.send('Page.getInstallabilityErrors')
            # An extra attached CDP session interferes with Chrome's network
            # emulation; release it before Playwright switches the context offline.
            session.detach()
            assert not installability['installabilityErrors'], installability
            print('installability passed',device,theme,flush=True)
            page.get_by_role('button',name='关闭',exact=True).click()
            context.set_offline(True)
            page.reload(wait_until='networkidle')
            page.wait_for_selector('.campus-map-home',timeout=30000)
            page.get_by_role('link',name='下载 App',exact=True).click()
            page.wait_for_function("document.querySelector('[data-pwa-status]').textContent.includes('可以使用已保存')",timeout=30000)
            page.screenshot(path=str(shots/f'{device}-{theme}-pwa-offline-reload.png'))
            offline=page.locator('[data-pwa-status]').inner_text()
            page.get_by_role('button',name='关闭',exact=True).click()
            page.locator('.campus-map-search input').fill('tsg')
            page.wait_for_function("[...document.querySelectorAll('.campus-map-result-title')].some(e=>e.textContent.includes('图书馆'))",timeout=30000)
            results=page.locator('.campus-map-result-title').all_text_contents()
            page.screenshot(path=str(shots/f'{device}-{theme}-pwa-offline-tsg.png'))
            archive=page.evaluate("base=>fetch(base+'/space/%E4%BB%99%E6%9E%97/basemap.pmtiles',{headers:{Range:'bytes=0-15'}}).then(async r=>({status:r.status,range:r.headers.get('Content-Range'),bytes:(await r.arrayBuffer()).byteLength}))",current['base'])
            assert archive['status']==206 and archive['bytes']==16, archive
            context.set_offline(False)
            full_data=False
            if device=='desktop' and theme=='light':
                page.get_by_role('link',name='下载 App',exact=True).click()
                page.get_by_role('button',name='保存完整离线数据',exact=True).click()
                deadline=time.monotonic()+120
                while not page.evaluate("async v=>{const marker=await(await caches.open('studev-data-'+v)).match('/__studev_offline_ready__');return marker?(await marker.json()).all:false}",version):
                    assert time.monotonic()<deadline, page.locator('[data-pwa-status]').inner_text()
                    page.wait_for_timeout(200)
                page.get_by_role('button',name='关闭',exact=True).click()
                context.set_offline(True)
                page.goto(base+'/search/timetable/?class=B240402&week=5',wait_until='networkidle')
                page.wait_for_selector('.timetable-course',timeout=30000)
                full_data=True
                page.screenshot(path=str(shots/'desktop-light-pwa-offline-timetable.png'))
                context.set_offline(False)
                page.goto(base+'/map/',wait_until='networkidle')
            updated={**current,'version':'acceptance-new-version'}
            context.route('**/pwa-release.json',lambda route:route.fulfill(status=200,content_type='application/json',body=json.dumps(updated)))
            page.evaluate("fetch('/pwa-release.json',{cache:'no-cache'}).then(r=>r.json())")
            page.wait_for_selector('[data-pwa-update]:not([hidden])',timeout=30000)
            page.screenshot(path=str(shots/f'{device}-{theme}-pwa-update.png'))
            assert not errors, errors
            row={'device':device,'theme':theme,'manifest':manifest,'offlineStatus':offline,'downloadSize':size,'range':archive,'offlineSearch':results,'fullDataTimetable':full_data,'updatePrompt':page.locator('[data-pwa-update]').is_visible(),'pageErrors':errors,'cached':page.evaluate('caches.keys()'),'installability':installability}
            proof.append(row)
            print(json.dumps(row,ensure_ascii=False),flush=True)
            context.close()
pathlib.Path(shots/'pwa-proof.json').write_text(json.dumps(proof,ensure_ascii=False,indent=2),encoding='utf-8')
