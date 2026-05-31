import { getCurrentWindow, Window } from "@tauri-apps/api/window";
import { api, onPartial, onSentence } from "./ipc";

const box = document.getElementById("caption-box") as HTMLDivElement;

let captionLines = 2;
const sentences: string[] = [];
let partial = "";

function render() {
  const lines = sentences.slice(-captionLines);
  box.replaceChildren();
  for (const l of lines) {
    box.append(document.createTextNode(l));
    box.append(document.createElement("br"));
  }
  if (partial) {
    const span = document.createElement("span");
    span.className = "cap-partial";
    span.textContent = partial;
    box.append(span);
  }
  if (lines.length === 0 && !partial) box.textContent = "等待声音...";
}

async function backToFull() {
  const main = await Window.getByLabel("main");
  await main?.show();
  await main?.setFocus();
  await getCurrentWindow().hide();
}

box.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  backToFull();
});
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") backToFull();
});

async function init() {
  const cfg = await api.getConfig();
  captionLines = Math.max(1, cfg.captionLines);

  await onPartial((t) => {
    partial = t;
    render();
  });
  await onSentence((t) => {
    if (!t.trim()) return;
    sentences.push(t);
    partial = "";
    render();
  });
}

init();
