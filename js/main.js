// точка входа: бренд (NeuroHub / Claude), сворачиваемый сайдбар, меню профиля, вкладки настроек, бан и квоты
import { api, auth, resolveApiBase } from "./api.js";
import {
  $, $$, el, toast, fmtReset, fmtDateTime, hydrateIcons, setIcon, isMobile, copyText, ask,
  CLAUDE_STARBURST_SVG, NEUROHUB_LOGO_SVG,
} from "./ui.js";
import { initChat, loadChats, newChat, setChatRole, getSelectedModel } from "./chat.js";
import { initAdmin, loadAdmin } from "./admin.js";
import { initImage, loadImageMode } from "./image.js";
import { initVoice, loadVoiceMode, stopCall } from "./voice.js";
import { initAgents, loadAgentsMode, stopArena } from "./agents.js";
import { initYolo, stopYolo } from "./yolo.js";
import { initStems, loadStemsMode } from "./stems.js";

const TITLES = { chat: "Чат", image: "Картинки", voice: "Звонок", agents: "Агенты", yolo: "Зрение", stems: "Стемы", admin: "Админка" };
const state = { user: null, aiLocked: false, setupMode: false, mode: null, status: null, usage: null, statusTimer: 0 };

const FAVICON_NH =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='9' fill='%232e7d5b'/%3E%3Cpath d='M10.5 21.5v-11l11 11v-11' stroke='white' stroke-width='2.6' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E";
const FAVICON_CLAUDE = $("#favicon")?.getAttribute("href") || "";

hydrateIcons();
$$("[data-claude-mark]").forEach((n) => (n.innerHTML = CLAUDE_STARBURST_SVG));

function defaultHostBrand() {
  const q = new URLSearchParams(location.search).get("brand");
  if (q === "neurohub" || q === "claude") return q;
  if (q === "klodeg") return "claude";
  const isLocal = /^(localhost|127\.|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname) || !location.hostname;
  return isLocal ? "neurohub" : "claude";
}

function timeGreeting() {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return "Доброе утро";
  if (h >= 12 && h < 18) return "Добрый день";
  if (h >= 18 && h < 23) return "Добрый вечер";
  return "Доброй ночи";
}

function applyBrand(brand, persist = false) {
  const isClaude = brand === "claude" || brand === "klodeg";
  const key = isClaude ? "claude" : "neurohub";
  document.documentElement.dataset.brand = key;
  if (persist) {
    try { localStorage.setItem("nh_brand", key); } catch {}
  }
  const title = isClaude ? "Claude" : "NeuroHub";
  document.title = title;
  const fav = $("#favicon");
  if (fav) fav.setAttribute("href", isClaude ? FAVICON_CLAUDE : FAVICON_NH);
  $$("[data-brand-logo]").forEach((n) => (n.innerHTML = isClaude ? CLAUDE_STARBURST_SVG : NEUROHUB_LOGO_SVG));
  $$("[data-brand-name]").forEach((n) => (n.textContent = title));
  $("#hello-lead").textContent = isClaude ? timeGreeting() : "Привет";
  $("#empty-sub").textContent = isClaude
    ? "Чем могу помочь сегодня?"
    : "Чем займёмся? Можно приложить фото, PDF или код.";
  $("#composer-hint").textContent = isClaude
    ? "Claude может ошибаться. Проверяйте важную информацию."
    : "ИИ работает без цензуры и может ошибаться";
}

applyBrand(document.documentElement.dataset.brand || defaultHostBrand());

// ---------------- высота экрана и клавиатура ----------------
const vv = window.visualViewport;
let fullHeight = 0;

function isTyping() {
  const a = document.activeElement;
  if (!a) return false;
  if (a.tagName === "TEXTAREA" || a.isContentEditable) return true;
  return a.tagName === "INPUT" && !["checkbox", "radio", "range", "file", "button", "submit"].includes(a.type);
}

function fitViewport() {
  if (vv && vv.scale > 1.01) return;
  const root = document.documentElement;
  const h = vv ? vv.height : window.innerHeight;
  const top = vv ? vv.offsetTop : 0;
  fullHeight = Math.max(fullHeight, h);
  root.style.setProperty("--vh", `${Math.round(h)}px`);
  root.style.setProperty("--vv-top", `${Math.round(top)}px`);
  root.style.setProperty("--kb-h", `${Math.max(0, Math.round(root.clientHeight - h - top))}px`);
  root.classList.toggle("kb", isTyping() && h < fullHeight - 120);
}

if (vv) {
  vv.addEventListener("resize", fitViewport);
  // auteur-allow: RAW_SCROLL_LISTENER -- это сдвиг visualViewport при открытой клавиатуре iOS; IntersectionObserver его не видит
  vv.addEventListener("scroll", fitViewport);
}
window.addEventListener("resize", fitViewport);
window.addEventListener("orientationchange", () => {
  fullHeight = 0;
  setTimeout(fitViewport, 300);
});
document.addEventListener("focusin", () => setTimeout(fitViewport, 50));
document.addEventListener("focusout", () =>
  setTimeout(() => {
    if (!isTyping()) window.scrollTo(0, 0);
    fitViewport();
  }, 80)
);
fitViewport();

