//! 实时 ASR WS 客户端: 连 `wss://<llmhub>/asr/stream?token=<auth>`,发 StartTranscription
//! 控制帧(appkey 留空,由 llmhub worker 注入),推 PCM 二进制帧,解析识别结果 emit 给前端。
//! 指数退避重连。参考 `recordIdentify/live_caption.py:NlsStreamingClient`。

use futures_util::{SinkExt, StreamExt};
use serde_json::json;
use std::time::Instant;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc::UnboundedReceiver;
use tokio::sync::watch;
use tokio::time::{sleep, Duration};
use tokio_tungstenite::tungstenite::Message;

const MAX_RECONNECT: u32 = 6;
const BACKOFF_MAX_SECS: u64 = 15;

enum Outcome {
    /// 用户主动停止
    Stopped,
    /// 连接断开,应重连
    Lost,
}

/// 事件: asr-partial(中间结果) / asr-sentence(整句) / asr-status(状态文本)
fn emit(app: &AppHandle, event: &str, text: &str) {
    let _ = app.emit(event, text.to_string());
}

fn build_url(server_url: &str, token: &str) -> String {
    let base = server_url.trim_end_matches('/');
    format!("{base}/asr/stream?token={token}")
}

/// 会话主循环: 连接 → 跑 → 断了按退避重连,直到用户停止或重连耗尽。
pub async fn run_session(
    app: AppHandle,
    server_url: String,
    token: String,
    mut pcm_rx: UnboundedReceiver<Vec<u8>>,
    mut stop_rx: watch::Receiver<bool>,
) {
    let url = build_url(&server_url, &token);
    let mut attempt: u32 = 0;

    loop {
        if *stop_rx.borrow() {
            return;
        }
        // 丢弃重连/退避期间积压的旧音频
        while pcm_rx.try_recv().is_ok() {}

        let started_at = Instant::now();
        let outcome = connect_and_run(&app, &url, &mut pcm_rx, &mut stop_rx).await;

        match outcome {
            Outcome::Stopped => {
                emit(&app, "asr-status", "已停止");
                return;
            }
            Outcome::Lost => {
                if *stop_rx.borrow() {
                    return;
                }
                // 连接维持过 3s 视为有效连接,重连计数清零
                if started_at.elapsed().as_secs() >= 3 {
                    attempt = 0;
                }
                attempt += 1;
                if attempt > MAX_RECONNECT {
                    emit(&app, "asr-status", "多次重连失败,请重新开始");
                    return;
                }
                let wait = BACKOFF_MAX_SECS.min(1u64 << attempt);
                emit(
                    &app,
                    "asr-status",
                    &format!("连接断开,{wait}s 后第 {attempt}/{MAX_RECONNECT} 次重连"),
                );
                tokio::select! {
                    _ = sleep(Duration::from_secs(wait)) => {}
                    _ = stop_rx.changed() => {
                        if *stop_rx.borrow() { return; }
                    }
                }
            }
        }
    }
}

/// 单次连接的生命周期。
async fn connect_and_run(
    app: &AppHandle,
    url: &str,
    pcm_rx: &mut UnboundedReceiver<Vec<u8>>,
    stop_rx: &mut watch::Receiver<bool>,
) -> Outcome {
    emit(app, "asr-status", "连接中...");

    let ws = match tokio_tungstenite::connect_async(url).await {
        Ok((ws, _resp)) => ws,
        Err(e) => {
            emit(app, "asr-status", &format!("连接失败: {e}"));
            return Outcome::Lost;
        }
    };

    let (mut write, mut read) = ws.split();

    // StartTranscription(appkey 由 worker 注入)
    let task_id = uuid::Uuid::new_v4().simple().to_string();
    let start_frame = json!({
        "header": {
            "namespace": "SpeechTranscriber",
            "name": "StartTranscription",
            "message_id": uuid::Uuid::new_v4().simple().to_string(),
            "task_id": task_id,
            "appkey": ""
        },
        "payload": {
            "format": "pcm",
            "sample_rate": 16000,
            "enable_intermediate_result": true,
            "enable_punctuation_prediction": true,
            "enable_inverse_text_normalization": true
        }
    });
    if write
        .send(Message::Text(start_frame.to_string()))
        .await
        .is_err()
    {
        return Outcome::Lost;
    }

    loop {
        tokio::select! {
            // 用户停止: 发 StopTranscription 后关闭
            _ = stop_rx.changed() => {
                if *stop_rx.borrow() {
                    let stop_frame = json!({
                        "header": {
                            "namespace": "SpeechTranscriber",
                            "name": "StopTranscription",
                            "message_id": uuid::Uuid::new_v4().simple().to_string(),
                            "task_id": task_id,
                            "appkey": ""
                        }
                    });
                    let _ = write.send(Message::Text(stop_frame.to_string())).await;
                    let _ = write.send(Message::Close(None)).await;
                    return Outcome::Stopped;
                }
            }
            // 上行音频
            maybe_pcm = pcm_rx.recv() => {
                if let Some(pcm) = maybe_pcm {
                    if write.send(Message::Binary(pcm)).await.is_err() {
                        return Outcome::Lost;
                    }
                }
            }
            // 下行识别结果
            maybe_msg = read.next() => {
                match maybe_msg {
                    Some(Ok(Message::Text(txt))) => handle_text(app, &txt),
                    Some(Ok(Message::Binary(_))) | Some(Ok(Message::Ping(_)))
                    | Some(Ok(Message::Pong(_))) | Some(Ok(Message::Frame(_))) => {}
                    Some(Ok(Message::Close(_))) | None => return Outcome::Lost,
                    Some(Err(_)) => return Outcome::Lost,
                }
            }
        }
    }
}

fn handle_text(app: &AppHandle, txt: &str) {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(txt) else {
        return;
    };
    let name = v
        .get("header")
        .and_then(|h| h.get("name"))
        .and_then(|n| n.as_str())
        .unwrap_or("");
    let result = v
        .get("payload")
        .and_then(|p| p.get("result"))
        .and_then(|r| r.as_str())
        .unwrap_or("");

    match name {
        "TranscriptionStarted" => emit(app, "asr-status", "识别中"),
        "TranscriptionResultChanged" => emit(app, "asr-partial", result),
        "SentenceEnd" => emit(app, "asr-sentence", result),
        "TaskFailed" => {
            let status = v
                .get("header")
                .and_then(|h| h.get("status_text"))
                .and_then(|s| s.as_str())
                .unwrap_or("unknown");
            emit(app, "asr-status", &format!("识别失败: {status}"));
        }
        _ => {}
    }
}
