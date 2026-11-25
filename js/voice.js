// Режим «Звонок»: без рук, детектор речи (VAD), перебивание на полуслове, озвучка по предложениям.
import { api, stream, upload } from "./api.js";
import { $, el, setIcon, toast } from "./ui.js";

const V = {
  active: false,
  mic: null,
  ctx: null,
  analyser: null,
  raf: 0,
  rec: null,
  chunks: [],
  talking: false,
  silenceSince: 0,
  speechStart: 0,
  ai: null,
  queue: [],
  audio: null,
  history: [],
  onUsage: () => {},
};

export function initVoice(opts) {
  V.onUsage = opts.onUsage || (() => {});
  $("#btn-call").addEventListener("click", () => (V.active ? stopCall() : startCall()));
  $("#btn-interrupt").addEventListener("click", () => {
    bargeIn();
    setOrb("listening", "Слушаю…");
  });
  $("#voice-select").addEventListener("change", (e) => localStorage.setItem("nh_voice", e.target.value));
  $("#voice-vad").addEventListener("change", (e) => localStorage.setItem("nh_vad", e.target.value));
}

export async function loadVoiceMode() {
  const sel = $("#voice-select");
  if (sel.options.length) return;
  try {
    const r = await api("/api/voice/voices");
    sel.replaceChildren(...r.voices.map((v) => el("option", { value: v.id, text: v.label })));
    sel.value = localStorage.getItem("nh_voice") || "ru-RU-DmitryNeural";
    if (!sel.value) sel.selectedIndex = 0;
    const vad = localStorage.getItem("nh_vad");
    if (vad) $("#voice-vad").value = vad;
  } catch (e) {
    toast(e.message, true);
  }
}

function setOrb(state, label) {
  $("#voice-orb").dataset.state = state;
  $("#voice-status").textContent = label;
}

function log(role, text) {
  const t = el("span", { text });
  const item = el("div", { class: `vlog ${role}` }, el("b", { text: role === "user" ? "Ты" : "ИИ" }), t);
  $("#voice-log").prepend(item);
  return t;
}

function bargeIn() {
  V.ai?.abort();
  V.ai = null;
  V.queue = [];
  if (V.audio) {
    V.audio.pause();
    V.audio = null;
  }
}

async function startCall() {
  if (!navigator.mediaDevices?.getUserMedia) {
    toast("Микрофон доступен только по https. Открой адрес https://…:8443 из окна запуска NeuroHub.", true);
    return;
  }
  try {
    V.mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (e) {
    toast("Нет доступа к микрофону: " + e.message, true);
    return;
  }
  V.active = true;
  const btn = $("#btn-call");
  btn.lastChild.textContent = "Завершить";
  btn.classList.remove("primary");
  btn.classList.add("danger", "solid");
  setIcon(btn, "close");
  $("#btn-interrupt").classList.remove("hidden");

  V.ctx = new (window.AudioContext || window.webkitAudioContext)();
  const src = V.ctx.createMediaStreamSource(V.mic);
  V.analyser = V.ctx.createAnalyser();
  V.analyser.fftSize = 512;
  src.connect(V.analyser);
  setOrb("listening", "Говори, я слушаю");
  loop();
}

export function stopCall() {
  V.active = false;
  cancelAnimationFrame(V.raf);
  bargeIn();
  if (V.rec && V.rec.state !== "inactive") {
    try { V.rec.stop(); } catch {}
  }
  V.mic?.getTracks().forEach((t) => t.stop());
  V.mic = null;
  V.ctx?.close().catch(() => {});
  V.ctx = null;
  V.talking = false;
  const btn = $("#btn-call");
  if (btn) {
    btn.lastChild.textContent = "Начать звонок";
    btn.classList.add("primary");
    btn.classList.remove("danger", "solid");
    setIcon(btn, "phone");
  }
  $("#btn-interrupt")?.classList.add("hidden");
  $("#voice-orb")?.style.removeProperty("--level");
  setOrb("idle", "Поговори с ИИ голосом");
}

function loop() {
  if (!V.active || !V.analyser) return;
  const buf = new Uint8Array(V.analyser.fftSize);
  V.analyser.getByteTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = (buf[i] - 128) / 128;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / buf.length);
  const sens = Number($("#voice-vad").value || 0.035);
  // Пока ИИ говорит, порог выше: колонки не должны «перебивать» сами себя
  const aiBusy = Boolean(V.audio || V.ai);
  const threshold = aiBusy ? sens * 1.65 : sens;
  $("#voice-meter").style.width = `${Math.min(100, (rms / 0.12) * 100)}%`;
  if (V.talking) $("#voice-orb").style.setProperty("--level", String(1 + Math.min(0.25, rms * 3)));

  const now = performance.now();
  if (rms > threshold) {
    V.silenceSince = 0;
    if (!V.talking) {
      V.talking = true;
      V.speechStart = now;
      if (aiBusy) bargeIn();
      beginRec();
      setOrb("user_talking", "Слышу тебя…");
    }
  } else if (V.talking) {
    if (!V.silenceSince) V.silenceSince = now;
    else if (now - V.silenceSince > 800) {
      const dur = now - V.speechStart;
      V.talking = false;
      V.silenceSince = 0;
      $("#voice-orb").style.removeProperty("--level");
      finishRec(dur > 450);
    }
  }
  V.raf = requestAnimationFrame(loop);
}