// ---------------- тема (светлая / тёмная / системная с мягким переходом) ----------------
function savedThemePref() {
  const t = localStorage.getItem("nh_theme");
  return t === "light" || t === "dark" ? t : "system";
}
function effectiveTheme() {
  const t = document.documentElement.dataset.theme;
  if (t === "light" || t === "dark") return t;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
function syncThemeControls() {
  const pref = savedThemePref();
  setIcon($("#btn-theme"), effectiveTheme() === "dark" ? "sun" : "moon");
  $$("[data-theme-val]").forEach((btn) => {
    btn.setAttribute("aria-pressed", String(btn.dataset.themeVal === pref));
  });
}
function setThemePref(pref) {
  const root = document.documentElement;
  root.classList.add("theme-switching");
  if (pref === "light" || pref === "dark") {
    root.dataset.theme = pref;
    try { localStorage.setItem("nh_theme", pref); } catch {}
  } else {
    delete root.dataset.theme;
    try { localStorage.removeItem("nh_theme"); } catch {}
  }
  syncThemeControls();
  setTimeout(() => root.classList.remove("theme-switching"), 240);
}
$("#btn-theme").addEventListener("click", () => {
  setThemePref(effectiveTheme() === "dark" ? "light" : "dark");
});
$$("[data-theme-val]").forEach((btn) => {
  btn.addEventListener("click", () => setThemePref(btn.dataset.themeVal));
});
syncThemeControls();

// ---------------- боковая панель (мобильная шторка + десктопное сворачивание как в claude.ai) ----------------
export function openSidebar() {
  $("#sidebar").classList.add("open");
  $("#scrim").classList.add("show");
}
export function closeSidebar() {
  $("#sidebar").classList.remove("open");
  $("#scrim").classList.remove("show");
}
function setDesktopCollapsed(collapsed) {
  $("#app").classList.toggle("sidebar-collapsed", collapsed);
  $("#btn-expand-sidebar").classList.toggle("hidden", !collapsed);
  try { localStorage.setItem("nh_side_collapsed", collapsed ? "1" : "0"); } catch {}
}
$("#btn-menu").addEventListener("click", openSidebar);
$("#btn-close-sidebar").addEventListener("click", closeSidebar);
$("#scrim").addEventListener("click", closeSidebar);
$("#btn-new-chat-top").addEventListener("click", () => newChat());
$("#btn-collapse-sidebar").addEventListener("click", () => setDesktopCollapsed(true));
$("#btn-expand-sidebar").addEventListener("click", () => setDesktopCollapsed(false));
if (localStorage.getItem("nh_side_collapsed") === "1" && !isMobile()) {
  setDesktopCollapsed(true);
}

let touchX = null;
$("#sidebar").addEventListener("touchstart", (e) => (touchX = e.touches[0].clientX), { passive: true });
$("#sidebar").addEventListener("touchend", (e) => {
  if (touchX !== null && touchX - e.changedTouches[0].clientX > 60) closeSidebar();
  touchX = null;
});

// ---------------- всплывающие меню (профиль Claude, "+" и выбор модели) ----------------
const accPop = $("#account-popover");
const accBtn = $("#btn-account-menu");

function closeAccountPopover() {
  accPop?.classList.remove("is-open");
  accPop?.setAttribute("aria-hidden", "true");
  accBtn?.setAttribute("aria-expanded", "false");
}

function closePopovers() {
  closeAccountPopover();
  window.dispatchEvent(new CustomEvent("nh:close-popovers"));
}

window.addEventListener("nh:close-popovers", closeAccountPopover);

accBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  const willOpen = !accPop.classList.contains("is-open");
  closePopovers();
  if (willOpen) {
    accPop.classList.add("is-open");
    accPop.setAttribute("aria-hidden", "false");
    accBtn.setAttribute("aria-expanded", "true");
  }
});

accPop?.addEventListener("click", (e) => e.stopPropagation());
document.addEventListener("click", closePopovers);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closePopovers();
});

// ---------------- условия использования ----------------
const tosDlg = $("#tos-dialog");
let tosGateMode = false;

function openTos({ gate = false } = {}) {
  closePopovers();
  tosGateMode = gate;
  $("#tos-title").textContent = gate ? "Добро пожаловать в Claude" : "Условия использования";
  $("#tos-intro").classList.toggle("hidden", !gate);
  $("#tos-document").classList.toggle("hidden", gate);
  $("#tos-close-x").classList.toggle("hidden", gate);
  $("#tos-actions-gate").classList.toggle("hidden", !gate);
  $("#tos-actions-view").classList.toggle("hidden", gate);
  if (!tosDlg.open) tosDlg.showModal();
}

