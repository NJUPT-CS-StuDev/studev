"""Local-only synthetic account/activity acceptance and screenshot evidence.

Run with the task uv venv. All platform calls are intercepted; no production
account or write is used. Pass a running Astro dev URL, output dir and Chromium.
"""
import argparse
import json
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect


def run(base: str, output: Path, browser_path: str):
    assert urlparse(base).hostname in ("localhost", "127.0.0.1")
    output.mkdir(parents=True, exist_ok=True)
    user = dict(id="00000000-0000-0000-0000-000000000001", qq="100002", nickname="校园摄影社", realName="测试成员", studentId="TEST100002", profileComplete=True, identityVerified=False, email="100002@qq.com", emailVerified=False, role="member", status="active", revision=1, totpEnabled=False, mustChangePassword=False)
    activity = dict(id="00000000-0000-0000-0000-000000000002", title="周末校园摄影散步", startsAt="2026-10-31T06:00:00Z", endsAt="2026-10-31T08:00:00Z", description="沿着校园的小路，记录秋天的光影。\n请带上相机或手机，提前五分钟在教3门口集合。", place=dict(kind="campus", id="教3"), organiser=dict(id=user["id"], name=user["nickname"]), visibility="public", revision=1, createdAt="2026-10-30T01:00:00Z", updatedAt="2026-10-30T01:00:00Z")
    device = dict(id="00000000-0000-0000-0000-000000000003", deviceName="HUAWEI 测试手机", createdAt="2026-10-30T01:00:00Z", expiresAt=1796000000000)
    devices = [device]
    writes = []
    console_errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=browser_path, headless=True)
        context = browser.new_context(viewport={"width": 1365, "height": 1000}, locale="zh-CN", timezone_id="Asia/Shanghai", reduced_motion="reduce")
        context.add_init_script("localStorage.setItem('studev_auth_user', JSON.stringify({nickname:'校园摄影社',role:'member'}));")
        context.route("**/*", lambda route: route.continue_() if urlparse(route.request.url).hostname in ("127.0.0.1", "localhost") else route.abort())

        def mock(route):
            request = route.request
            path = urlparse(request.url).path.removeprefix("/api/platform")
            if request.method == "POST":
                assert request.headers.get("x-csrf-token") == "synthetic-csrf", path
                writes.append({"path": path, "body": request.post_data_json})
            if path == "/auth/session":
                body = dict(user=user, csrfToken="synthetic-csrf", mfaVerified=False, enrollmentRequired=False, passwordChangeRequired=False, mfaRequired=False, profileRequired=False)
            elif path == "/auth/devices":
                body = {"items": devices}
            elif path.endswith("/revoke"):
                devices.clear()
                body = {"ok": True}
            elif path in ("/activities", "/me/activities") and request.method == "GET":
                body = {"items": [activity], "next": None}
            elif path.startswith("/activities"):
                if request.method == "POST":
                    activity.update({k: v for k, v in request.post_data_json.items() if k != "revision"})
                    activity["revision"] += 1
                body = {"activity": activity}
            elif path == "/auth/config":
                body = {"registrationEnabled": True}
            else:
                body = {"items": []}
            route.fulfill(status=200, content_type="application/json", body=json.dumps(body, ensure_ascii=False))

        context.route("**/api/platform/**", mock)
        # Avatars are irrelevant to these synthetic account tests.
        context.route("**/*qlogo*", lambda route: route.abort())
        page = context.new_page()
        page.on("pageerror", lambda error: console_errors.append(str(error)))

        def shot(name):
            page.screenshot(path=str(output / f"{name}.png"), full_page=True)
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), name

        page.goto(base + "/activities/")
        expect(page.get_by_role("heading", name=activity["title"])).to_be_visible()
        shot("activities-desktop-light")
        page.get_by_role("button", name="发起活动").click()
        page.get_by_label("活动标题", exact=True).fill("秋日校园交流")
        page.get_by_label("开始时间", exact=True).fill("2026-11-01T14:00")
        page.get_by_label("结束时间", exact=True).fill("2026-11-01T16:00")
        page.get_by_label("搜索楼栋、教室或地点").fill("教3")
        page.get_by_label("活动介绍（选填）").fill("在熟悉的校园，认识新朋友。")
        shot("activity-create-desktop")
        page.get_by_role("button", name="保存活动", exact=True).click()
        expect(page.get_by_role("heading", name="秋日校园交流", exact=True)).to_be_visible()
        assert writes[-1]["path"] == "/activities"
        assert writes[-1]["body"]["place"] == {"kind": "campus", "id": "教3"}
        shot("activity-detail-desktop")
        page.get_by_role("button", name="编辑", exact=True).click()
        page.get_by_label("活动标题", exact=True).fill("周末校园摄影散步")
        page.get_by_role("button", name="保存活动", exact=True).click()
        expect(page.get_by_role("heading", name="周末校园摄影散步", exact=True)).to_be_visible()
        assert "revision" in writes[-1]["body"]
        page.set_viewport_size({"width": 390, "height": 844})
        shot("activity-detail-mobile-light")
        page.get_by_role("button", name="切换到深色模式").click()
        shot("activity-detail-mobile-dark")
        page.goto(base + "/activities/?new=1")
        expect(page.get_by_role("heading", name="发起一场活动")).to_be_visible()
        shot("activity-create-mobile-dark")
        page.goto(base + "/map/?activity=" + activity["id"])
        expect(page.get_by_role("region", name="活动详情")).to_be_visible(timeout=30000)
        expect(page.locator(".activity-map-marker")).to_have_count(1, timeout=30000)
        page.wait_for_timeout(1500)
        shot("activity-map-mobile-dark")
        page.get_by_role("button", name="去这里", exact=True).click()
        expect(page.get_by_role("radiogroup", name="出行方式")).to_be_visible()
        page.locator(".campus-map-from select").select_option("教1")
        expect(page.locator(".campus-map-routes button").first).to_be_visible(timeout=30000)
        shot("activity-map-route-mobile")
        page.set_viewport_size({"width": 1365, "height": 1000})
        page.get_by_role("button", name="切换到浅色模式").click()
        page.goto(base + "/map/?activity=" + activity["id"])
        expect(page.get_by_role("region", name="活动详情")).to_be_visible()
        page.wait_for_timeout(1500)
        shot("activity-map-desktop-light")
        page.goto(base + "/activities/?new=1")
        page.get_by_label("活动标题", exact=True).fill("集合点活动")
        page.get_by_label("开始时间", exact=True).fill("2026-11-01T14:00")
        page.get_by_label("结束时间", exact=True).fill("2026-11-01T16:00")
        page.get_by_role("radio", name="地图集合点").check()
        page.get_by_label("集合点名称", exact=True).fill("小路旁集合")
        page.get_by_role("link", name="在地图上选点").click()
        expect(page.get_by_role("heading", name="选择集合点")).to_be_visible()
        page.locator(".maplibregl-canvas").wait_for()
        page.wait_for_timeout(800)
        page.locator(".maplibregl-canvas").click(position={"x": 650, "y": 400})
        expect(page.get_by_label("活动标题", exact=True)).to_have_value("集合点活动")
        expect(page.get_by_label("集合点名称", exact=True)).to_have_value("小路旁集合")
        page.get_by_role("button", name="保存活动", exact=True).click()
        expect(page.get_by_role("heading", name="集合点活动", exact=True)).to_be_visible()
        assert writes[-1]["body"]["place"]["kind"] == "point"
        assert len(writes[-1]["body"]["place"]["position"]) == 2
        page.goto(base + "/map/?activity=" + activity["id"])
        expect(page.get_by_role("region", name="活动详情")).to_be_visible()
        page.get_by_role("button", name="去这里", exact=True).click()
        page.locator(".campus-map-from select").select_option("教1")
        expect(page.locator(".campus-map-routes button").first).to_be_visible(timeout=30000)
        page.wait_for_timeout(1500)
        shot("activity-point-route-desktop")
        page.goto(base + "/account/?tab=profile")
        expect(page.get_by_role("heading", name="已登录的设备")).to_be_visible()
        expect(page.get_by_role("heading", name=device["deviceName"])).to_be_visible()
        shot("account-devices-desktop")
        page.get_by_role("button", name="退出此设备").click()
        page.get_by_role("button", name="确认退出", exact=True).click()
        expect(page.get_by_text("目前没有已登录的 App 设备。", exact=True)).to_be_visible()
        assert writes[-1]["path"].endswith("/revoke")
        if console_errors:
            raise AssertionError(console_errors)
        (output / "result.json").write_text(json.dumps({"result": "passed", "synthetic": True, "writes": writes, "pageErrors": console_errors}, ensure_ascii=False, indent=2), encoding="utf-8")
        browser.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:4422")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--browser", required=True)
    args = parser.parse_args()
    run(args.base, args.output, args.browser)