function beginRec() {
  if (!V.mic) return;
  V.chunks = [];
  V.rec = new MediaRecorder(V.mic);
  V.rec.ondataavailable = (e) => e.data.size && V.chunks.push(e.data);
  V.rec.start();
}

function finishRec(valid) {
  const rec = V.rec;
  if (!rec || rec.state === "inactive") return;
  rec.onstop = async () => {
    if (!valid || !V.chunks.length || !V.active) {
      if (V.active) setOrb("listening", "Говори, я слушаю");
      return;
    }
    const type = rec.mimeType || "audio/webm";
    // Safari пишет mp4, Chrome - webm: расширение подсказывает декодеру формат
    const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
    await handleSpeech(new File([new Blob(V.chunks, { type })], `speech.${ext}`, { type }));
  };
  rec.stop();
}

async function handleSpeech(file) {
  setOrb("thinking", "Распознаю речь…");
  let text = "";
  try {
    text = ((await upload(file, "/api/voice/transcribe")).text || "").trim();
  } catch (e) {
    toast(e.message, true);
  }
  if (!V.active) return;
  if (text.length < 2) return setOrb("listening", "Говори, я слушаю");

  log("user", text);
  const span = log("assistant", "…");
  setOrb("thinking", "Думаю…");
  V.ai = new AbortController();
  let reply = "";
  try {
    await stream(
      "/api/voice/chat",
      { text, history: V.history, voice: $("#voice-select").value },
      (ev) => {
        if (ev.type === "content") {
          reply += ev.text;
          span.textContent = reply;
        } else if (ev.type === "audio" && ev.audio_b64) {
          V.queue.push(ev.audio_b64);
          if (!V.audio) playNext();
        } else if (ev.type === "done") {
          if (ev.usage) V.onUsage(ev.usage);
        } else if (ev.type === "error") {
          toast(ev.message, true);
        }
      },
      V.ai.signal
    );
    V.history.push({ role: "user", content: text });
    if (reply.trim()) V.history.push({ role: "assistant", content: reply.trim() });
  } catch (e) {
    if (e.name !== "AbortError") toast(e.message, true);
    else if (reply.trim()) {
      // Перебили на полуслове - модель должна знать, что договорить не дали
      V.history.push({ role: "user", content: text }, { role: "assistant", content: reply.trim() + "…" });
    }
  } finally {
    V.ai = null;
    V.history = V.history.slice(-24);
    if (!V.audio && !V.queue.length && V.active && !V.talking) setOrb("listening", "Говори, я слушаю");
  }
}

function playNext() {
  if (!V.active || !V.queue.length) {
    V.audio = null;
    if (V.active && !V.ai && !V.talking) setOrb("listening", "Говори, я слушаю");
    return;
  }
  const a = new Audio("data:audio/mp3;base64," + V.queue.shift());
  V.audio = a;
  setOrb("ai_talking", "Говорю… (перебей голосом)");
  a.onended = a.onerror = () => {
    V.audio = null;
    playNext();
  };
  a.play().catch(() => {
    V.audio = null;
    playNext();
  });
}
