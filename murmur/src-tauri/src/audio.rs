//! 音频采集: cpal WASAPI。loopback(系统输出"你听到的声音")走 output 设备 +
//! build_input_stream;麦克风走 input 设备。统一下混成 mono、线性重采样到 16k int16、
//! 累积成 200ms 帧后通过 channel 推出。
//!
//! 参考 `recordIdentify/live_caption.py:AudioCapture`(decimate 版),这里改为
//! 线性重采样以保证采样率精确 16000(decimate 对 44100 等非整数倍会偏)。

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Device, SampleFormat};
use serde::Serialize;
use std::fs::File;
use std::io::{Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::mpsc::Receiver;
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc::UnboundedSender;

const TARGET_RATE: u32 = 16000;
const CHUNK_SAMPLES: usize = TARGET_RATE as usize / 5; // 200ms = 3200 samples

type SharedSink = Arc<Mutex<Option<WavSink>>>;

/// 16k/mono/16-bit WAV 写入器。先写占位头,流式追加 PCM,finalize 时回填长度。
struct WavSink {
    file: File,
    data_len: u32,
}

fn wav_header(data_len: u32) -> [u8; 44] {
    let sample_rate: u32 = TARGET_RATE;
    let channels: u16 = 1;
    let bits: u16 = 16;
    let byte_rate = sample_rate * channels as u32 * bits as u32 / 8;
    let block_align = channels * bits / 8;
    let mut h = [0u8; 44];
    h[0..4].copy_from_slice(b"RIFF");
    h[4..8].copy_from_slice(&(36 + data_len).to_le_bytes());
    h[8..12].copy_from_slice(b"WAVE");
    h[12..16].copy_from_slice(b"fmt ");
    h[16..20].copy_from_slice(&16u32.to_le_bytes());
    h[20..22].copy_from_slice(&1u16.to_le_bytes()); // PCM
    h[22..24].copy_from_slice(&channels.to_le_bytes());
    h[24..28].copy_from_slice(&sample_rate.to_le_bytes());
    h[28..32].copy_from_slice(&byte_rate.to_le_bytes());
    h[32..34].copy_from_slice(&block_align.to_le_bytes());
    h[34..36].copy_from_slice(&bits.to_le_bytes());
    h[36..40].copy_from_slice(b"data");
    h[40..44].copy_from_slice(&data_len.to_le_bytes());
    h
}

impl WavSink {
    fn create(path: &Path) -> std::io::Result<Self> {
        let mut file = File::create(path)?;
        file.write_all(&wav_header(0))?;
        Ok(Self { file, data_len: 0 })
    }

    fn write(&mut self, pcm: &[u8]) -> std::io::Result<()> {
        self.file.write_all(pcm)?;
        self.data_len = self.data_len.saturating_add(pcm.len() as u32);
        Ok(())
    }

    fn finalize(mut self) -> std::io::Result<()> {
        self.file.seek(SeekFrom::Start(4))?;
        self.file.write_all(&(36 + self.data_len).to_le_bytes())?;
        self.file.seek(SeekFrom::Start(40))?;
        self.file.write_all(&self.data_len.to_le_bytes())?;
        self.file.flush()
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    /// "out|<name>" (loopback) 或 "in|<name>" (麦克风),start_capture 用它定位设备
    pub id: String,
    pub name: String,
    pub is_loopback: bool,
    pub is_default: bool,
}

/// 枚举所有可用音频源:output 设备(loopback)在前,麦克风在后。
pub fn list_devices() -> Vec<DeviceInfo> {
    let host = cpal::default_host();
    let mut out = Vec::new();

    let default_out_name = host
        .default_output_device()
        .and_then(|d| d.name().ok());

    if let Ok(devices) = host.output_devices() {
        for d in devices {
            if let Ok(name) = d.name() {
                let is_default = default_out_name.as_deref() == Some(name.as_str());
                out.push(DeviceInfo {
                    id: format!("out|{name}"),
                    name,
                    is_loopback: true,
                    is_default,
                });
            }
        }
    }

    if let Ok(devices) = host.input_devices() {
        for d in devices {
            if let Ok(name) = d.name() {
                out.push(DeviceInfo {
                    id: format!("in|{name}"),
                    name,
                    is_loopback: false,
                    is_default: false,
                });
            }
        }
    }

    out
}

/// 按 id 定位设备 + 取其默认格式。返回 (device, is_loopback)。
/// id 为空 / "default" → 系统默认 loopback(默认输出设备)。
fn resolve_device(id: &str) -> Result<(Device, bool), String> {
    let host = cpal::default_host();

    if id.is_empty() || id == "default" {
        let dev = host
            .default_output_device()
            .ok_or_else(|| "没有默认输出设备(loopback)".to_string())?;
        return Ok((dev, true));
    }

    let (kind, name) = id
        .split_once('|')
        .ok_or_else(|| format!("非法设备 id: {id}"))?;
    let is_loopback = kind == "out";

    let devices = if is_loopback {
        host.output_devices()
    } else {
        host.input_devices()
    }
    .map_err(|e| format!("枚举设备失败: {e}"))?;

    for d in devices {
        if d.name().ok().as_deref() == Some(name) {
            return Ok((d, is_loopback));
        }
    }
    Err(format!("未找到设备: {name}"))
}

/// 流式线性重采样器(任意 src_rate → 16000),跨 callback 保持相位连续。
struct LinearResampler {
    inv: f64,  // src_rate / 16000,即每个输出样本前进多少个输入样本
    frac: f64, // 下一个输出样本相对 prev 的偏移(输入样本单位),[0,1)
    prev: f32,
    has_prev: bool,
}

impl LinearResampler {
    fn new(src_rate: u32) -> Self {
        Self {
            inv: src_rate as f64 / TARGET_RATE as f64,
            frac: 0.0,
            prev: 0.0,
            has_prev: false,
        }
    }

    /// 输入 mono f32([-1,1]),输出 16k int16,追加到 out。
    fn process(&mut self, input: &[f32], out: &mut Vec<i16>) {
        for &s in input {
            if !self.has_prev {
                self.prev = s;
                self.has_prev = true;
                continue;
            }
            while self.frac < 1.0 {
                let v = self.prev + (s - self.prev) * self.frac as f32;
                out.push((v.clamp(-1.0, 1.0) * 32767.0) as i16);
                self.frac += self.inv;
            }
            self.frac -= 1.0;
            self.prev = s;
        }
    }
}

/// 把交错多声道 f32 下混成 mono,追加到 mono_buf。
fn downmix(interleaved: &[f32], channels: usize, mono_buf: &mut Vec<f32>) {
    if channels <= 1 {
        mono_buf.extend_from_slice(interleaved);
        return;
    }
    for frame in interleaved.chunks_exact(channels) {
        let sum: f32 = frame.iter().sum();
        mono_buf.push(sum / channels as f32);
    }
}

/// 下混 + 重采样 + 200ms 切帧发送。每种采样格式各持有一个实例(避免闭包多次 move)。
struct Proc {
    resampler: LinearResampler,
    channels: usize,
    mono: Vec<f32>,
    acc: Vec<i16>,
    tx: UnboundedSender<Vec<u8>>,
    sink: Option<SharedSink>,
}

impl Proc {
    fn new(
        src_rate: u32,
        channels: usize,
        tx: UnboundedSender<Vec<u8>>,
        sink: Option<SharedSink>,
    ) -> Self {
        Self {
            resampler: LinearResampler::new(src_rate),
            channels,
            mono: Vec::new(),
            acc: Vec::new(),
            tx,
            sink,
        }
    }

    fn feed(&mut self, samples: &[f32]) {
        self.mono.clear();
        downmix(samples, self.channels, &mut self.mono);
        self.resampler.process(&self.mono, &mut self.acc);
        while self.acc.len() >= CHUNK_SAMPLES {
            let frame: Vec<i16> = self.acc.drain(..CHUNK_SAMPLES).collect();
            let mut bytes = Vec::with_capacity(frame.len() * 2);
            for v in frame {
                bytes.extend_from_slice(&v.to_le_bytes());
            }
            // 录音(若开启):与 WS 上行独立,断线期间也照常落盘
            if let Some(sink) = &self.sink {
                if let Ok(mut g) = sink.lock() {
                    if let Some(w) = g.as_mut() {
                        let _ = w.write(&bytes);
                    }
                }
            }
            // 接收端断开则忽略(会话已停)
            let _ = self.tx.send(bytes);
        }
    }
}

/// 在调用线程上(应为独立 std::thread)阻塞跑采集,直到 stop_rx 收到信号。
/// 每凑满 200ms 通过 pcm_tx 推一帧 LE int16 字节。
/// record_path 非空时,同一份 16k/mono PCM 落盘成 WAV;返回最终保存路径。
pub fn run_capture(
    device_id: &str,
    pcm_tx: UnboundedSender<Vec<u8>>,
    stop_rx: Receiver<()>,
    record_path: Option<PathBuf>,
) -> Result<Option<PathBuf>, String> {
    let (device, is_loopback) = resolve_device(device_id)?;

    // loopback 用 output 设备的默认格式;麦克风用 input 默认格式。两者都用 build_input_stream。
    let supported = if is_loopback {
        device.default_output_config()
    } else {
        device.default_input_config()
    }
    .map_err(|e| format!("取默认音频格式失败: {e}"))?;

    let sample_format = supported.sample_format();
    let src_rate = supported.sample_rate().0;
    let channels = supported.channels() as usize;
    let config: cpal::StreamConfig = supported.into();

    log::info!(
        "[audio] dev={device_id} loopback={is_loopback} rate={src_rate} ch={channels} fmt={sample_format:?}"
    );

    let sink: Option<SharedSink> = match record_path {
        Some(ref p) => {
            let s = WavSink::create(p).map_err(|e| format!("创建录音文件失败: {e}"))?;
            Some(Arc::new(Mutex::new(Some(s))))
        }
        None => None,
    };

    let stream = match sample_format {
        SampleFormat::F32 => {
            let mut p = Proc::new(src_rate, channels, pcm_tx.clone(), sink.clone());
            device.build_input_stream(
                &config,
                move |data: &[f32], _| p.feed(data),
                |e| log::error!("[audio] stream error: {e}"),
                None,
            )
        }
        SampleFormat::I16 => {
            let mut p = Proc::new(src_rate, channels, pcm_tx.clone(), sink.clone());
            device.build_input_stream(
                &config,
                move |data: &[i16], _| {
                    let f: Vec<f32> = data.iter().map(|&s| s as f32 / 32768.0).collect();
                    p.feed(&f);
                },
                |e| log::error!("[audio] stream error: {e}"),
                None,
            )
        }
        SampleFormat::U16 => {
            let mut p = Proc::new(src_rate, channels, pcm_tx.clone(), sink.clone());
            device.build_input_stream(
                &config,
                move |data: &[u16], _| {
                    let f: Vec<f32> =
                        data.iter().map(|&s| (s as f32 - 32768.0) / 32768.0).collect();
                    p.feed(&f);
                },
                |e| log::error!("[audio] stream error: {e}"),
                None,
            )
        }
        other => return Err(format!("不支持的采样格式: {other:?}")),
    }
    .map_err(|e| format!("打开音频流失败: {e}"))?;

    stream.play().map_err(|e| format!("启动音频流失败: {e}"))?;

    // 阻塞直到收到停止信号(发送端 drop 也会解除阻塞)
    let _ = stop_rx.recv();
    drop(stream); // 确保 callback 不再触发,sink 可独占回填头

    if let Some(arc) = sink {
        if let Some(w) = arc.lock().unwrap().take() {
            w.finalize().map_err(|e| format!("保存录音失败: {e}"))?;
            return Ok(record_path);
        }
    }
    Ok(None)
}
