"""Capture every static page in both themes and compare page structure.

Requires Playwright and Chrome in a task venv. Point --build-dir at a baseline
build when recording before; capture after against the same route list. Output
belongs in the task's screenshot directory, outside the repository.

Example:
  python src/integrations/pages.browser.py --phase after --shots <directory>
"""
import argparse
import asyncio
import json
import os
from pathlib import Path

from playwright.async_api import async_playwright

REPOSITORY = Path(__file__).resolve().parents[2]
EXCLUDED = {"/login/", "/account/", "/admin/", "/submissions/"}
VIEWPORTS = {"desktop": {"width": 1920, "height": 1080}, "phone": {"width": 412, "height": 915}}


def static_routes(build):
    routes = []
    for html in build.rglob("*.html"):
        relative = html.relative_to(build)
        route = "/" + (relative.parent.as_posix().strip("./") + "/" if html.name == "index.html" else relative.as_posix())
        route = "/" if route == "//" else route
        if route not in EXCLUDED:
            routes.append(route)
    if not routes:
        raise RuntimeError(f"No HTML pages in {build}; build the site first")
    return sorted(routes)


async def capture(options):
    folder = options.shots / f"all-routes-{options.phase}"
    folder.mkdir(parents=True, exist_ok=True)
    routes = static_routes(options.build_dir)
    results = []
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(channel=options.channel, headless=True)

        async def capture_context(device, viewport, theme):
            context = await browser.new_context(viewport=viewport, color_scheme=theme, device_scale_factor=1,
                                                reduced_motion="reduce", service_workers="block")
            await context.add_init_script(f"localStorage.setItem('site-theme','{theme}')")
            page = await context.new_page()
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            for route in routes:
                errors.clear()
                name = (route.strip("/").replace("/", "--") or "home").replace(".html", "")
                response = await page.goto(options.web_url.rstrip("/") + route, wait_until="networkidle", timeout=45000)
                # Load images below the fold before the complete page screenshot.
                await page.evaluate("""async () => {
                    const height = document.documentElement.scrollHeight;
                    for (let y = 0; y < height; y += 700) {
                        scrollTo(0, y); await new Promise(resolve => setTimeout(resolve, 35));
                    }
                    scrollTo(0, 0);
                }""")
                await page.wait_for_timeout(150)
                if route == "/":
                    await page.evaluate("document.querySelector('#typewriter-text').textContent='未来的空白，由你来书写。'")
                if route == "/map/":
                    await page.wait_for_selector(".campus-map-canvas canvas", timeout=30000)
                await page.screenshot(path=str(folder / f"{device}-{theme}-{name}.png"), full_page=True, animations="disabled")
                metrics = await page.evaluate("""() => ({
                    title: document.title, path: location.pathname, width: innerWidth,
                    scroll: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight,
                    headings: [...document.querySelectorAll('h1,h2')].map(element => element.textContent),
                    background: getComputedStyle(document.documentElement).backgroundColor,
                    color: getComputedStyle(document.documentElement).color
                })""")
                results.append({"device": device, "theme": theme, "route": route,
                                "status": response.status if response else None, "metrics": metrics, "errors": list(errors)})
                print(options.phase, device, theme, route, flush=True)
            await context.close()

        await asyncio.gather(*[capture_context(device, viewport, theme)
                               for device, viewport in VIEWPORTS.items() for theme in ["light", "dark"]])
        await browser.close()
    evidence = {"source_ref": options.source_ref, "phase": options.phase, "base": options.web_url,
                "excluded": sorted(EXCLUDED), "routes": routes, "results": results}
    (folder / "evidence.json").write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf8")
    failures = [result for result in results if result["errors"] or result["metrics"]["scroll"] > result["metrics"]["width"]
                or result["status"] != (404 if result["route"] == "/404.html" else 200)]
    print(json.dumps({"screenshots": len(results), "routes": len(routes), "failures": failures}, ensure_ascii=False, indent=2))
    return failures


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--phase", choices=["before", "after"], required=True)
    parser.add_argument("--web-url", default=os.environ.get("WEB_URL", "http://127.0.0.1:4342"))
    parser.add_argument("--shots", type=Path, default=os.environ.get("STUDEV_SHOTS"), required=not os.environ.get("STUDEV_SHOTS"))
    parser.add_argument("--build-dir", type=Path, default=REPOSITORY / "dist")
    parser.add_argument("--source-ref", default="working tree")
    parser.add_argument("--channel", default="chrome")
    raise SystemExit(1 if asyncio.run(capture(parser.parse_args())) else 0)
