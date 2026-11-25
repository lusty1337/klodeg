// Режим «Стемы»: резидентный HTDemucs-ft в VRAM + разбор треков на дорожки, ZIP для FL Studio, BPM и тональность.
import { api, streamForm, authedUrl } from "./api.js";
import { $, $$, el, icon, toast, copyText, fmtDateTime, ask } from "./ui.js";

const ST = {
  mode: localStorage.getItem("nh_stems_mode") || "4stems",
  fmt: localStorage.getItem("nh_stems_fmt") || "wav24",
  engine: null,
  history: [],
  activeId: null,
  busy: false,
  controller: null,
};

const MODE_LABELS = {
  "4stems": "4 стема",
  "4stems_inst": "4 стема + Минус",
  "2stems": "Вокал + Минус",
};

const FMT_LABELS = {
  wav24: "WAV 24-bit",
  wav16: "WAV 16-bit",
  mp3: "MP3 320",
};

function fmtBytes(n) {
  if (!n) return "0 МБ";
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} МБ`;
  return `${Math.max(1, Math.round(n / 1024))} КБ`;
}

function fmtDur(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function initStems() {
  const drop = $("#stems-dropzone");
  const fileIn = $("#stems-file");
  if (!drop || !fileIn) return;

  drop.addEventListener("click", () => {
    if (!ST.busy) fileIn.click();
  });
  drop.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && !ST.busy) {
      e.preventDefault();
      fileIn.click();
    }
  });
  fileIn.addEventListener("change", () => {
    const f = fileIn.files?.[0];
    fileIn.value = "";
    if (f) startSeparate(f);
  });

  for (const ev of ["dragenter", "dragover"]) {
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      if (!ST.busy) drop.classList.add("drag");
    });
  }
  for (const ev of ["dragleave", "drop"]) {
    drop.addEventListener(ev, () => drop.classList.remove("drag"));
  }
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    if (ST.busy) return;
    const f = e.dataTransfer?.files?.[0];
    if (f) startSeparate(f);
  });

  syncSeg("#stems-mode", ST.mode);
  syncSeg("#stems-fmt", ST.fmt);

  for (const b of $$("#stems-mode button")) {
    b.addEventListener("click", () => {
      ST.mode = b.dataset.val;
      localStorage.setItem("nh_stems_mode", ST.mode);
      syncSeg("#stems-mode", ST.mode);
    });
  }
  for (const b of $$("#stems-fmt button")) {
    b.addEventListener("click", () => {
      ST.fmt = b.dataset.val;
      localStorage.setItem("nh_stems_fmt", ST.fmt);
      syncSeg("#stems-fmt", ST.fmt);
    });
  }

  $("#btn-stems-load").addEventListener("click", loadEngine);
  $("#btn-stems-unload").addEventListener("click", () => unloadEngine(false));
  $("#btn-stems-return-llm").addEventListener("click", () => unloadEngine(true));
}

function syncSeg(sel, val) {
  for (const b of $$(`${sel} button`)) {
    b.setAttribute("aria-pressed", String(b.dataset.val === val));
  }
}

export async function loadStemsMode() {
  try {
    const d = await api("/api/stems/info");
    ST.engine = d.engine;
    ST.history = d.history || [];
    renderEngine();
    renderHistory();
    if (ST.history.length) {
      const cur = ST.history.find((x) => x.id === ST.activeId) || ST.history[0];
      renderResult(cur);
    } else {
      $("#stems-result").classList.add("hidden");
    }
  } catch (e) {
    toast(e.message, true);
  }
}

function renderEngine() {
  const e = ST.engine || {};
  const tag = $("#stems-engine-state");
  const sub = $("#stems-engine-sub");
  const btnLoad = $("#btn-stems-load");
  const btnUnload = $("#btn-stems-unload");
  const btnRet = $("#btn-stems-return-llm");

  if (e.busy || ST.busy) {
    tag.className = "status-tag warn";
    tag.textContent = "Разделяет…";
    sub.textContent = "HTDemucs-ft обрабатывает трек на видеокарте";
  } else if (e.loading) {
    tag.className = "status-tag warn";
    tag.textContent = "Загружается…";
    sub.textContent = "Выгружаю языковую модель и поднимаю HTDemucs-ft в VRAM…";
  } else if (e.loaded) {
    tag.className = "status-tag on";
    tag.textContent = e.device === "cuda" ? "В VRAM · GPU" : "Загружен · CPU";
    const vram = e.vram_mib ? ` · ~${(e.vram_mib / 1024).toFixed(1)} ГБ VRAM` : "";
    sub.textContent = `Готов к работе${vram} — можно закидывать треки подряд без перезагрузки модели`;
  } else {
    tag.className = "status-tag";
    tag.textContent = "Выгружен";
    sub.textContent = "Нажми «Загрузить в VRAM» или сразу кинь трек — LLM выгрузится сама";
  }

  const locked = Boolean(e.loading || e.busy || ST.busy);
  btnLoad.disabled = locked || Boolean(e.loaded);
  btnUnload.disabled = locked || !e.loaded;
  btnRet.disabled = locked || !e.loaded;
}

async function loadEngine() {
  ST.engine = { ...(ST.engine || {}), loading: true };
  renderEngine();
  try {
    const r = await api("/api/stems/load", { method: "POST" });
    ST.engine = r.engine;
    toast("HTDemucs-ft загружен в видеопамять — можно кидать треки");
    window.dispatchEvent(new CustomEvent("nh:refresh-status"));
  } catch (e) {
    ST.engine = { ...(ST.engine || {}), loading: false };
    toast(e.message, true);
  } finally {
    renderEngine();
  }
}

async function unloadEngine(reloadLlm) {
  try {
    const r = await api(`/api/stems/unload?reload_llm=${reloadLlm ? "true" : "false"}`, { method: "POST" });
    ST.engine = r.engine;
    toast(reloadLlm ? "Demucs выгружен, Qwen возвращается в память" : "Demucs выгружен, видеопамять свободна");
    window.dispatchEvent(new CustomEvent("nh:refresh-status"));
  } catch (e) {
    toast(e.message, true);
  } finally {
    renderEngine();
  }
}

function setProgress(show, pct = 0, text = "") {
  $("#stems-progress-box").classList.toggle("hidden", !show);
  $("#stems-progress-bar").style.width = `${Math.max(0, Math.min(100, pct))}%`;
  $("#stems-progress-text").textContent = text;
}

async function startSeparate(file) {
  if (ST.busy) return;
  ST.busy = true;
  ST.controller = new AbortController();
  $("#stems-dropzone").classList.add("busy");
  renderEngine();
  setProgress(true, 4, `Загружаю «${file.name}»…`);

  const fd = new FormData();
  fd.append("file", file, file.name);
  fd.append("mode", ST.mode);
  fd.append("fmt", ST.fmt);

  let ok = false;
  try {
    await streamForm("/api/stems/separate", fd, (ev) => {
      if (ev.type === "progress") {
        setProgress(true, ev.pct || 10, ev.text || "Обработка…");
      } else if (ev.type === "done" && ev.record) {
        ok = true;
        if (ev.engine) ST.engine = ev.engine;
        ST.history = [ev.record, ...ST.history.filter((x) => x.id !== ev.record.id)];
        setProgress(true, 100, "Готово! Архив собран.");
        renderResult(ev.record);
        renderHistory();
        toast(`Готово: ${ev.record.bpm} BPM · ${ev.record.key_short}`);
        window.dispatchEvent(new CustomEvent("nh:refresh-status"));
      } else if (ev.type === "error") {
        toast(ev.message || "Ошибка разделения", true);
      }
    }, ST.controller.signal);
  } catch (e) {
    if (e.name !== "AbortError") toast(e.message, true);
  } finally {
    ST.busy = false;
    ST.controller = null;
    $("#stems-dropzone").classList.remove("busy");
    renderEngine();
    if (!ok) setProgress(false);
    else setTimeout(() => { if (!ST.busy) setProgress(false); }, 1800);
  }
}

function metricTile(label, value, sub, copyVal = null) {
  const attrs = { class: `stem-metric${copyVal ? " clickable" : ""}` };
  if (copyVal) {
    attrs.title = "Нажми, чтобы скопировать";
    attrs.onclick = () => copyText(copyVal, `Скопировано: ${copyVal}`);
  }
  return el(
    copyVal ? "button" : "div",
    copyVal ? { ...attrs, type: "button" } : attrs,
    el("span", { class: "stem-metric-label", text: label }),
    el("strong", { class: "stem-metric-val", text: value }),
    sub ? el("span", { class: "stem-metric-sub", text: sub }) : null
  );
}

function renderResult(rec) {
  if (!rec) return;
  ST.activeId = rec.id;
  const box = $("#stems-result");
  box.classList.remove("hidden");

  const zipHref = authedUrl(`/api/stems/jobs/${rec.id}/zip`);
  const bpmSub = rec.bpm_alt
    ? (rec.bpm_alt < rec.bpm ? `½ ${rec.bpm_alt} BPM` : `×2 ${rec.bpm_alt} BPM`)
    : "темп по ударным";
  const srKhz = rec.sample_rate ? `${(rec.sample_rate / 1000).toFixed(1).replace(".0", "")} кГц` : "44.1 кГц";
  const fmtShort = { wav24: "WAV 24", wav16: "WAV 16", mp3: "MP3 320" }[rec.fmt] || rec.fmt;

  const metrics = el(
    "div",
    { class: "stems-metrics" },
    metricTile("BPM", String(rec.bpm), bpmSub, `${rec.bpm} BPM`),
    metricTile("Тональность", rec.key_short || rec.key, `${rec.key_ru || rec.key} · ${rec.key_conf || 0}%`, `${rec.key} (${rec.camelot})`),
    metricTile("Camelot", rec.camelot || "—", rec.key || "", rec.camelot || ""),
    metricTile("Длительность", fmtDur(rec.duration), `${fmtShort} · ${srKhz}`),
    metricTile("Громкость", `${rec.rms_db} dB`, `RMS · пик ${rec.peak_db} dB`)
  );

  const trackRows = (rec.stems || []).map((st) => {
    const url = authedUrl(`/api/stems/jobs/${rec.id}/stem/${st.name}`);
    const audio = el("audio", { controls: true, preload: "none", src: url });
    return el(
      "div",
      { class: "stem-row" },
      el(
        "div",
        { class: "stem-row-head" },
        el("strong", { text: st.label || st.name }),
        el("span", { class: "hint mono", text: fmtBytes(st.size) }),
        el(
          "a",
          { class: "btn small", href: url, download: st.arc_name || st.file },
          icon("download", 14),
          "Скачать"
        )
      ),
      audio
    );
  });

  box.replaceChildren(
    el(
      "div",
      { class: "card-head" },
      el(
        "div",
        { class: "stems-res-title" },
        el("h2", { text: rec.title }),
        el("p", { class: "hint", text: `${MODE_LABELS[rec.mode] || rec.mode} · ${fmtDateTime(rec.created_at)}` })
      ),
      el("button", {
        class: "icon-btn",
        type: "button",
        title: "Удалить разбор",
        "aria-label": "Удалить разбор",
        onclick: () => removeJob(rec),
      }, icon("trash", 17))
    ),
    el(
      "a",
      { class: "btn primary block stems-zip-btn", href: zipHref, download: rec.zip_file },
      icon("download", 18),
      el("span", { text: `Скачать ZIP · ${rec.zip_file} (${fmtBytes(rec.zip_size)})` })
    ),
    metrics,
    el("div", { class: "stems-tracks" }, ...trackRows)
  );
  renderHistory();
}

function renderHistory() {
  const card = $("#stems-history-card");
  card.classList.toggle("hidden", ST.history.length === 0);
  if (!ST.history.length) return;
  $("#stems-history-count").textContent = `${ST.history.length} шт.`;
  $("#stems-history-list").replaceChildren(
    ...ST.history.map((it) =>
      el(
        "button",
        {
          type: "button",
          class: "stems-hist-item",
          "aria-current": it.id === ST.activeId ? "page" : null,
          onclick: () => renderResult(it),
        },
        el("strong", { text: it.title }),
        el("span", { class: "hint mono", text: `${it.bpm} BPM · ${it.key_short} (${it.camelot}) · ${fmtBytes(it.zip_size)}` })
      )
    )
  );
}

async function removeJob(rec) {
  if (!(await ask({ title: `Удалить «${rec.title}»?`, text: "ZIP и дорожки удалятся с диска.", ok: "Удалить", danger: true }))) return;
  try {
    await api(`/api/stems/jobs/${rec.id}`, { method: "DELETE" });
    ST.history = ST.history.filter((x) => x.id !== rec.id);
    if (ST.history.length) renderResult(ST.history[0]);
    else {
      ST.activeId = null;
      $("#stems-result").classList.add("hidden");
    }
    renderHistory();
    toast("Разбор удалён");
  } catch (e) {
    toast(e.message, true);
  }
}
