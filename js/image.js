// Режим «Картинки»: Qwen собирает промпт -> языковая модель выгружается -> Forge рисует -> модель возвращается.
import { api, stream, fileUrl } from "./api.js";
import { $, $$, el, icon, setIcon, toast, lightbox, copyText } from "./ui.js";

let checkpoints = [];
let gallery = [];
let controller = null;
let onUsage = () => {};

const STAGE_PCT = { prompting: 8, unloading_llm: 16, starting_forge: 24, loading_sd: 34, generating: 40, unloading_sd: 96 };

export function initImage(opts) {
  onUsage = opts.onUsage || (() => {});
  $("#img-form").addEventListener("submit", (e) => {
    e.preventDefault();
    controller ? controller.abort() : start();
  });
  $("#img-request").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) $("#img-form").requestSubmit();
  });
  $("#img-model").addEventListener("change", applyDefaults);
  for (const b of $$("#img-ratio button")) b.addEventListener("click", () => setSize(...b.dataset.size.split("x").map(Number)));
  for (const id of ["#img-width", "#img-height"]) $(id).addEventListener("change", syncRatio);
}

function setSize(w, h) {
  $("#img-width").value = w;
  $("#img-height").value = h;
  syncRatio();
}

function syncRatio() {
  const cur = `${$("#img-width").value}x${$("#img-height").value}`;
  for (const b of $$("#img-ratio button")) b.setAttribute("aria-pressed", String(b.dataset.size === cur));
}

export async function loadImageMode() {
  try {
    const info = await api("/api/image/info");
    checkpoints = info.checkpoints || [];
    gallery = info.gallery || [];
    const sel = $("#img-model");
    const cur = sel.value;
    sel.replaceChildren(...checkpoints.map((c) => el("option", { value: c.filename, text: c.label })));
    if (!checkpoints.length) sel.append(el("option", { value: "", text: "Нет моделей в D:\\Forge\\…\\Stable-diffusion" }));
    if (cur && checkpoints.some((c) => c.filename === cur)) sel.value = cur;
    else applyDefaults();
    renderGallery();
    if (gallery.length && !$("#img-hero img")) showHero(gallery[0]);
  } catch (e) {
    toast(e.message, true);
  }
}

function applyDefaults() {
  const ck = checkpoints.find((c) => c.filename === $("#img-model").value);
  if (!ck?.defaults) return;
  const d = ck.defaults;
  setSize(d.width || 1024, d.height || 1024);
  $("#img-steps").value = d.steps || 28;
  $("#img-cfg").value = d.cfg_scale || 6.5;
  setSelect("#img-sampler", d.sampler_name || "DPM++ 2M");
  setSelect("#img-scheduler", d.scheduler || "Karras");
}

/** Выставляет значение select, добавляя вариант, если его нет (Qwen мог выбрать другой сэмплер). */
function setSelect(sel, value) {
  const s = $(sel);
  if (![...s.options].some((o) => o.value === value)) s.append(el("option", { value, text: value }));
  s.value = value;
}

function setBusy(busy, text = "") {
  const btn = $("#img-submit");
  btn.lastChild.textContent = busy ? "Отменить" : "Сгенерировать";
  setIcon(btn, busy ? "close" : "sparkles");
  btn.classList.toggle("primary", !busy);
  $("#img-status").classList.toggle("hidden", !busy && !text);
  if (text) $("#img-status-text").textContent = text;
}

function setProgress(p) {
  $("#img-progress-bar").style.width = `${p}%`;
}

