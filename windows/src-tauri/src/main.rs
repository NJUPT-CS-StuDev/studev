//! StuDev on Windows: the site, studev.hicancan.top, in a window of its own, the same pages and the same account as in a
//! browser, so nothing is built twice. What a desktop adds is here: one window however often it is opened, the size and
//! place it was left at, a tray icon to come back by, links to other sites opened in the browser, and closing to the tray.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder, WindowEvent};

const SITE: &str = "https://studev.hicancan.top";
/** The entries the tray opens straight to. */
const ENTRIES: [(&str, &str, &str); 4] = [("timetable", "课表", "/"), ("map", "地图", "/map/"), ("search", "搜索", "/search/"), ("ai", "AI", "/ai/")];

fn show(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn open(app: &AppHandle, path: &str) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.navigate(Url::parse(&format!("{SITE}{path}")).expect("an entry is a path of the site"));
    }
    show(app);
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| show(app)))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let site = Url::parse(SITE).expect("the site is a URL");
            let handle = app.handle().clone();
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(site.clone()))
                .title("StuDev")
                .inner_size(1180.0, 800.0)
                .min_inner_size(400.0, 560.0)
                // Other sites are not this app: they open in the browser.
                .on_navigation(move |url| {
                    if url.host_str() == site.host_str() || url.scheme() == "about" { return true; }
                    let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);
                    false
                })
                .on_page_load(|window, payload| {
                    if matches!(payload.event(), PageLoadEvent::Finished) { let _ = window.show(); }
                })
                .visible(false)
                .build()?;

            let mut items: Vec<MenuItem<_>> = Vec::new();
            for (id, label, _) in ENTRIES { items.push(MenuItem::with_id(app, id, label, true, None::<&str>)?); }
            let quit = MenuItem::with_id(app, "quit", "退出 StuDev", true, None::<&str>)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let mut all: Vec<&dyn tauri::menu::IsMenuItem<_>> = items.iter().map(|item| item as &dyn tauri::menu::IsMenuItem<_>).collect();
            all.push(&separator);
            all.push(&quit);
            let menu = Menu::with_items(app, &all)?;
            TrayIconBuilder::with_id("studev")
                .icon(app.default_window_icon().cloned().expect("the bundle has an icon"))
                .tooltip("StuDev")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| match event.id().as_ref() {
                    "quit" => app.exit(0),
                    id => if let Some((_, _, path)) = ENTRIES.iter().find(|(entry, _, _)| *entry == id) { open(app, path) },
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event { show(tray.app_handle()); }
                })
                .build(app)?;
            let _ = handle;
            Ok(())
        })
        // Closing the window keeps StuDev in the tray; 退出 in the tray ends it.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("StuDev starts");
}
