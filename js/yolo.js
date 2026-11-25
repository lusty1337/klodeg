// Режим «Зрение»: кадры с камеры уходят на сервер, YOLO11 из D:\YOLO рисует разметку и эффекты.
import { wsUrl } from "./api.js";
import { $, setIcon, toast } from "./ui.js";

const Y = { ws: null, cam: null, running: false, busy: false, video: null, canvas: null, ctx: null, watchdog: 0 };
const OPT_IDS = ["yolo-preset", "yolo-size", "yolo-conf", "yolo-face", "yolo-face-effect", "yolo-pose", "yolo-seg"];

export function initYolo() {
  Y.video = document.createElement("video");
  Y.video.playsInline = true;
  Y.video.muted = true;
  Y.canvas = document.createElement("canvas");
  Y.ctx = Y.canvas.getContext("2d");
  $("#btn-yolo").addEventListener("click", () => (Y.running ? stopYolo() : startYolo()));
  for (const id of OPT_IDS) $(`#${id}`).addEventListener("change", sendOpts);
  $("#yolo-front").addEventListener("change", () => {
    if (Y.running) {
      stopYolo();
      startYolo();
    }
  });
}

function opts() {
  return {
    preset: $("#yolo-preset").value,
    model_size: $("#yolo-size").value,
    conf: Number($("#yolo-conf").value || 0.35),
    enable_face_censor: $("#yolo-face").checked,
    face_effect_type: $("#yolo-face-effect").value,
    show_pose: $("#yolo-pose").checked,
    show_seg: $("#yolo-seg").checked,
  };
}

function sendOpts() {
  if (Y.ws?.readyState === WebSocket.OPEN) Y.ws.send(JSON.stringify({ type: "opts", opts: opts() }));
}

function setUi(on) {
  const btn = $("#btn-yolo");
  btn.lastChild.textContent = on ? "Выключить камеру" : "Включить камеру";
  btn.classList.toggle("primary", !on);
  setIcon(btn, on ? "close" : "eye");
  $("#yolo-empty").classList.toggle("hidden", on);
  $("#yolo-view").classList.toggle("hidden", !on);
  $("#yolo-hud").classList.toggle("hidden", !on);
}

async function startYolo() {
  if (!navigator.mediaDevices?.getUserMedia) {
    toast("Камера доступна только по https. Открой адрес https://…:8443 из окна запуска NeuroHub.", true);
    return;
  }
  try {
    Y.cam = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 960 }, height: { ideal: 540 }, frameRate: { ideal: 30 },
        facingMode: $("#yolo-front").checked ? "user" : "environment",
      },
      audio: false,
    });
  } catch (e) {
    toast("Камера недоступна: " + e.message, true);
    return;
  }
  Y.video.srcObject = Y.cam;
  await Y.video.play();
  Y.canvas.width = Y.video.videoWidth || 640;
  Y.canvas.height = Y.video.videoHeight || 480;
  $("#yolo-objects").textContent = "Загружаю YOLO на видеокарту…";

  Y.ws = new WebSocket(wsUrl("/api/yolo/ws"));
  Y.ws.binaryType = "blob";
  Y.ws.onopen = () => {
    Y.running = true;
    Y.busy = false;
    setUi(true);
    sendOpts();
    pump();
  };
  Y.ws.onmessage = (ev) => {
    if (typeof ev.data === "string") {
      let meta;
      try { meta = JSON.parse(ev.data); } catch { return; }
      if (meta.fatal) {
        toast(meta.fatal, true);
        return stopYolo();
      }
      if (meta.error) {
        // Кадр не обработался - не ждём картинку, шлём следующий, иначе поток замрёт
        Y.busy = false;
        $("#yolo-objects").textContent = meta.error;
        return requestAnimationFrame(pump);
      }
      if (meta.fps != null) $("#yolo-fps").textContent = `${meta.fps} FPS`;
      if (meta.counts) {
        const e = Object.entries(meta.counts);
        $("#yolo-objects").textContent = e.length ? e.map(([k, v]) => `${k}: ${v}`).join(" · ") : "в кадре пусто";
      }
    } else if (ev.data instanceof Blob) {
      const img = $("#yolo-view");
      const url = URL.createObjectURL(ev.data);
      const old = img.dataset.blob;
      img.src = url;
      img.dataset.blob = url;
      if (old) URL.revokeObjectURL(old);
      Y.busy = false;
      if (Y.running) requestAnimationFrame(pump);
    }
  };
  Y.ws.onclose = (e) => {
    if (e.code === 4403) toast("Нет доступа к YOLO", true);
    if (Y.running) stopYolo();
  };
}

function pump() {
  if (!Y.running || Y.busy || Y.ws?.readyState !== WebSocket.OPEN) return;
  if (Y.video.readyState < 2) return requestAnimationFrame(pump);
  Y.busy = true;
  Y.ctx.drawImage(Y.video, 0, 0, Y.canvas.width, Y.canvas.height);
  Y.canvas.toBlob((blob) => {
    if (blob && Y.ws?.readyState === WebSocket.OPEN) Y.ws.send(blob);
    else Y.busy = false;
  }, "image/jpeg", 0.78);
  // Страховка: если ответ на кадр потерялся, через 5 с отправляем следующий
  clearTimeout(Y.watchdog);
  Y.watchdog = setTimeout(() => {
    if (Y.running && Y.busy) {
      Y.busy = false;
      pump();
    }
  }, 5000);
}

export function stopYolo() {
  Y.running = false;
  Y.busy = false;
  clearTimeout(Y.watchdog);
  try { Y.ws?.close(); } catch {}
  Y.ws = null;
  Y.cam?.getTracks().forEach((t) => t.stop());
  Y.cam = null;
  if ($("#btn-yolo")) setUi(false);
}
