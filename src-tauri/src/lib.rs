use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

static IS_LOCKED: AtomicBool = AtomicBool::new(true);

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
async fn spawn_ticker_window(
    app_handle: tauri::AppHandle,
    symbol: String,
    ignore_mouse: bool,
    x: Option<f64>,
    y: Option<f64>,
) -> Result<(), String> {
    let window_label = format!("ticker_{}", symbol.replace(".", "_"));

    if let Some(window) = app_handle.get_webview_window(&window_label) {
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let url = format!("/ticker/{}", symbol);

    let mut window_builder =
        WebviewWindowBuilder::new(&app_handle, &window_label, WebviewUrl::App(url.into()))
            .title(format!("Ticker - {}", symbol))
            .inner_size(180.0, 60.0)
            .transparent(true)
            .decorations(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(true)
            .visible(false);

    if let (Some(px), Some(py)) = (x, y) {
        window_builder = window_builder.position(px, py);
    }

    let window = window_builder.build().map_err(|e| e.to_string())?;

    let window_clone = window.clone();
    window.on_window_event(move |event| {
        if matches!(
            event,
            tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_)
        ) {
            let _ = window_clone.emit("window-moved", ());
        }
    });

    // 현재 전역 락 상태 또는 인자에 따라 설정
    let should_ignore = IS_LOCKED.load(Ordering::SeqCst) || ignore_mouse;
    if should_ignore {
        window
            .set_ignore_cursor_events(true)
            .map_err(|e| e.to_string())?;
    }

    window.show().map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
async fn close_window(app_handle: tauri::AppHandle, label: String) -> Result<(), String> {
    if let Some(window) = app_handle.get_webview_window(&label) {
        window.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn reset_window_state(app_handle: tauri::AppHandle, label: String) -> Result<(), String> {
    use tauri::{LogicalSize, LogicalPosition, Manager};

    if let Some(window) = app_handle.get_webview_window(&label) {
        let _ = window.set_size(tauri::Size::Logical(LogicalSize { width: 180.0, height: 60.0 }));
        let _ = window.set_position(tauri::Position::Logical(LogicalPosition { x: 100.0, y: 100.0 }));
    }
    Ok(())
}

#[tauri::command]
async fn toggle_lock_from_frontend(
    app_handle: tauri::AppHandle,
    locked: bool,
) -> Result<(), String> {
    IS_LOCKED.store(locked, Ordering::SeqCst);

    // 모든 라벨이 ticker_로 시작하는 창에 대해 click-through 적용
    for (label, window) in app_handle.webview_windows() {
        if label.starts_with("ticker_") {
            let _ = window.set_ignore_cursor_events(locked);
        }
    }

    let _ = app_handle.emit("lock-toggled", locked);
    Ok(())
}

#[tauri::command]
async fn broadcast_border_toggle(app_handle: tauri::AppHandle, hide: bool) -> Result<(), String> {
    let _ = app_handle.emit("border-toggled", hide);
    Ok(())
}

#[tauri::command]
async fn broadcast_ticker_data(
    app_handle: tauri::AppHandle,
    symbol: String,
    data: serde_json::Value,
) -> Result<(), String> {
    let _ = app_handle.emit(&format!("kis-ticker-data-{}", symbol), data);
    Ok(())
}

#[tauri::command]
async fn broadcast_ticker_error(
    app_handle: tauri::AppHandle,
    symbol: String,
    message: String,
) -> Result<(), String> {
    let _ = app_handle.emit(&format!("kis-ticker-error-{}", symbol), message);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            let ctrl_shift_l = Shortcut::new(
                Some(
                    tauri_plugin_global_shortcut::Modifiers::CONTROL
                        | tauri_plugin_global_shortcut::Modifiers::SHIFT,
                ),
                tauri_plugin_global_shortcut::Code::KeyL,
            );

            app.global_shortcut()
                .on_shortcut(ctrl_shift_l, move |app, _shortcut, event| {
                    if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        let current_lock = IS_LOCKED.load(Ordering::SeqCst);
                        let new_lock = !current_lock;
                        IS_LOCKED.store(new_lock, Ordering::SeqCst);

                        // 모든 티커 창에 상태 변경 전파
                        for (label, window) in app.webview_windows() {
                            if label.starts_with("ticker_") {
                                let _ = window.set_ignore_cursor_events(new_lock);
                            }
                        }

                        // 프론트엔드에도 알림 (UI 업데이트용)
                        let _ = app.emit("lock-toggled", new_lock);
                    }
                })?;

            // 메인 창(컴트롤 패널) 종료 시 앱 전체 종료
            if let Some(main_window) = app.get_webview_window("main") {
                let app_handle = app.handle().clone();
                main_window.on_window_event(move |event| {
                    if let tauri::WindowEvent::Destroyed = event {
                        app_handle.exit(0);
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            spawn_ticker_window,
            close_window,
            reset_window_state,
            toggle_lock_from_frontend,
            broadcast_border_toggle,
            broadcast_ticker_data,
            broadcast_ticker_error
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