tosDlg.addEventListener("cancel", (e) => {
  if (tosGateMode) e.preventDefault();
});
$("#tos-toggle-link").addEventListener("click", () => {
  $("#tos-document").classList.toggle("hidden");
});
$("#tos-close-x").addEventListener("click", () => tosDlg.close());
$("#tos-ok-btn").addEventListener("click", () => tosDlg.close());
$("#tos-logout-btn").addEventListener("click", logout);
$("#tos-accept-btn").addEventListener("click", async () => {
  const btn = $("#tos-accept-btn");
  btn.disabled = true;
  try {
    await api("/api/me/accept-tos", { method: "POST" });
    if (state.user) state.user.tos_accepted = true;
    tosGateMode = false;
    tosDlg.close();
  } catch (e) {
    toast(e.message, true);
  } finally {
    btn.disabled = false;
  }
});
$("#btn-open-tos").addEventListener("click", () => openTos({ gate: false }));
$("#pop-tos")?.addEventListener("click", () => openTos({ gate: false }));
$("#auth-tos-link").addEventListener("click", () => openTos({ gate: false }));
$("#ban-tos-link").addEventListener("click", () => openTos({ gate: false }));

// ---------------- экран бана и апелляции ----------------
function setBanSubstate(mode) {
  $("#ban-state-suspended").classList.toggle("hidden", mode !== "suspended");
  $("#ban-state-form").classList.toggle("hidden", mode !== "form");
  $("#ban-state-pending").classList.toggle("hidden", mode !== "pending");
  $("#ban-state-closed").classList.toggle("hidden", mode !== "closed");
  const titles = {
    suspended: "Ваш аккаунт приостановлен",
    form: "Запрос проверки аккаунта",
    pending: "Запрос отправлен на проверку",
    closed: "Ваш аккаунт останется закрытым",
  };
  $("#ban-title").textContent = titles[mode] || titles.suspended;
}

function showBanScreen(user) {
  applyBrand("claude", true);
  $("#auth").classList.add("hidden");
  $("#app").classList.add("hidden");
  $("#ban-screen").classList.remove("hidden");
  $("#ban-appeal-error").textContent = "";

  const st = user.ban_status || "suspended";
  if (st === "permanently_closed") {
    setBanSubstate("closed");
  } else if (st === "appeal_pending") {
    $("#ban-pending-text").textContent = user.appeal_text || "";
    $("#ban-pending-time").textContent = user.appeal_at ? `Отправлено: ${fmtDateTime(user.appeal_at)}` : "";
    setBanSubstate("pending");
  } else {
    setBanSubstate("suspended");
  }
}

$("#btn-ban-appeal").addEventListener("click", () => {
  $("#ban-appeal-text").value = "";
  $("#ban-appeal-error").textContent = "";
  setBanSubstate("form");
  $("#ban-appeal-text").focus();
});

$("#btn-ban-cancel").addEventListener("click", () => setBanSubstate("suspended"));

