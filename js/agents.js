// Режим «Агенты»: персонажи на одной модели спорят на тему текстом и голосами, пользователь может вмешаться.
import { api, stream } from "./api.js";
import { $, el, icon, setIcon, toast } from "./ui.js";

const COLORS = ["#5b5bd6", "#d65b8a", "#2f9e8f", "#c98a1b"];
const A = { cfg: [], voices: [], history: [], turn: 0, running: false, controller: null, audio: null, userName: "Ты", epoch: 0 };

export function initAgents() {
  $("#btn-agents-run").addEventListener("click", () => (A.running ? stopArena() : runArena()));
  $("#btn-agents-step").addEventListener("click", async () => {
    if (A.running || A.controller) return;
    try {
      await turn(A.epoch);
    } catch (e) {
      if (e.name !== "AbortError") toast(e.message, true);
    }
  });
  $("#btn-agents-clear").addEventListener("click", () => {
    stopArena();
    A.history = [];
    A.turn = 0;
    $("#agents-feed").replaceChildren(placeholder());
  });
  $("#btn-agents-edit").addEventListener("click", () => $("#agents-cards").classList.toggle("hidden"));
  $("#agents-say").addEventListener("submit", (e) => {
    e.preventDefault();
    const inp = $("#agents-msg");
    const txt = inp.value.trim();
    if (!txt) return;
    inp.value = "";
    A.history.push({ speaker_id: "user", speaker_name: A.userName, content: txt });
    bubble(-1, A.userName, txt);
  });
}

function placeholder() {
  return el("div", { class: "placeholder" }, icon("users", 34), el("p", { class: "muted", text: "Персонажи обсуждают тему на одной модели. Можно вмешаться." }));
}

export async function loadAgentsMode(user) {
  if (user) A.userName = user.username;
  if (A.cfg.length) return;
  try {
    const data = await api("/api/agents/config");
    A.cfg = data.agents || [];
    A.voices = data.voices || [];
    renderCards();
  } catch (e) {
    toast(e.message, true);
  }
}

let saveTimer = 0;
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => api("/api/agents/config", { method: "PUT", body: A.cfg }).catch((e) => toast(e.message, true)), 800);
}

function renderCards() {
  $("#agents-cards").replaceChildren(
    ...A.cfg.map((a, i) => {
      const bind = (node, key) => {
        node.value = a[key] || "";
        node.addEventListener("input", () => {
          a[key] = node.value;
          saveSoon();
        });
        return node;
      };
      const voice = el("select", {}, ...A.voices.map((v) => el("option", { value: v.id, text: v.label })));
      bind(voice, "voice");
      voice.addEventListener("change", () => { a.voice = voice.value; saveSoon(); });
      return el(
        "div",
        { class: "agent-card" },
        el("div", { class: "agent-name" }, badge(i, a.name), bind(el("input", { placeholder: "Имя", "aria-label": "Имя персонажа" }), "name")),
        el("label", { class: "field" }, "Характер и роль", bind(el("textarea", { rows: 3 }), "role")),
        el("label", { class: "field" }, "Манера речи", bind(el("textarea", { rows: 2 }), "style")),
        el("label", { class: "field" }, "Голос", voice)
      );
    })
  );
}

function badge(i, name) {
  return el("span", { class: "agent-badge", style: i >= 0 ? `background:${COLORS[i % COLORS.length]}` : "", text: (name || "?").slice(0, 1).toUpperCase() });
}

function bubble(i, name, text) {
  const feed = $("#agents-feed");
  feed.querySelector(".placeholder")?.remove();
  const body = el("div", { class: "ag-text", text });
  const item = el("div", { class: `ag-msg${i < 0 ? " user" : ""}` }, badge(i, name), el("div", {}, el("div", { class: "ag-author", text: name }), body));
  feed.append(item);
  item.scrollIntoView({ block: "end", behavior: "smooth" });
  return { item, body };
}

/** Проигрывает очередь mp3 по порядку. Резолвится, когда очередь кончилась и поток закрыт - или при остановке. */
function player(epoch) {
  const queue = [];
  let closed = false;
  let wake = null;
  const done = (async () => {
    for (;;) {
      if (epoch !== A.epoch) return;
      if (!queue.length) {
        if (closed) return;
        await new Promise((r) => (wake = r));
        continue;
      }
      await new Promise((resolve) => {
        const a = new Audio("data:audio/mp3;base64," + queue.shift());
        A.audio = a;
        a.onended = a.onerror = a.onpause = resolve;
        a.play().catch(resolve);
      });
      A.audio = null;
    }
  })();
  return {
    push(b64) { queue.push(b64); wake?.(); },
    close() { closed = true; wake?.(); },
    done,
  };
}

async function turn(epoch) {
  if (!A.cfg.length) return;
  const idx = A.turn % A.cfg.length;
  const speaker = A.cfg[idx];
  const { item, body } = bubble(idx, speaker.name, "");
  item.classList.add("speaking");
  const voice = $("#agents-voice").checked;
  const play = player(epoch);
  let full = "";
  A.controller = new AbortController();
  try {
    await stream(
      "/api/agents/turn",
      {
        topic: $("#agents-topic").value.trim() || "Будущее локального ИИ",
        agents: A.cfg,
        speaker_index: idx,
        history: A.history,
        turn_idx: A.turn,
        with_voice: voice,
      },
      (ev) => {
        if (ev.type === "content") {
          full += ev.text;
          body.textContent = full;
        } else if (ev.type === "audio" && ev.audio_b64) {
          play.push(ev.audio_b64);
        } else if (ev.type === "error") {
          toast(ev.message, true);
        }
      },
      A.controller.signal
    );
  } finally {
    A.controller = null;
    item.classList.remove("speaking");
    play.close();
  }
  if (full.trim()) {
    A.history.push({ speaker_id: speaker.id, speaker_name: speaker.name, content: full.trim() });
    A.turn++;
  } else {
    item.remove();
  }
  await play.done;
}

async function runArena() {
  A.running = true;
  const epoch = ++A.epoch;
  const btn = $("#btn-agents-run");
  btn.lastChild.textContent = "Остановить";
  setIcon(btn, "pause");
  const max = Number($("#agents-max").value) || 8;
  for (let n = 0; n < max && A.running && epoch === A.epoch; n++) {
    try {
      await turn(epoch);
    } catch (e) {
      if (e.name !== "AbortError") toast(e.message, true);
      break;
    }
  }
  if (epoch === A.epoch) stopArena();
}

export function stopArena() {
  A.running = false;
  A.epoch++; // все ожидающие плееры и циклы старой «эпохи» сразу выходят
  A.controller?.abort();
  A.controller = null;
  if (A.audio) {
    A.audio.pause();
    A.audio = null;
  }
  const btn = $("#btn-agents-run");
  if (btn) {
    btn.lastChild.textContent = "Запустить";
    setIcon(btn, "play");
  }
}
