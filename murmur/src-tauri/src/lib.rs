mod asr;
mod audio;
mod config;

use std::sync::mpsc::Sender as StdSender;
use std::sync::Mutex;
use std::thread::JoinHandle;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::watch;

/// 当前会话的控制句柄。
struct Session {
    audio_stop: StdSender<()>,
    audio_join: Option<JoinHandle<()>>,
    ws_stop: watch::Sender<bool>,
}

impl Session {
    fn shutdown(mut self) {
        let _ = self.ws_stop.send(true);
        let _ = self.audio_stop.send(()); // 解除采集线程 recv 阻塞
        if let Some(j) = self.audio_join.take() {
            let _ = j.join();
        }
    }
}

#[derive(Default)]
struct AppState {
    session: Mutex<Option<Session>>,
}

#[tauri::command]
fn list_devices() -> Vec<audio::DeviceInfo> {
    audio::list_devices()
}

#[tauri::command]
fn get_config(app: AppHandle) -> config::Config {
    config::load(&app)
}

#[tauri::command]
fn save_config(app: AppHandle, cfg: config::Config) -> Result<(), String> {
    config::save(&app, &cfg)
}

#[tauri::command]
fn start_session(
    app: AppHandle,
    state: State<'_, AppState>,
    device_id: Option<String>,
) -> Result<(), String> {
    let cfg = config::load(&app);
    if cfg.auth_token.trim().is_empty() {
        return Err("未配置 auth token,请先在设置中填写".to_string());
    }
    let device = device_id.unwrap_or(cfg.device_id.clone());

    let mut guard = state.session.lock().unwrap();
    // 已有会话先停掉
    if let Some(old) = guard.take() {
        old.shutdown();
    }

    let (pcm_tx, pcm_rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
    let (audio_stop_tx, audio_stop_rx) = std::sync::mpsc::channel::<()>();
    let (ws_stop_tx, ws_stop_rx) = watch::channel(false);

    // 采集线程(cpal Stream 非 Send,固定在独立线程上)
    let app_for_audio = app.clone();
    let dev = device.clone();
    let audio_join = std::thread::Builder::new()
        .name("murmur-audio".into())
        .spawn(move || {
            if let Err(e) = audio::run_capture(&dev, pcm_tx, audio_stop_rx) {
                log::error!("[audio] {e}");
                let _ = app_for_audio.emit("asr-status", format!("音频采集失败: {e}"));
            }
        })
        .map_err(|e| format!("启动采集线程失败: {e}"))?;

    // WS 会话任务
    tauri::async_runtime::spawn(asr::run_session(
        app.clone(),
        cfg.server_url.clone(),
        cfg.auth_token.clone(),
        pcm_rx,
        ws_stop_rx,
    ));

    *guard = Some(Session {
        audio_stop: audio_stop_tx,
        audio_join: Some(audio_join),
        ws_stop: ws_stop_tx,
    });
    Ok(())
}

#[tauri::command]
fn stop_session(state: State<'_, AppState>) {
    let session = state.session.lock().unwrap().take();
    if let Some(s) = session {
        s.shutdown();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            list_devices,
            get_config,
            save_config,
            start_session,
            stop_session
        ])
        .run(tauri::generate_context!())
        .expect("error while running murmur");
}
