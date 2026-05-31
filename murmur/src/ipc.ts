import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface DeviceInfo {
  id: string;
  name: string;
  isLoopback: boolean;
  isDefault: boolean;
}

export interface Config {
  serverUrl: string;
  authToken: string;
  deviceId: string;
  captionLines: number;
}

export const api = {
  listDevices: () => invoke<DeviceInfo[]>("list_devices"),
  getConfig: () => invoke<Config>("get_config"),
  saveConfig: (cfg: Config) => invoke<void>("save_config", { cfg }),
  startSession: (deviceId: string | null) =>
    invoke<void>("start_session", { deviceId }),
  stopSession: () => invoke<void>("stop_session"),
};

export function onPartial(cb: (t: string) => void): Promise<UnlistenFn> {
  return listen<string>("asr-partial", (e) => cb(e.payload));
}
export function onSentence(cb: (t: string) => void): Promise<UnlistenFn> {
  return listen<string>("asr-sentence", (e) => cb(e.payload));
}
export function onStatus(cb: (t: string) => void): Promise<UnlistenFn> {
  return listen<string>("asr-status", (e) => cb(e.payload));
}
