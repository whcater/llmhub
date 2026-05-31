import { getCurrentWindow, Window } from "@tauri-apps/api/window";
import {
  api,
  onPartial,
  onSentence,
  onStatus,
  type Config,
  type DeviceInfo,
} from "./ipc";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const btnToggle = $<HTMLButtonElement>("btn-toggle");
const btnCaption = $<HTMLButtonElement>("btn-caption");
const btnRefresh = $<HTMLButtonElement>("btn-refresh");
const btnCopy = $<HTMLButtonElement>("btn-copy");
const btnClear = $<HTMLButtonElement>("btn-clear");
const btnSettings = $<HTMLButtonElement>("btn-settings");
const btnSave = $<HTMLButtonElement>("btn-save");
const deviceSel = $<HTMLSelectElement>("device");
const serverInput = $<HTMLInputElement>("server-url");
const tokenInput = $<HTMLInputElement>("auth-token");
const statusEl = $<HTMLSpanElement>("status");
const settingsEl = $<HTMLDivElement>("settings");
const transcriptEl = $<HTMLDivElement>("transcript");

let cfg: Config;
let running = false;
let sessionStart = 0;
const sentences: { ts: string; text: string }[] = [];
let partial = "";

function fmtElapsed(): string {
  const s = Math.floor((Date.now() - sessionStart) / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function render() {
  const frag = document.createDocumentFragment();
  for (const { ts, text } of sentences) {
    const div = document.createElement("div");
    div.className = "line";
    div.innerHTML = `<span class="ts">[${ts}]</span>`;
    div.append(document.createTextNode(text));
    frag.append(div);
  }
  if (partial) {
    const div = document.createElement("div");
    div.className = "line";
    div.innerHTML = `<span class="ts">[··]</span><span id="partial"></span>`;
    div.querySelector("#partial")!.textContent = partial;
    frag.append(div);
  }
  transcriptEl.replaceChildren(frag);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

function deviceLabel(d: DeviceInfo): string {
  const tag = d.isDefault ? "[默认输出]" : d.isLoopback ? "[输出]" : "[麦克风]";
  return `${tag} ${d.name}`;
}

async function loadDevices() {
  const devs = await api.listDevices();
  deviceSel.replaceChildren();
  for (const d of devs) {
    const opt = document.createElement("option");
    opt.value = d.id;
    opt.textContent = deviceLabel(d);
    deviceSel.append(opt);
  }
  if (cfg.deviceId) deviceSel.value = cfg.deviceId;
}

async function start() {
  try {
    await api.startSession(deviceSel.value || null);
    running = true;
    sessionStart = Date.now();
    btnToggle.textContent = "停止";
    statusEl.textContent = "连接中...";
  } catch (e) {
    statusEl.textContent = String(e);
  }
}

async function stop() {
  await api.stopSession();
  running = false;
  btnToggle.textContent = "开始";
  statusEl.textContent = "已停止";
}

async function showCaption() {
  const cap = await Window.getByLabel("caption");
  await cap?.show();
  await cap?.setFocus();
  await getCurrentWindow().hide();
}

btnToggle.addEventListener("click", () => (running ? stop() : start()));
btnCaption.addEventListener("click", showCaption);
btnRefresh.addEventListener("click", loadDevices);
btnClear.addEventListener("click", () => {
  sentences.length = 0;
  partial = "";
  render();
});
btnCopy.addEventListener("click", async () => {
  const text = sentences.map((s) => `[${s.ts}] ${s.text}`).join("\n");
  await navigator.clipboard.writeText(text);
  statusEl.textContent = `已复制 ${sentences.length} 句`;
});
btnSettings.addEventListener("click", () => settingsEl.classList.toggle("open"));
btnSave.addEventListener("click", async () => {
  cfg.serverUrl = serverInput.value.trim();
  cfg.authToken = tokenInput.value;
  cfg.deviceId = deviceSel.value;
  await api.saveConfig(cfg);
  settingsEl.classList.remove("open");
  statusEl.textContent = "设置已保存";
});
deviceSel.addEventListener("change", async () => {
  cfg.deviceId = deviceSel.value;
  await api.saveConfig(cfg);
});

async function init() {
  cfg = await api.getConfig();
  serverInput.value = cfg.serverUrl;
  tokenInput.value = cfg.authToken;
  await loadDevices();

  await onPartial((t) => {
    partial = t;
    render();
  });
  await onSentence((t) => {
    if (!t.trim()) return;
    sentences.push({ ts: fmtElapsed(), text: t });
    partial = "";
    render();
  });
  await onStatus((t) => {
    statusEl.textContent = t;
  });

  if (!cfg.authToken) settingsEl.classList.add("open");
}

init();
