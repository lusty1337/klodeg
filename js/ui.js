// Общие помощники интерфейса: иконки, элементы, уведомления, диалоги, буфер обмена, Markdown + KaTeX + подсветка.
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const P = {
  chat: '<path d="M21 12a8 8 0 0 1-11.8 7.04L4 20l1-4.6A8 8 0 1 1 21 12Z"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
  phone: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z"/><circle cx="12" cy="12" r="3"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h10"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  paperclip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z"/>',
  brain: '<path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-2.04Z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-2.04Z"/>',
  arrowUp: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  arrowDown: '<path d="M12 5v14M19 12l-7 7-7-7"/>',
  arrowRight: '<path d="M5 12h14M13 5l7 7-7 7"/>',
  arrowLeft: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  rewind: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  shorter: '<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/>',
  longer: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
  file: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2Z"/><path d="M14 2v6h6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  sparkles: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/>',
  play: '<path d="m6 3 14 9-14 9V3Z"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  bolt: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z"/>',
  sidebar: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 3v18"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevrons: '<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>',
  gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
};

export function icon(name, size = 18) {
  const span = document.createElement("span");
  span.className = "svg-ico";
  span.setAttribute("aria-hidden", "true");
  span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${P[name] || ""}</svg>`;
  return span;
}

/** Заменяет <span data-icon="name"> в разметке на SVG. */
export function hydrateIcons(root = document) {
  for (const n of root.querySelectorAll("[data-icon]")) {
    const i = icon(n.dataset.icon, Number(n.dataset.size) || 18);
    // классы вроде card-ico задают иконке рамку, их нельзя терять при замене
    if (n.classList.length) i.classList.add(...n.classList);
    n.replaceWith(i);
  }
}

export function setIcon(button, name, size = 18) {
  const old = button.querySelector(".svg-ico");
  const i = icon(name, size);
  old ? old.replaceWith(i) : button.prepend(i);
}

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (k === "value" && "value" in node) node.value = v;
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c !== undefined && c !== null && c !== false) node.append(c);
  }
  return node;
}

export function setChildren(node, ...children) {
  node.replaceChildren(...children.flat().filter((c) => c !== undefined && c !== null && c !== false));
}

// ---------------- уведомления ----------------
export function toast(message, isError = false) {
  const box = $("#toasts");
  const t = el("div", { class: `toast${isError ? " err" : ""}`, text: message });
  box.append(t);
  setTimeout(() => t.remove(), isError ? 5500 : 2600);
}

// ---------------- диалоги вместо prompt/confirm ----------------
/**
 * ask({title, text, ok, danger, fields:[{name,label,value,type,placeholder}]}) ->
 *   Promise<null | true | {name: value}>
 */
export function ask({ title, text = "", ok = "OK", danger = false, fields = [] }) {
  const dlg = $("#ask-dialog");
  $("#ask-title").textContent = title;
  $("#ask-text").textContent = text;
  const okBtn = $("#ask-ok");
  okBtn.textContent = ok;
  okBtn.className = `btn ${danger ? "danger solid" : "primary"}`;
  const inputs = fields.map((f) =>
    el("input", { name: f.name, type: f.type || "text", value: f.value ?? "", placeholder: f.placeholder || "", autocomplete: "off" })
  );
  setChildren(
    $("#ask-fields"),
    fields.map((f, i) => el("label", { class: "field" }, f.label || "", inputs[i]))
  );
  return new Promise((resolve) => {
    const onClose = () => {
      dlg.removeEventListener("close", onClose);
      if (dlg.returnValue !== "ok") return resolve(null);
      if (!fields.length) return resolve(true);
      resolve(Object.fromEntries(inputs.map((i) => [i.name, i.value])));
    };
    dlg.returnValue = "";
    dlg.addEventListener("close", onClose);
    dlg.showModal();
    (inputs[0] || okBtn).focus();
    inputs[0]?.select?.();
  });
}

// ---------------- буфер обмена ----------------
/** navigator.clipboard есть только на https/localhost - с телефона по http нужен запасной путь. */
export async function copyText(text, label = "Скопировано") {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = el("textarea", { style: "position:fixed;top:-1000px;opacity:0" });
      ta.value = text;
      document.body.append(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    toast(label);
    return true;
  } catch {
    toast("Не удалось скопировать", true);
    return false;
  }
}

// ---------------- Markdown + KaTeX + Highlight.js ----------------
marked.setOptions({ gfm: true, breaks: true });

function protectMath(rawText) {
  const codeBlocks = [];
  // Незакрытый ``` во время стриминга тоже считаем кодом, иначе $ внутри него станет формулой
  let text = rawText.replace(/```[\s\S]*?(```|$)|`[^`\n]+`/g, (m) => {
    codeBlocks.push(m);
    return `\x00C${codeBlocks.length - 1}\x00`;
  });
  const math = [];
  const put = (tex, display) => {
    math.push({ tex: tex.trim(), display });
    return `@@M${math.length - 1}@@`;
  };
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, m) => put(m, true));
  text = text.replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => put(m, true));
  text = text.replace(/\\\(([\s\S]+?)\\\)/g, (_, m) => put(m, false));
  // $...$ без захвата цен вроде "$100 и $200"
  text = text.replace(/(^|[^\w$\\])\$([^\s$][^$\n]*?[^\s$]|[^\s$])\$(?![\w$])/g, (_, pre, m) => pre + put(m, false));
  text = text.replace(/\x00C(\d+)\x00/g, (_, i) => codeBlocks[Number(i)]);
  return { text, math };
}

export function renderMarkdown(rawText) {
  if (!rawText) return "";
  const { text, math } = protectMath(rawText);
  let html = DOMPurify.sanitize(marked.parse(text));
  if (math.length && window.katex) {
    html = html.replace(/@@M(\d+)@@/g, (_, i) => {
      const m = math[Number(i)];
      if (!m) return "";
      try {
        return katex.renderToString(m.tex, { displayMode: m.display, throwOnError: false, output: "html" });
      } catch {
        return m.display ? `$$${m.tex}$$` : `$${m.tex}$`;
      }
    });
  }
  const wrap = document.createElement("div");
  wrap.innerHTML = html;
  for (const a of wrap.querySelectorAll("a")) {
    a.target = "_blank";
    a.rel = "noopener noreferrer";
  }
  for (const tbl of wrap.querySelectorAll("table")) {
    const sc = el("div", { class: "table-scroll" });
    tbl.replaceWith(sc);
    sc.append(tbl);
  }
  for (const pre of wrap.querySelectorAll("pre")) {
    const code = pre.querySelector("code");
    if (!code) continue;
    const raw = code.textContent || "";
    const lang = ((code.className || "").match(/language-([\w+#-]+)/) || [])[1]?.toLowerCase() || "";
    if (window.hljs && raw.length < 60000) {
      try {
        code.innerHTML = lang && hljs.getLanguage(lang)
          ? hljs.highlight(raw, { language: lang }).value
          : hljs.highlightAuto(raw).value;
      } catch {}
    }
    const block = el("div", { class: "code-block" });
    const btn = el("button", { type: "button", class: "code-copy-btn" }, icon("copy", 13), el("span", { text: "Копировать" }));
    pre.replaceWith(block);
    block.append(el("div", { class: "code-head" }, el("span", { text: lang || "код" }), btn), pre);
  }
  return wrap.innerHTML;
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest(".code-copy-btn");
  if (!btn) return;
  const code = btn.closest(".code-block")?.querySelector("code")?.textContent ?? "";
  copyText(code, "Код скопирован");
});

// ---------------- разное ----------------
export const CLAUDE_STARBURST_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#D97757" d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z"/></svg>';

export const NEUROHUB_LOGO_SVG =
  '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M10.5 21.5v-11l11 11v-11"/></svg>';

export function fmtTokens(n) {
  if (n == null) return "∞";
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
}

export function fmtTime(ts) {
  return ts ? new Date(ts * 1000).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : "";
}

export function fmtReset(ts, withDay = false) {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  const hhmm = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  if (!withDay) return `в ${hhmm}`;
  const days = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
  return `${days[d.getDay()]} в ${hhmm}`;
}

export function fmtDateTime(ts) {
  if (!ts) return "";
  return new Date(ts * 1000).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function fmtLastSeen(ts) {
  if (!ts) return "ещё не заходил";
  const diff = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (diff < 60) return "только что";
  if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`;
  const d = new Date(ts * 1000);
  const hhmm = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const thatDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((today - thatDay) / 86400000);
  if (days === 0) return `сегодня в ${hhmm}`;
  if (days === 1) return `вчера в ${hhmm}`;
  return `${d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })} в ${hhmm}`;
}

export function lightbox(src) {
  const box = el("div", { class: "lightbox", onclick: () => box.remove() }, el("img", { src, alt: "" }));
  const onKey = (e) => {
    if (e.key === "Escape") {
      box.remove();
      document.removeEventListener("keydown", onKey);
    }
  };
  document.addEventListener("keydown", onKey);
  document.body.append(box);
}

// Тот же порог, что и в styles.css: ниже него боковая панель становится выезжающим меню.
export const isMobile = () => window.matchMedia("(max-width: 900px)").matches;