async function start() {
  const text = $("#img-request").value.trim();
  if (!text) return toast("Опиши, что нарисовать");
  const seedRaw = $("#img-seed").value.trim();
  controller = new AbortController();
  setBusy(true, "Запускаю…");
  setProgress(3);

  const body = {
    request_text: text,
    model: $("#img-model").value,
    direct_prompt: $("#img-direct").checked,
    negative_prompt: $("#img-neg").value.trim(),
    width: Number($("#img-width").value) || 1024,
    height: Number($("#img-height").value) || 1024,
    steps: Number($("#img-steps").value) || 28,
    cfg_scale: Number($("#img-cfg").value) || 6.5,
    sampler_name: $("#img-sampler").value,
    scheduler: $("#img-scheduler").value,
    clip_skip: 2,
    seed: seedRaw === "" ? -1 : Number(seedRaw),
    adetailer: $("#img-adetailer").checked,
  };

  let ok = false;
  try {
    await stream("/api/image/generate", body, (ev) => {
      if (ev.type === "stage") {
        setBusy(true, ev.text);
        if (STAGE_PCT[ev.stage]) setProgress(STAGE_PCT[ev.stage]);
      } else if (ev.type === "plan") {
        showPlan(ev.plan);
      } else if (ev.type === "progress") {
        const p = Math.max(0, Math.min(100, ev.progress || 0));
        setProgress(40 + Math.round(p * 0.55));
        setBusy(true, `Рисую: ${p}%${ev.eta ? ` · осталось ~${Math.round(ev.eta)} с` : ""}`);
      } else if (ev.type === "done") {
        ok = true;
        setProgress(100);
        if (ev.usage) onUsage(ev.usage);
        if (ev.record) {
          gallery.unshift(ev.record);
          showHero(ev.record);
          renderGallery();
        }
      } else if (ev.type === "error") {
        toast(ev.message, true);
      }
    }, controller.signal);
  } catch (e) {
    if (e.name !== "AbortError") toast(e.message, true);
    else toast("Генерация отменена");
  } finally {
    controller = null;
    setBusy(false, ok ? "Готово. Языковая модель возвращается в память в фоне." : "");
    if (ok) setTimeout(() => !controller && $("#img-status").classList.add("hidden"), 4000);
    window.dispatchEvent(new CustomEvent("nh:refresh-status"));
  }
}

function showPlan(p) {
  setSize(p.width, p.height);
  $("#img-steps").value = p.steps;
  $("#img-cfg").value = p.cfg_scale;
  setSelect("#img-sampler", p.sampler_name);
  if ([...$("#img-model").options].some((o) => o.value === p.model)) $("#img-model").value = p.model;
  $("#img-plan").classList.remove("hidden");
  $("#img-plan-expl").textContent = p.explanation || "";
  $("#img-plan-pos").textContent = p.prompt;
  $("#img-plan-neg").textContent = p.negative_prompt ? `Негатив: ${p.negative_prompt}` : "";
  $("#img-plan-meta").textContent = `${p.width}×${p.height} · ${p.steps} шагов · CFG ${p.cfg_scale} · ${p.sampler_name}`;
}

async function showHero(rec) {
  const box = $("#img-hero");
  let u;
  try {
    u = await fileUrl(rec.id);
  } catch {
    return;
  }
  const img = el("img", { alt: rec.prompt, src: u, onclick: () => lightbox(u) });
  const meta = el(
    "div",
    { class: "hero-meta" },
    el("div", { class: "small muted", text: `${rec.model.replace(/\.safetensors$/, "")} · ${rec.width}×${rec.height} · ${rec.steps} шагов · CFG ${rec.cfg_scale} · seed ${rec.seed}` }),
    el(
      "div",
      { class: "row wrap" },
      el("a", { class: "btn", href: u, download: `neurohub_${rec.seed}.png` }, icon("download", 15), "Скачать"),
      el("button", { class: "btn", type: "button", onclick: () => { $("#img-seed").value = rec.seed; toast(`Seed ${rec.seed} подставлен`); } }, icon("lock", 15), "Этот seed"),
      el("button", { class: "btn", type: "button", onclick: () => copyText(rec.prompt, "Промпт скопирован") }, icon("copy", 15), "Промпт")
    )
  );
  box.replaceChildren(img, meta);
}

function renderGallery() {
  const grid = $("#img-gallery");
  if (!gallery.length) {
    grid.replaceChildren(el("p", { class: "muted small", text: "Пока пусто." }));
    return;
  }
  grid.replaceChildren(
    ...gallery.map((rec) => {
      const img = el("img", { alt: rec.prompt, loading: "lazy" });
      fileUrl(rec.id).then((u) => (img.src = u)).catch(() => {});
      return el("button", {
        class: "gal-card", type: "button", title: rec.prompt,
        onclick: () => {
          showHero(rec);
          $("#img-hero").scrollIntoView({ behavior: "smooth", block: "start" });
        },
      }, img);
    })
  );
}