$("#ban-state-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("#ban-appeal-text").value.trim();
  const errEl = $("#ban-appeal-error");
  errEl.textContent = "";
  if (text.length < 5) {
    errEl.textContent = "Напишите хотя бы несколько слов о ситуации.";
    return;
  }
  const btn = $("#btn-ban-submit");
  btn.disabled = true;
  try {
    const r = await api("/api/me/appeal", { method: "POST", body: { text } });
    state.user = r.user;
    showBanScreen(r.user);
  } catch (err) {
    errEl.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

$("#btn-ban-refresh").addEventListener("click", async () => {
  const btn = $("#btn-ban-refresh");
  btn.disabled = true;
  try {
    await enterApp();
  } catch (e) {
    toast(e.message, true);
  } finally {
    btn.disabled = false;
  }
});

function logout() {
  auth.token = null;
  try { localStorage.removeItem("nh_brand"); } catch {}
  location.reload();
}

$("#btn-logout").addEventListener("click", logout);
$("#pop-logout")?.addEventListener("click", logout);
$("#btn-ban-logout").addEventListener("click", logout);

// ---------------- вход ----------------
function showAuth(setup, offline = false) {
  state.setupMode = setup;
  $("#app").classList.add("hidden");
  $("#ban-screen").classList.add("hidden");
  $("#auth").classList.remove("hidden");
  const isClaude = document.documentElement.dataset.brand === "claude";
  $("#auth-hint").textContent = setup
    ? "Первый запуск: придумай логин и пароль администратора."
    : (isClaude ? "Войдите в аккаунт Anthropic" : "Вход в локальный ИИ-хаб");
  $("#auth-submit").textContent = setup ? "Создать администратора" : (isClaude ? "Продолжить" : "Войти");
  $("#auth-offline").classList.toggle("hidden", !offline);
}

$("#auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  $("#auth-error").textContent = "";
  const btn = $("#auth-submit");
  btn.disabled = true;
  try {
    const r = await api(state.setupMode ? "/api/setup" : "/api/auth/login", {
      method: "POST",
      body: { username: f.get("username"), password: f.get("password") },
    });
    auth.token = r.token;
    e.target.reset();
    await enterApp();
  } catch (err) {
    $("#auth-error").textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

$("#auth-retry").addEventListener("click", async () => {
  const btn = $("#auth-retry");
  btn.disabled = true;
  $("#auth-error").textContent = "";
  await resolveApiBase(true);
  await boot();
  btn.disabled = false;
});

window.addEventListener("nh:unauthorized", () => {
  auth.token = null;
  showAuth(false);
});

window.addEventListener("nh:banned", async () => {
  try {
    const data = await api("/api/me");
    state.user = data.user;
    if (state.user.ban_status && state.user.ban_status !== "active") {
      showBanScreen(state.user);
    }
  } catch {}
});

// ---------------- приложение ----------------
async function enterApp() {
  const data = await api("/api/me");
  state.user = data.user;

  if (state.user.ban_status && state.user.ban_status !== "active") {
    showBanScreen(state.user);
    return;
  }

  const isAdmin = state.user.role === "admin";
  setChatRole(state.user.role);
  applyBrand(isAdmin ? "neurohub" : "claude", true);

  $("#auth").classList.add("hidden");
  $("#ban-screen").classList.add("hidden");
  $("#app").classList.remove("hidden");

  $$("[data-perm]").forEach((b) => b.classList.toggle("hidden", !state.user.perms[b.dataset.perm]));
  $$("[data-admin]").forEach((b) => b.classList.toggle("hidden", !isAdmin));
  syncApiTabVisibility();

  // в режиме Claude скрываем панель режимов NeuroHub, если у гостя нет спец-доступов (картинки/звонок/зрение/стемы)
  const hasExtraModes = isAdmin || state.user.perms.image || state.user.perms.voice || state.user.perms.yolo || state.user.perms.stems;
  $("#modes-nav").classList.toggle("hidden", !hasExtraModes);

  const activeModel = getSelectedModel();
  const initial = state.user.username.slice(0, 1).toUpperCase();
  $("#profile-name").textContent = state.user.username;
  $("#profile-role").textContent = isAdmin ? "администратор" : activeModel.full_name;
  $("#avatar").textContent = initial;
  $("#profile-name-claude").textContent = state.user.username;
  $("#avatar-claude").textContent = initial;
  $("#pop-username").textContent = state.user.username;
  const planSub = $("#pop-plan-sub");
  if (planSub) planSub.textContent = `План Pro · ${activeModel.full_name}`;
  $("#hello-name").textContent = `, ${state.user.username}`;
  updateUsage(data.usage);
  updateLock(data.ai_locked);

  let start = (location.hash || "").slice(1) || localStorage.getItem("nh_mode") || "chat";
  const btn = $(`.mode-btn[data-mode="${start}"]`);
  if (!btn || btn.classList.contains("hidden") || !hasExtraModes) start = "chat";
  setMode(start);
  await loadChats();
  refreshStatus();

  if (isAdmin && start !== "admin") refreshAppealsBadge();
  if (!isAdmin && !state.user.tos_accepted) {
    openTos({ gate: true });
  }
}

async function refreshAppealsBadge() {
  try {
    const list = await api("/api/admin/appeals");
    const pending = list.filter((u) => u.ban_status === "appeal_pending").length;
    const badge = $("#admin-appeals-badge");
    badge.textContent = String(pending);
    badge.classList.toggle("hidden", pending === 0);
  } catch {}
}

export function setMode(mode) {
  if (state.mode === mode) return closeSidebar();
  if (state.mode === "voice") stopCall();
  if (state.mode === "agents") stopArena();
  if (state.mode === "yolo") stopYolo();
  closeSidebar();
  closePopovers();

  state.mode = mode;
  try { localStorage.setItem("nh_mode", mode); } catch {}
  history.replaceState(null, "", mode === "chat" ? location.pathname : `#${mode}`);
  $$(".mode-btn").forEach((b) =>
    b.dataset.mode === mode ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current")
  );
  $$(".view").forEach((v) => v.classList.toggle("hidden", v.dataset.view !== mode));
  $("#btn-new-chat-top").classList.toggle("hidden", mode !== "chat");
  if (mode !== "chat") $("#topbar-title").textContent = TITLES[mode];
  else window.dispatchEvent(new CustomEvent("nh:chat-shown"));

  if (mode === "admin") loadAdmin(state.user, state.aiLocked);
  else if (mode === "image") loadImageMode();
  else if (mode === "voice") loadVoiceMode();
  else if (mode === "agents") loadAgentsMode(state.user);
  else if (mode === "stems") loadStemsMode();
}

$$(".mode-btn").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
window.addEventListener("hashchange", () => {
  const m = location.hash.slice(1) || "chat";
  const b = $(`.mode-btn[data-mode="${m}"]`);
  if (state.user && b && !b.classList.contains("hidden")) setMode(m);
});
window.addEventListener("nh:open-chat-mode", () => {
  if (state.mode !== "chat") setMode("chat");
  else closeSidebar();
});
window.addEventListener("nh:appeals-updated", refreshAppealsBadge);

// ---------------- квоты (плавный 60fps слив во время генерации) и статус ----------------
const quotaAnim = {
  cur5h: null,
  curWeek: null,
  target5h: 0,
  targetWeek: 0,
  draining: false,
  raf: 0,
};

function quotaFillClass(pct, base = "quota-fill") {
  if (pct >= 100) return `${base} full`;
  if (pct >= 80) return `${base} warn`;
  return base;
}

function fmtPctText(val, live) {
  const clamped = Math.max(0, Math.min(100, val));
  if (live) return `${clamped.toFixed(1)}%`;
  return `${Math.round(clamped)}%`;
}

function applyQuotaVisuals(p5, pw) {
  const u = state.usage;
  if (!u) return;
  const live = quotaAnim.draining;
  if (u.limit_5h != null) {
    const r5 = u.reset_5h ? `сброс ${fmtReset(u.reset_5h, false)}` : "свободно";
    $("#q-5h-label").textContent = `${fmtPctText(p5, live)} · ${r5}`;
    const f5 = $("#q-5h-fill");
    f5.className = quotaFillClass(p5);
    f5.style.setProperty("--p", String(Math.min(1, p5 / 100)));
  }
  if (u.limit_week != null) {
    const rw = u.reset_week ? `сброс ${fmtReset(u.reset_week, true)}` : "свободно";
    $("#q-week-label").textContent = `${fmtPctText(pw, live)} · ${rw}`;
    const fw = $("#q-week-fill");
    fw.className = quotaFillClass(pw);
    fw.style.setProperty("--p", String(Math.min(1, pw / 100)));
  }
  const pill = $("#topbar-quota");
  if (pill && !pill.classList.contains("hidden")) {
    const mainP = u.limit_5h != null ? p5 : pw;
    const lqFill = $("#lq-fill");
    lqFill.className = quotaFillClass(mainP, "lq-fill");
    lqFill.style.setProperty("--p", String(Math.min(1, mainP / 100)));
    $("#lq-label").textContent = fmtPctText(mainP, live);
    pill.classList.toggle("warn", mainP >= 80 && mainP < 100);
    pill.classList.toggle("full", mainP >= 100);
  }
  // обновляем полосы в открытых настройках на месте без перестройки DOM
  const s5Fill = $("#settings-q-5h-fill");
  if (s5Fill) {
    s5Fill.className = quotaFillClass(p5);
    s5Fill.style.setProperty("--p", String(Math.min(1, p5 / 100)));
    const s5Lbl = $("#settings-q-5h-pct");
    if (s5Lbl) s5Lbl.textContent = `${fmtPctText(p5, live)} использовано`;
  }
  const swFill = $("#settings-q-week-fill");
  if (swFill) {
    swFill.className = quotaFillClass(pw);
    swFill.style.setProperty("--p", String(Math.min(1, pw / 100)));
    const swLbl = $("#settings-q-week-pct");
    if (swLbl) swLbl.textContent = `${fmtPctText(pw, live)} использовано`;
  }
}

function stepQuotaAnim() {
  quotaAnim.raf = 0;
  const d5 = quotaAnim.target5h - quotaAnim.cur5h;
  const dw = quotaAnim.targetWeek - quotaAnim.curWeek;
  const settled = Math.abs(d5) < 0.025 && Math.abs(dw) < 0.025;
  if (settled) {
    quotaAnim.cur5h = quotaAnim.target5h;
    quotaAnim.curWeek = quotaAnim.targetWeek;
    applyQuotaVisuals(quotaAnim.cur5h, quotaAnim.curWeek);
    return;
  }
  quotaAnim.cur5h += d5 * 0.14;
  quotaAnim.curWeek += dw * 0.14;
  applyQuotaVisuals(quotaAnim.cur5h, quotaAnim.curWeek);
  quotaAnim.raf = requestAnimationFrame(stepQuotaAnim);
}

function setQuotaDraining(on) {
  const next = Boolean(on);
  if (quotaAnim.draining === next) return;
  quotaAnim.draining = next;
  $("#quota-box")?.classList.toggle("is-draining", next);
  $("#topbar-quota")?.classList.toggle("is-draining", next);
  $("#settings-usage-card")?.classList.toggle("is-draining", next);
  if (state.usage && quotaAnim.cur5h !== null) {
    applyQuotaVisuals(quotaAnim.cur5h, quotaAnim.curWeek);
  }
}

function renderUsageSettingsCard(u) {
  const host = $("#settings-usage-card");
  if (!host) return;
  host.classList.toggle("is-draining", quotaAnim.draining);
  if (state.user?.role === "admin" || !u || (u.limit_5h == null && u.limit_week == null)) {
    host.replaceChildren(el("p", { class: "hint", text: "Для этого аккаунта лимиты использования не ограничены." }));
    return;
  }
  const p5 = u.pct_5h_exact ?? u.pct_5h ?? 0;
  const pw = u.pct_week_exact ?? u.pct_week ?? 0;
  const rows = [];
  if (u.limit_5h != null) {
    const fill = el("div", { id: "settings-q-5h-fill", class: quotaFillClass(p5) });
    fill.style.setProperty("--p", String(Math.min(1, p5 / 100)));
    rows.push(
      el(
        "div",
        { class: "usage-item" },
        el(
          "div",
          { class: "usage-item-head" },
          el("div", {}, el("strong", { text: "Текущая сессия" }), el("span", { class: "hint", text: u.reset_5h ? `Сбросится ${fmtReset(u.reset_5h, false)}` : "Окно 5 часов ещё не начато" })),
          el("span", { id: "settings-q-5h-pct", class: "usage-pct", text: `${fmtPctText(p5, quotaAnim.draining)} использовано` })
        ),
        el("div", { class: "quota-track lg" }, fill)
      )
    );
  }
  if (u.limit_week != null) {
    const fill = el("div", { id: "settings-q-week-fill", class: quotaFillClass(pw) });
    fill.style.setProperty("--p", String(Math.min(1, pw / 100)));
    rows.push(
      el(
        "div",
        { class: "usage-item" },
        el(
          "div",
          { class: "usage-item-head" },
          el("div", {}, el("strong", { text: "Все модели (неделя)" }), el("span", { class: "hint", text: u.reset_week ? `Сбросится в ${fmtReset(u.reset_week, true)}` : "Недельное окно ещё не начато" })),
          el("span", { id: "settings-q-week-pct", class: "usage-pct", text: `${fmtPctText(pw, quotaAnim.draining)} использовано` })
        ),
        el("div", { class: "quota-track lg" }, fill)
      )
    );
  }
  host.replaceChildren(...rows);
}

function updateUsage(u, { live = false } = {}) {
  state.usage = u;
  const box = $("#quota-box");
  const pill = $("#topbar-quota");
  const banner = $("#quota-banner");
  const isAdmin = state.user?.role === "admin";
  if (!u || isAdmin || (u.limit_5h == null && u.limit_week == null)) {
    box.classList.add("hidden");
    pill?.classList.add("hidden");
    banner.classList.add("hidden");
    renderUsageSettingsCard(u);
    return;
  }

  box.classList.remove("hidden");
  pill?.classList.remove("hidden");
  const row5 = $("#quota-row-5h");
  const rowW = $("#quota-row-week");
  row5.classList.toggle("hidden", u.limit_5h == null);
  rowW.classList.toggle("hidden", u.limit_week == null);

  if (live) setQuotaDraining(true);

  const next5 = Number(u.pct_5h_exact ?? u.pct_5h ?? 0);
  const nextW = Number(u.pct_week_exact ?? u.pct_week ?? 0);
  quotaAnim.target5h = next5;
  quotaAnim.targetWeek = nextW;
  if (quotaAnim.cur5h === null) {
    quotaAnim.cur5h = next5;
    quotaAnim.curWeek = nextW;
    renderUsageSettingsCard(u);
    applyQuotaVisuals(next5, nextW);
  } else {
    if (!live) renderUsageSettingsCard(u);
    if (!quotaAnim.raf) quotaAnim.raf = requestAnimationFrame(stepQuotaAnim);
  }

  if (!live) {
    if (u.blocked_by === "week") {
      banner.textContent = `Недельный лимит исчерпан. Доступ восстановится в ${fmtReset(u.reset_week, true)}.`;
      banner.classList.remove("hidden");
    } else if (u.blocked_by === "5h") {
      banner.textContent = `Лимит на 5 часов исчерпан. Доступ восстановится ${fmtReset(u.reset_5h, false)}.`;
      banner.classList.remove("hidden");
    } else {
      banner.classList.add("hidden");
    }
  }
}

$("#topbar-quota")?.addEventListener("click", () => openSettings("usage"));

function updateLock(locked, userDisabled = Boolean(state.user?.ai_disabled)) {
  state.aiLocked = locked;
  if (state.user) state.user.ai_disabled = Boolean(userDisabled);
  const isAdmin = state.user?.role === "admin";
  const effectiveLocked = isAdmin ? locked : (locked || Boolean(userDisabled));
  const badge = $("#lock-badge");
  badge.classList.toggle("hidden", !effectiveLocked);
  const text = isAdmin ? "Гости без ИИ" : "ИИ временно закрыт";
  badge.querySelector(".lock-text").textContent = text;
  badge.title = isAdmin ? "Гости сейчас не могут пользоваться ИИ (переключается в админке)" : text;
}

const STATE_TEXT = {
  ready: ["on", "Модель готова"],
  loading: ["warn", "Модель загружается…"],
  paused: ["warn", "Видеокарта занята картинкой"],
  paused_demucs: ["warn", "Видеокарта занята Demucs"],
  offline_managed: ["", "Модель спит"],
  offline: ["off", "Сервер модели выключен"],
};

const INPUT_HINT = {
  ready: "Чем могу помочь сегодня?",
  loading: "Модель загружается, можно писать…",
  paused: "Сервер занят, напишите чуть позже…",
  paused_demucs: "Видеокарта занята разбором аудио (Demucs)…",
  offline_managed: "Напишите сообщение — модель проснётся сама…",
  offline: "Сервер модели выключен…",
};

function scheduleStatusPoll(isLoading) {
  clearTimeout(state.statusTimer);
  // в обычном режиме опрашиваем реже (15 с), чтобы не гонять лишние запросы через туннель
  state.statusTimer = window.setTimeout(() => {
    if (state.user && state.user.ban_status === "active" && !document.hidden) refreshStatus();
    else scheduleStatusPoll(false);
  }, isLoading ? 3500 : 15000);
}

function paintModelLabels() {
  const s = state.status;
  if (!s) return;
  let key = s.llm_state;
  if (s.llm_paused) key = s.llm_pause_reason === "demucs" ? "paused_demucs" : "paused";
  else if (key === "offline" && s.llm_managed) key = "offline_managed";
  const [cls, text] = STATE_TEXT[key] || STATE_TEXT.offline;
  const isClaude = document.documentElement.dataset.brand === "claude";
  // для гостей Claude спящий llama-server просыпается сам по первому запросу, не выдаём техническое "Модель спит"
  const claudeCalm = isClaude && (key === "ready" || key === "offline_managed");
  const effCls = claudeCalm ? "on" : cls;
  const activeModel = getSelectedModel();
  const modelLabel = isClaude ? activeModel.full_name : (s.model || "");
  const pill = $("#model-pill");
  // в режиме Claude прячем лишнюю статусную строку в сайдбаре, пока модель готова - как на claude.ai
  pill.classList.toggle("hidden", claudeCalm);
  pill.querySelector(".dot").className = `dot ${effCls}`;
  pill.querySelector(".model-pill-text").textContent = claudeCalm ? activeModel.full_name : text;
  pill.title = modelLabel;
  const sub = $("#topbar-sub");
  sub.querySelector(".dot").className = `dot ${effCls}`;
  sub.querySelector("span").textContent = claudeCalm ? activeModel.full_name : text;
  sub.title = modelLabel;
  // в мобильном интерфейсе Claude прячем строку статуса, когда модель готова/спит по требованию - шапка остаётся чистой
  sub.classList.toggle("is-quiet-mobile", claudeCalm);
  const planSub = $("#pop-plan-sub");
  if (planSub) planSub.textContent = `План Pro · ${activeModel.full_name}`;
  if (state.user && state.user.role !== "admin") {
    $("#profile-role").textContent = activeModel.full_name;
  }
  $("#input").placeholder = claudeCalm ? "Чем я могу помочь сегодня?" : (INPUT_HINT[key] || INPUT_HINT.ready);
}

async function refreshStatus() {
  let isLoading = false;
  try {
    const s = await api("/api/status");
    state.status = s;
    let key = s.llm_state;
    if (s.llm_paused) key = s.llm_pause_reason === "demucs" ? "paused_demucs" : "paused";
    else if (key === "offline" && s.llm_managed) key = "offline_managed";
    isLoading = key === "loading";
    paintModelLabels();
    updateLock(s.ai_locked, s.user_ai_disabled);
    window.dispatchEvent(new CustomEvent("nh:status", { detail: s }));
  } catch {}
  scheduleStatusPoll(isLoading);
}
window.addEventListener("nh:model-changed", paintModelLabels);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && state.user && state.user.ban_status === "active") refreshStatus();
});
window.addEventListener("nh:refresh-status", refreshStatus);

// ---------------- настройки с вкладками в стиле claude.ai ----------------
const dlg = $("#settings-dialog");
let apiKeyCache = null;

function syncApiTabVisibility() {
  const allowed = Boolean(state.user?.perms?.api);
  const tab = $("#settings-tab-api");
  if (tab) tab.classList.toggle("hidden", !allowed);
  if (!allowed) {
    apiKeyCache = null;
    if ($('.settings-tab[data-tab="api"]')?.getAttribute("aria-selected") === "true") {
      selectSettingsTab("general");
    }
  }
}

window.addEventListener("nh:self-perms-changed", (ev) => {
  if (!state.user?.perms || !ev.detail) return;
  Object.assign(state.user.perms, ev.detail);
  syncApiTabVisibility();
});

function flashCopied(btn) {
  if (!btn) return;
  btn.classList.add("copied");
  clearTimeout(btn._copyTimer);
  btn._copyTimer = setTimeout(() => btn.classList.remove("copied"), 1400);
}

function renderApiSettings(data) {
  apiKeyCache = data;
  $("#api-base-url").value = data.base_url || "";
  const keyIn = $("#api-key-input");
  keyIn.type = "password";
  keyIn.value = data.api_key || "";
  const list = $("#api-models-list");
  list.replaceChildren(
    ...(data.models || []).map((id) => {
      const chip = el("button", {
        type: "button",
        class: "api-model-chip",
        text: id,
        title: `Скопировать ${id}`,
      });
      chip.addEventListener("click", async () => {
        if (await copyText(id, `Скопировано: ${id}`)) flashCopied(chip);
      });
      return chip;
    })
  );
}

async function loadApiKeyTab(force = false) {
  if (!state.user?.perms?.api) return;
  if (apiKeyCache && !force) return renderApiSettings(apiKeyCache);
  $("#api-base-url").value = "Загружаю…";
  try {
    renderApiSettings(await api("/api/me/api-key"));
  } catch (e) {
    $("#api-base-url").value = "";
    toast(e.message, true);
  }
}

$("#btn-copy-api-url")?.addEventListener("click", async (e) => {
  const v = $("#api-base-url").value.trim();
  if (v && v !== "—" && (await copyText(v, "Base URL скопирован"))) flashCopied(e.currentTarget);
});

$("#btn-copy-api-key")?.addEventListener("click", async (e) => {
  const v = $("#api-key-input").value.trim();
  if (v && (await copyText(v, "API Key скопирован"))) flashCopied(e.currentTarget);
});

$("#btn-toggle-api-key")?.addEventListener("click", () => {
  const inp = $("#api-key-input");
  inp.type = inp.type === "password" ? "text" : "password";
});

$("#btn-rotate-api-key")?.addEventListener("click", async () => {
  const ok = await ask({
    title: "Перевыпустить API Key?",
    text: "Старый ключ сразу перестанет работать. В подключённых клиентах нужно будет указать новый.",
    ok: "Перевыпустить",
    danger: true,
  });
  if (!ok) return;
  const btn = $("#btn-rotate-api-key");
  btn.disabled = true;
  try {
    renderApiSettings(await api("/api/me/api-key/rotate", { method: "POST" }));
    toast("Новый API-ключ создан");
  } catch (e) {
    toast(e.message, true);
  } finally {
    btn.disabled = false;
  }
});

function selectSettingsTab(tab) {
  if (tab === "api" && !state.user?.perms?.api) tab = "general";
  $$(".settings-tab").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
  $$(".settings-panel").forEach((p) => {
    const match = p.dataset.panel === tab;
    p.classList.toggle("hidden", !match);
    if (match) {
      p.classList.remove("panel-enter");
      void p.offsetWidth;
      p.classList.add("panel-enter");
    }
  });
  if (tab === "api") loadApiKeyTab();
}

$$(".settings-tab").forEach((b) => {
  b.addEventListener("click", () => selectSettingsTab(b.dataset.tab));
});

function openSettings(tab = "general") {
  closePopovers();
  syncApiTabVisibility();
  const f = $("#settings-form");
  f.about_me.value = state.user.about_me || "";
  f.instructions.value = state.user.instructions || "";
  f.style_profile.value = state.user.style_profile || "";
  f.adapt_style.checked = state.user.adapt_style !== false;
  f.old_password.value = f.new_password.value = "";
  f.api_url.value = localStorage.getItem("nh_api") || "";
  $("#settings-error").textContent = "";
  renderUsageSettingsCard(state.usage);
  syncThemeControls();
  selectSettingsTab(tab);
  if (isMobile()) closeSidebar();
  if (!dlg.open) dlg.showModal();
}

$("#btn-settings").addEventListener("click", () => openSettings("general"));
$("#pop-settings")?.addEventListener("click", () => openSettings("general"));
$("#pop-usage")?.addEventListener("click", () => openSettings("usage"));

$("#btn-analyze-style").addEventListener("click", async () => {
  const btn = $("#btn-analyze-style");
  btn.disabled = true;
  const label = btn.lastChild.textContent;
  btn.lastChild.textContent = "Анализирую…";
  try {
    const r = await api("/api/me/analyze-style", { method: "POST" });
    $("#settings-form").style_profile.value = r.style_profile || "Пока мало сообщений для анализа.";
    state.user.style_profile = r.style_profile || "";
    toast("Профиль стиля обновлён");
  } catch (e) {
    toast(e.message, true);
  } finally {
    btn.disabled = false;
    btn.lastChild.textContent = label;
  }
});

$("#settings-save").addEventListener("click", async (e) => {
  e.preventDefault();
  const f = $("#settings-form");
  $("#settings-error").textContent = "";
  try {
    if (f.new_password.value) {
      await api("/api/me/password", {
        method: "PUT",
        body: { old_password: f.old_password.value, new_password: f.new_password.value },
      });
    }
    await api("/api/me/settings", {
      method: "PUT",
      body: {
        about_me: f.about_me.value,
        instructions: f.instructions.value,
        style_profile: f.style_profile.value,
        adapt_style: f.adapt_style.checked,
      },
    });
    Object.assign(state.user, {
      about_me: f.about_me.value,
      instructions: f.instructions.value,
      style_profile: f.style_profile.value,
      adapt_style: f.adapt_style.checked,
    });
    const newApi = f.api_url.value.trim().replace(/\/$/, "");
    if (newApi !== (localStorage.getItem("nh_api") || "")) {
      newApi ? localStorage.setItem("nh_api", newApi) : localStorage.removeItem("nh_api");
      location.reload();
      return;
    }
    dlg.close();
    toast("Настройки сохранены");
  } catch (err) {
    $("#settings-error").textContent = err.message;
  }
});

// ---------------- старт ----------------
initChat({ onUsage: updateUsage, onDraining: setQuotaDraining });
initAdmin({ onLockChange: updateLock });
initImage({ onUsage: updateUsage });
initVoice({ onUsage: updateUsage });
initAgents();
initYolo();
initStems();

async function boot() {
  try {
    await resolveApiBase();
    const s = await api("/api/status");
    if (s.needs_setup) return showAuth(true, false);
    if (!auth.token) return showAuth(false, false);
    await enterApp();
  } catch (e) {
    const isNetwork = !e.status;
    showAuth(false, isNetwork);
    if (!isNetwork) $("#auth-error").textContent = e.message;
  }
}

boot();
