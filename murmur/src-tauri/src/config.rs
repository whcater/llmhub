//! 客户端配置持久化到 app config 目录的 config.json。

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    /// llmhub WS 基址,如 ws://127.0.0.1:8787 或 wss://your-host
    pub server_url: String,
    /// LLMHub Bearer token
    pub auth_token: String,
    /// 音频源 id("out|名称" / "in|名称"),空 = 默认 loopback
    pub device_id: String,
    /// 字幕模式滚动行数
    pub caption_lines: u32,
    /// 开始会话时把 16k/mono PCM 录成 WAV
    #[serde(default)]
    pub save_recording: bool,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            server_url: "ws://127.0.0.1:8787".to_string(),
            auth_token: String::new(),
            device_id: String::new(),
            caption_lines: 2,
            save_recording: false,
        }
    }
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("取配置目录失败: {e}"))?;
    Ok(dir.join("config.json"))
}

pub fn load(app: &AppHandle) -> Config {
    match config_path(app).and_then(|p| std::fs::read_to_string(p).map_err(|e| e.to_string())) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => Config::default(),
    }
}

pub fn save(app: &AppHandle, cfg: &Config) -> Result<(), String> {
    let path = config_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败: {e}"))?;
    }
    let s = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    std::fs::write(&path, s).map_err(|e| format!("写配置失败: {e}"))
}
