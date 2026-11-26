// режим "Админка": модель, доступ гостей, онлайн-статус, апелляции, живой инспектор чатов, пользователи и квоты
import { api, fileUrl } from "./api.js";
import { $, el, icon, toast, fmtTokens, fmtReset, fmtDateTime, fmtLastSeen, ask, renderMarkdown, lightbox, isMobile } from "./ui.js";

let me = null;
let onLockChange = () => {};
let llmTimer = 0;
let adminTimer = 0;
let inspTimer = 0;
let adminBusy = false;
let inspBusy = false;
let lastUsersKey = "";
let userRefs = new Map();
let inspUser = null;
let inspChatId = null;
let inspChats = [];
let lastInspListKey = "";
let lastInspThreadKey = "";

const LLM_STATE = {
  ready: ["on", "Работает"],
  loading: ["warn", "Загружается"],
  offline: ["", "Выгружена"],
};

const BAN_META = {
  active: ["on", "Активен"],
  suspended: ["err", "Приостановлен"],
  appeal_pending: ["warn", "Апелляция"],
  permanently_closed: ["err", "Закрыт навсегда"],
};

export function initAdmin(opts) {
  onLockChange = opts.onLockChange;
  $("#lock-toggle").addEventListener("change", toggleLock);
  $("#btn-add-user").addEventListener("click", addUser);
  $("#btn-llm-refresh").addEventListener("click", loadLlm);
  $("#btn-llm-start").addEventListener("click", async () => {
    $("#btn-llm-start").disabled = true;
    try {
      await api("/api/admin/llm/start", { method: "POST" });
      toast("Модель загружается…");
      await loadLlm();
      pollLlm();
    } catch (e) {
      $("#btn-llm-start").disabled = false;
      toast(e.message, true);
    }
  });
  $("#btn-llm-stop").addEventListener("click", async () => {
    $("#btn-llm-stop").disabled = true;
    try {
      await api("/api/admin/llm/stop", { method: "POST" });
      clearInterval(llmTimer);
      toast("Модель выгружена, память свободна");
      await loadLlm();
      window.dispatchEvent(new CustomEvent("nh:refresh-status"));
    } catch (e) {
      toast(e.message, true);
      loadLlm();
    }
  });
  const chatsDlg = $("#chats-dialog");
  $("#insp-close").addEventListener("click", () => chatsDlg.close());
  chatsDlg.addEventListener("close", stopInspPoll);
  $("#insp-refresh")?.addEventListener("click", () => refreshInspQuiet(true));
  $("#insp-back")?.addEventListener("click", () => {
    $("#insp-body").dataset.mobileStep = "list";
  });
  $("#insp-ban-btn").addEventListener("click", async () => {
    if (!inspUser) return;
    const isBanned = inspUser.ban_status && inspUser.ban_status !== "active";
    const ok = isBanned
      ? await setBanStatus(inspUser, "active")
      : await suspendPrompt(inspUser);
    if (ok) {
      await openUserChats(inspUser);
      loadAdmin(me, !$("#lock-toggle").checked);
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    if (me && !$(".view-admin").classList.contains("hidden")) refreshAdminQuiet();
    if (chatsDlg.open && inspUser) refreshInspQuiet(false);
  });
}

function presenceText(u) {
  if (u.online) return u.generating ? "Онлайн · печатает…" : "Онлайн";
  return u.last_seen ? `Был(а): ${fmtLastSeen(u.last_seen)}` : "Ещё не заходил";
}

function applyPresence(node, u) {
  if (!node) return;
  const on = Boolean(u.online);
  node.className = `user-presence${on ? " online" : ""}`;
  node.replaceChildren(el("i", { class: `dot${on ? " on" : ""}` }), el("span", { text: presenceText(u) }));
}

function usageTexts(us) {
  const u5 = `5 ч: ${fmtTokens(us.used_5h)}${us.limit_5h != null ? ` / ${fmtTokens(us.limit_5h)} (${us.pct_5h}%)` : ""}${us.reset_5h ? ` · сброс ${fmtReset(us.reset_5h)}` : ""}`;
  const uw = `Неделя: ${fmtTokens(us.used_week)}${us.limit_week != null ? ` / ${fmtTokens(us.limit_week)} (${us.pct_week}%)` : ""}${us.reset_week ? ` · сброс ${fmtReset(us.reset_week, true)}` : ""}`;
  return [u5, uw];
}

function startAdminPoll() {
  clearInterval(adminTimer);
  // мягкое фоновое обновление онлайна, счётчиков чатов, квот и апелляций без перезагрузки страницы
  adminTimer = setInterval(() => {
    if ($(".view-admin").classList.contains("hidden")) {
      clearInterval(adminTimer);
      adminTimer = 0;
      return;
    }
    if (!document.hidden) refreshAdminQuiet();
  }, 5000);
}

async function refreshAdminQuiet() {
  if (!me || adminBusy) return;
  adminBusy = true;
  try {
    const users = await api("/api/admin/users");
    renderAppeals(users);
    syncUsers(users);
    window.dispatchEvent(new CustomEvent("nh:appeals-updated"));
  } catch {
    // тихий фоновый опрос не спамит тостами при кратковременном обрыве
  } finally {
    adminBusy = false;
  }
}

export async function loadAdmin(currentUser, aiLocked) {
  me = currentUser;
  setLocked(aiLocked);
  loadLlm().then((st) => {
    if (st === "loading") pollLlm();
  });
  startAdminPoll();
  try {
    const users = await api("/api/admin/users");
    renderAppeals(users);
    syncUsers(users, true);
    window.dispatchEvent(new CustomEvent("nh:appeals-updated"));
  } catch (e) {
    toast(e.message, true);
  }
}

function pollLlm() {
  clearInterval(llmTimer);
  let n = 0;
  llmTimer = setInterval(async () => {
    if ($(".view-admin").classList.contains("hidden")) {
      clearInterval(llmTimer);
      return;
    }
    const st = await loadLlm();
    ++n;
    // на первых 2 тиках не обрываем опрос, если llama-server ещё только стартует
    if (st === "ready" || (st === "offline" && n >= 2) || n > 240) {
      clearInterval(llmTimer);
      window.dispatchEvent(new CustomEvent("nh:refresh-status"));
    }
  }, 2000);
}

async function loadLlm() {
  try {
    const d = await api("/api/admin/llm");
    const key = d.paused ? (d.pause_reason === "demucs" ? "paused_demucs" : "paused") : d.state;
    const [cls, text] = key === "paused_demucs"
      ? ["warn", "Пауза: Demucs в VRAM"]
      : key === "paused"
        ? ["warn", "Пауза: рисуется картинка"]
        : LLM_STATE[key] || LLM_STATE.offline;
    const tag = $("#llm-state");
    tag.className = `status-tag ${cls}`;
    tag.textContent = text;
    const mins = Math.floor((d.uptime || 0) / 60);
    const secs = (d.uptime || 0) % 60;
    const ramGb = d.rss_mib != null ? ` · в ОЗУ ${(d.rss_mib / 1024).toFixed(1)} ГБ` : "";
    const suffix = d.state === "ready" && d.uptime
      ? ` · работает ${mins || 1} мин${ramGb}`
      : d.state === "loading"
        ? ` · грузится ${mins ? `${mins} мин ` : ""}${secs} с${ramGb} (первый старт с SSD ~1–1.5 мин)`
        : "";
    $("#llm-model-name").textContent = d.model + suffix;
    $("#llm-problem").textContent = d.problem || (d.state === "offline" && d.last_error ? d.last_error : "");
    $("#llm-cmd").textContent = d.cmd || "";
    $("#llm-log").textContent = d.log || "Лог пуст: модель ещё не запускалась.";
    $("#btn-llm-start").disabled = !d.managed || d.state !== "offline" || Boolean(d.problem);
    $("#btn-llm-stop").disabled = !d.managed || d.state === "offline";
    return d.state;
  } catch (e) {
    toast(e.message, true);
  }
}

function setLocked(v) {
  $("#lock-toggle").checked = !v;
  $("#lock-text").textContent = v
    ? "Сейчас ИИ отвечает только администраторам. Гости видят интерфейс, но запросы не проходят."
    : "Гости могут пользоваться ИИ в рамках своих лимитов.";
  onLockChange(v);
}

async function toggleLock() {
  const locked = !$("#lock-toggle").checked;
  try {
    const r = await api("/api/admin/lock", { method: "POST", body: { locked } });
    setLocked(r.ai_locked);
    toast(r.ai_locked ? "Доступ гостей закрыт" : "Доступ гостей открыт");
  } catch (e) {
    toast(e.message, true);
    setLocked(!locked);
  }
}

async function patch(user, body) {
  try {
    Object.assign(user, await api(`/api/admin/users/${user.id}`, { method: "PATCH", body }));
    toast("Сохранено");
    return true;
  } catch (e) {
    toast(e.message, true);
    return false;
  }
}

async function setBanStatus(user, status, reason = null) {
  try {
    const body = reason !== null ? { status, reason } : { status };
    Object.assign(user, await api(`/api/admin/users/${user.id}/ban`, { method: "POST", body }));
    const labels = {
      active: `Приостановка для ${user.username} отозвана`,
      suspended: `Аккаунт ${user.username} приостановлен`,
      permanently_closed: `Аккаунт ${user.username} закрыт навсегда`,
    };
    toast(labels[status] || "Статус обновлён");
    return true;
  } catch (e) {
    toast(e.message, true);
    return false;
  }
}

async function suspendPrompt(user) {
  const r = await ask({
    title: `Приостановить ${user.username}?`,
    text: "Пользователь увидит экран приостановки Claude и сможет отправить апелляцию.",
    ok: "Приостановить",
    danger: true,
    fields: [{ name: "reason", label: "Заметка для себя (пользователь её не увидит)", placeholder: "например: нарушение устных правил" }],
  });
  if (!r) return false;
  return setBanStatus(user, "suspended", r.reason || "");
}

function renderAppeals(users) {
  const pending = users.filter((u) => u.ban_status === "appeal_pending");
  const card = $("#appeals-card");
  card.classList.toggle("hidden", pending.length === 0);
  $("#appeals-count").textContent = String(pending.length);
  if (!pending.length) return;

  $("#appeals-list").replaceChildren(
    ...pending.map((u) =>
      el(
        "div",
        { class: "appeal-card" },
        el(
          "div",
          { class: "appeal-meta" },
          el("div", { class: "row" }, el("strong", { text: u.username }), u.ban_reason ? el("span", { class: "hint", text: `· заметка: ${u.ban_reason}` }) : null),
          el("span", { class: "hint", text: u.appeal_at ? fmtDateTime(u.appeal_at) : "" })
        ),
        el("div", { class: "appeal-text", text: u.appeal_text || "(пустое обращение)" }),
        el(
          "div",
          { class: "user-actions" },
          el("button", {
            class: "btn", type: "button",
            onclick: () => openUserChats(u),
          }, icon("chat", 15), `Чаты (${u.chat_count || 0})`),
          el("button", {
            class: "btn primary", type: "button",
            onclick: async () => {
              if (await setBanStatus(u, "active")) loadAdmin(me, !$("#lock-toggle").checked);
            },
          }, icon("check", 15), "Отозвать приостановку"),
          el("button", {
            class: "btn danger", type: "button",
            onclick: async () => {
              if (!(await ask({
                title: `Отклонить запрос ${u.username}?`,
                text: "У пользователя появится экран «Ваш аккаунт останется закрытым» без повторной апелляции.",
                ok: "Закрыть навсегда",
                danger: true,
              }))) return;
              if (await setBanStatus(u, "permanently_closed")) loadAdmin(me, !$("#lock-toggle").checked);
            },
          }, icon("lock", 15), "Закрыть навсегда")
        )
      )
    )
  );
}

function permSwitch(u, perm, label, allowAdminToggle = false) {
  const admin = u.role === "admin";
  const box = el("input", {
    type: "checkbox",
    checked: allowAdminToggle ? Boolean(u.perms[perm]) : (admin || u.perms[perm]),
    disabled: !allowAdminToggle && admin,
  });
  box.addEventListener("change", async () => {
    if (!(await patch(u, { [`perm_${perm}`]: box.checked }))) {
      box.checked = !box.checked;
      return;
    }
    if (allowAdminToggle && me && u.id === me.id) {
      window.dispatchEvent(new CustomEvent("nh:self-perms-changed", { detail: { [perm]: box.checked } }));
    }
  });
  return el("label", { class: "switch" }, box, el("span"), label);
}

function limitField(u, field, label) {
  const input = el("input", { type: "number", min: "0", step: "1000", placeholder: "без лимита", value: u[field] ?? "" });
  input.addEventListener("change", () => {
    const v = input.value.trim();
    patch(u, v === "" ? { [`clear_${field}`]: true } : { [field]: Number(v) });
  });
  return el("label", { class: "field" }, label, input);
}

function syncUsers(users, forceRender = false) {
  const key = users.map((u) => `${u.id}:${u.role}:${u.ban_status || "active"}:${u.ban_reason || ""}`).join("|");
  if (!forceRender && key === lastUsersKey && userRefs.size === users.length) {
    // обновляем онлайн, счётчик чатов, квоты и статус на месте - без потери фокуса и состояния спойлеров
    for (const u of users) {
      const ref = userRefs.get(u.id);
      if (!ref) continue;
      Object.assign(ref.user, u);
      applyPresence(ref.presenceEl, u);
      const [u5, uw] = usageTexts(u.usage);
      ref.u5El.textContent = u5;
      ref.uwEl.textContent = uw;
      ref.chatBtnText.textContent = `Чаты (${u.chat_count || 0})`;
      const st = u.ban_status || "active";
      const isBanned = st !== "active";
      const aiOff = u.role !== "admin" && Boolean(u.ai_disabled);
      if (ref.statusBadge && !isBanned) {
        ref.statusBadge.className = `status-tag ${aiOff ? "warn" : "on"}`;
        ref.statusBadge.textContent = aiOff ? "ИИ выкл." : "Активен";
      }
      if (ref.aiBox && document.activeElement !== ref.aiBox) {
        ref.aiBox.checked = !u.ai_disabled;
        ref.aiHint.textContent = u.ai_disabled ? "Без бана · запросы заблокированы" : "Может писать в чат";
        ref.aiHint.classList.toggle("off", Boolean(u.ai_disabled));
      }
    }
    return;
  }
  const openSet = new Set();
  for (const [uid, ref] of userRefs.entries()) {
    if (ref.moreDetails?.open) openSet.add(uid);
  }
  lastUsersKey = key;
  renderUsers(users, openSet);
}

function renderUsers(users, openSet = null) {
  const desktop = !isMobile();
  userRefs = new Map();
  $("#users").replaceChildren(
    ...users.map((u) => {
      const self = u.id === me.id;
      const role = el(
        "select",
        { disabled: self, "aria-label": `Роль ${u.username}` },
        el("option", { value: "user", text: "гость (Claude)" }),
        el("option", { value: "admin", text: "админ (NeuroHub)" })
      );
      role.value = u.role;
      role.addEventListener("change", async () => {
        if (await patch(u, { role: role.value })) loadAdmin(me, !$("#lock-toggle").checked);
      });
      const st = u.ban_status || "active";
      const [baseCls, baseLabel] = BAN_META[st] || BAN_META.suspended;
      const isBanned = st !== "active";
      const isGuest = u.role !== "admin";
      const aiOff = isGuest && Boolean(u.ai_disabled);
      const stCls = !isBanned && aiOff ? "warn" : baseCls;
      const stLabel = !isBanned && aiOff ? "ИИ выкл." : baseLabel;
      const statusBadge = !self ? el("span", { class: `status-tag ${stCls}`, text: stLabel }) : null;
      const presenceEl = el("span", { class: "user-presence" });
      applyPresence(presenceEl, u);
      const [u5Text, uwText] = usageTexts(u.usage);
      const u5El = el("span", { text: u5Text });
      const uwEl = el("span", { text: uwText });

      // выборочный тумблер доступа к ИИ без бана (как глобальный "Разрешить ИИ гостям", но на одного человека)
      let aiToggleRow = null;
      let aiBox = null;
      let aiHint = null;
      if (isGuest && !self) {
        aiBox = el("input", { type: "checkbox", checked: !u.ai_disabled });
        aiHint = el("span", {
          class: `user-ai-hint${u.ai_disabled ? " off" : ""}`,
          text: u.ai_disabled ? "Без бана · запросы заблокированы" : "Может писать в чат",
        });
        aiBox.addEventListener("change", async () => {
          const disabled = !aiBox.checked;
          if (!(await patch(u, { ai_disabled: disabled }))) {
            aiBox.checked = !disabled;
            return;
          }
          u.ai_disabled = disabled;
          aiHint.textContent = disabled ? "Без бана · запросы заблокированы" : "Может писать в чат";
          aiHint.classList.toggle("off", disabled);
          if (statusBadge && !isBanned) {
            statusBadge.className = `status-tag ${disabled ? "warn" : "on"}`;
            statusBadge.textContent = disabled ? "ИИ выкл." : "Активен";
          }
        });
        aiToggleRow = el(
          "div",
          { class: "user-ai-row" },
          el("label", { class: "switch" }, aiBox, el("span"), "Доступ к ИИ"),
          aiHint
        );
      }

      const chatBtnText = el("span", { text: `Чаты (${u.chat_count || 0})` });
      // быстрые главные действия всегда на виду (на телефоне удобно нажимать одной рукой)
      const quickActions = el(
        "div",
        { class: "user-quick-actions" },
        el("button", {
          class: "btn", type: "button",
          onclick: () => openUserChats(u),
        }, icon("chat", 16), chatBtnText),
        self ? null : (
          isBanned
            ? el("button", {
                class: "btn primary", type: "button",
                onclick: async () => {
                  if (await setBanStatus(u, "active")) loadAdmin(me, !$("#lock-toggle").checked);
                },
              }, icon("play", 16), "Отозвать бан")
            : el("button", {
                class: "btn danger", type: "button",
                onclick: async () => {
                  if (await suspendPrompt(u)) loadAdmin(me, !$("#lock-toggle").checked);
                },
              }, icon("lock", 16), "Приостановить")
        )
      );

      // второстепенные настройки на телефоне свёрнуты в аккордеон, на ПК открыты сразу
      const detailsOpen = openSet && openSet.size ? openSet.has(u.id) : desktop;
      const moreDetails = el(
        "details",
        { class: "more user-more", open: detailsOpen },
        el("summary", { text: "Права, лимиты и управление" }),
        el(
          "div",
          { class: "more-body" },
          el("label", { class: "field user-role-field" }, "Роль", role),
          el(
            "div",
            { class: "user-perms" },
            permSwitch(u, "image", "Картинки"),
            permSwitch(u, "voice", "Звонок"),
            permSwitch(u, "yolo", "Зрение"),
            permSwitch(u, "stems", "Стемы"),
            permSwitch(u, "api", "Отображение и доступ к API", true)
          ),
          el(
            "div",
            { class: "user-limits" },
            limitField(u, "limit_5h", "Лимит за 5 ч"),
            limitField(u, "limit_week", "Лимит за неделю")
          ),
          el(
            "div",
            { class: "user-actions" },
            el("button", {
              class: "btn small", type: "button",
              onclick: async () => {
                const r = await ask({ title: `Новый пароль для ${u.username}`, fields: [{ name: "pw", type: "text", placeholder: "минимум 4 символа" }], ok: "Сменить" });
                if (r?.pw) patch(u, { password: r.pw });
              },
            }, icon("key", 15), "Пароль"),
            el("button", {
              class: "btn small", type: "button",
              onclick: async () => {
                try {
                  await api(`/api/admin/users/${u.id}/reset-usage`, { method: "POST", body: { scope: "5h" } });
                  toast("5-часовое окно сброшено");
                  loadAdmin(me, !$("#lock-toggle").checked);
                } catch (e) {
                  toast(e.message, true);
                }
              },
            }, icon("refresh", 15), "Сброс 5 ч"),
            el("button", {
              class: "btn small", type: "button",
              onclick: async () => {
                try {
                  await api(`/api/admin/users/${u.id}/reset-usage`, { method: "POST", body: { scope: "all" } });
                  toast("Вся квота сброшена");
                  loadAdmin(me, !$("#lock-toggle").checked);
                } catch (e) {
                  toast(e.message, true);
                }
              },
            }, icon("refresh", 15), "Сброс всего"),
            self ? null : el("button", {
              class: "btn small ghost danger-text", type: "button",
              onclick: async () => {
                if (!(await ask({ title: `Удалить ${u.username}?`, text: "Удалятся и все его чаты. Отменить нельзя.", ok: "Удалить", danger: true }))) return;
                try {
                  await api(`/api/admin/users/${u.id}`, { method: "DELETE" });
                  loadAdmin(me, !$("#lock-toggle").checked);
                } catch (e) {
                  toast(e.message, true);
                }
              },
            }, icon("trash", 15), "Удалить")
          )
        )
      );

      userRefs.set(u.id, { user: u, presenceEl, statusBadge, u5El, uwEl, chatBtnText, aiBox, aiHint, moreDetails });

      return el(
        "div",
        { class: `user-card${isBanned ? " disabled" : ""}` },
        el(
          "div",
          { class: "user-head" },
          el("div", { class: "avatar", text: u.username.slice(0, 1).toUpperCase() }),
          el(
            "div",
            { class: "user-ident" },
            el("strong", { text: u.username }),
            el("span", { class: "muted", text: self ? "админ · это ты" : (u.ban_reason || (u.role === "admin" ? "админ" : "гость")) }),
            presenceEl
          ),
          statusBadge
        ),
        el("div", { class: "user-usage-bar" }, u5El, uwEl),
        aiToggleRow,
        quickActions,
        moreDetails
      );
    })
  );
}

// ---------------- живой инспектор чатов ----------------
function stopInspPoll() {
  clearInterval(inspTimer);
  inspTimer = 0;
}

function startInspPoll() {
  stopInspPoll();
  inspTimer = setInterval(() => {
    const dlg = $("#chats-dialog");
    if (!dlg.open || !inspUser) return stopInspPoll();
    if (!document.hidden) refreshInspQuiet(false);
  }, 3000);
}

function updateInspHeader(u) {
  const isSelf = me && u.id === me.id;
  const st = u.ban_status || "active";
  const [baseCls, baseLabel] = BAN_META[st] || BAN_META.suspended;
  const isBanned = st !== "active";
  const aiOff = u.role !== "admin" && Boolean(u.ai_disabled);
  const badge = $("#insp-status");
  badge.className = `status-tag ${!isBanned && aiOff ? "warn" : baseCls}`;
  badge.textContent = !isBanned && aiOff ? "ИИ выкл." : baseLabel;
  applyPresence($("#insp-presence"), u);
  const banBtn = $("#insp-ban-btn");
  banBtn.classList.toggle("hidden", isSelf);
  banBtn.className = `btn ${st === "active" ? "danger" : "primary"}${isSelf ? " hidden" : ""}`;
  banBtn.textContent = st === "active" ? "Приостановить" : "Отозвать бан";
}

async function openUserChats(user) {
  inspUser = user;
  inspChatId = null;
  inspChats = [];
  lastInspListKey = "";
  lastInspThreadKey = "";
  const dlg = $("#chats-dialog");
  $("#insp-title").textContent = `Чаты: ${user.username}`;
  updateInspHeader(user);

  $("#insp-body").dataset.mobileStep = "list";
  $("#insp-current-title").textContent = "";
  $("#insp-chat-list").replaceChildren(el("p", { class: "hint", text: "Загрузка чатов…" }));
  $("#insp-thread").replaceChildren(el("div", { class: "placeholder" }, icon("chat", 28), el("p", { text: "Выбери чат слева, чтобы прочитать переписку." })));
  if (!dlg.open) dlg.showModal();

  await refreshInspQuiet(false, true);
  startInspPoll();
}

async function refreshInspQuiet(manual = false, isInitial = false) {
  if (!inspUser || inspBusy) return;
  const uid = inspUser.id;
  inspBusy = true;
  try {
    const data = await api(`/api/admin/users/${uid}/chats`);
    if (!inspUser || inspUser.id !== uid) return;
    if (data.user) {
      inspUser = { ...inspUser, ...data.user };
      updateInspHeader(inspUser);
    }
    inspChats = data.chats || [];
    if (!inspChats.length) {
      if (lastInspListKey !== "EMPTY") {
        lastInspListKey = "EMPTY";
        $("#insp-chat-list").replaceChildren(el("p", { class: "hint", text: "У пользователя пока нет чатов." }));
      }
      return;
    }
    // если на ПК чат ещё не выбран (первый вход или пользователь только создал первый чат), открываем верхний
    if (!inspChatId && !isMobile()) {
      await loadInspChat(inspChats[0].id, inspChats, { silent: !isInitial });
    } else {
      renderInspChatList(inspChats);
      if (inspChatId && inspChats.some((c) => c.id === inspChatId)) {
        const active = inspChats.find((c) => c.id === inspChatId);
        if (active) $("#insp-current-title").textContent = active.title;
        await loadInspChat(inspChatId, inspChats, { silent: true });
      }
    }
    if (manual) toast("Чаты обновлены");
  } catch (e) {
    if (manual || isInitial) toast(e.message, true);
  } finally {
    inspBusy = false;
  }
}

function renderInspChatList(chats) {
  const key = `${inspChatId || 0}|` + chats.map((c) => `${c.id}:${c.title}:${c.msg_count}:${Math.floor(c.updated_at)}:${c.generating ? 1 : 0}`).join("|");
  if (key === lastInspListKey) return;
  lastInspListKey = key;
  $("#insp-chat-list").replaceChildren(
    ...chats.map((c) =>
      el(
        "button",
        {
          type: "button",
          class: "insp-chat-btn",
          "aria-current": c.id === inspChatId ? "page" : null,
          onclick: () => loadInspChat(c.id, chats, { silent: false }),
        },
        el(
          "span",
          { class: "insp-chat-head" },
          c.generating ? el("i", { class: "chat-gen-dot", "aria-hidden": "true" }) : null,
          el("strong", { text: c.title })
        ),
        el("span", { text: `${c.msg_count} сообщ. · ${fmtDateTime(c.updated_at)}${c.generating ? " · печатает…" : ""}` })
      )
    )
  );
}

const MODEL_LABELS = {
  "mythos-5.5": "Claude Mythos 5.5",
  "opus-5.5": "Claude Opus 5.5",
  "sonnet-5.5": "Claude Sonnet 5.5",
  "fable-5.2": "Claude Fable 5.2",
  "haiku-5.5": "Claude Haiku 5.5",
};

function buildInspMsgNode(m, username, isLive = false) {
  const isUser = !isLive && m.role === "user";
  const box = el("div", { class: `insp-msg${isUser ? " user" : ""}${isLive ? " live" : ""}` });
  const asstName = MODEL_LABELS[m.model] || "Claude Mythos 5.5";
  const asstLabel = m.effort ? `${asstName} · ${m.effort}` : asstName;
  box.append(
    el(
      "div",
      { class: "insp-msg-meta" },
      el("strong", { text: isUser ? username : asstLabel }),
      isLive
        ? el("span", { class: "insp-live-badge" }, el("i", { class: "chat-gen-dot", "aria-hidden": "true" }), el("span", { text: m.thinking ? "Думает сейчас…" : "Печатает сейчас…" }))
        : el("span", { text: fmtDateTime(m.created_at) })
    )
  );
  if (m.attachments?.length) {
    const attRow = el("div", { class: "att-list" });
    for (const a of m.attachments) {
      if (a.kind === "image") {
        const img = el("img", { alt: a.name, loading: "lazy" });
        fileUrl(a.id).then((u) => { img.src = u; img.onclick = () => lightbox(u); }).catch(() => {});
        attRow.append(img);
      } else {
        attRow.append(el("span", { class: "file-chip" }, icon("file", 14), el("span", { text: a.name })));
      }
    }
    box.append(attRow);
  }
  if (m.tools?.length) {
    const tRow = el("div", { class: "tools" });
    for (const t of m.tools) {
      const label = t.name === "web_search" ? `Поиск: ${t.args?.query || ""}` : t.name === "fetch_url" ? `Открыл: ${t.args?.url || ""}` : t.name;
      tRow.append(el("span", { class: "tool-chip", text: label }));
    }
    box.append(tRow);
  }
  if (m.reasoning) {
    box.append(el("details", { class: "think" }, el("summary", { text: "Размышления" }), el("div", { class: "think-body", text: m.reasoning })));
  }
  if (m.content) {
    const body = el("div", { class: "md" });
    if (isUser) body.textContent = m.content;
    else body.innerHTML = renderMarkdown(m.content);
    box.append(body);
  } else if (isLive) {
    box.append(el("p", { class: "hint", text: m.status || "Ожидает ответ модели…" }));
  }
  return box;
}

async function loadInspChat(chatId, chats, { silent = false } = {}) {
  const switched = inspChatId !== chatId;
  inspChatId = chatId;
  const active = chats.find((c) => c.id === chatId);
  $("#insp-current-title").textContent = active ? active.title : "";
  if (!silent || switched) {
    $("#insp-body").dataset.mobileStep = "thread";
  }
  renderInspChatList(chats);
  const threadEl = $("#insp-thread");
  if (!silent) {
    lastInspThreadKey = "";
    threadEl.replaceChildren(el("p", { class: "hint", text: "Загружаю сообщения…" }));
  }
  try {
    const data = await api(`/api/admin/chats/${chatId}`);
    if (inspChatId !== chatId) return;
    if (data.user && inspUser && data.user.id === inspUser.id) {
      inspUser = { ...inspUser, ...data.user };
      updateInspHeader(inspUser);
    }
    const msgs = data.messages || [];
    const live = data.live || null;
    const last = msgs[msgs.length - 1];
    const fp = `${chatId}|${msgs.length}|${last?.id || 0}|${(last?.content || "").length}|${live ? `${live.content.length}:${live.reasoning.length}:${live.tools.length}:${live.thinking ? 1 : 0}:${live.status}` : "0"}`;
    if (silent && fp === lastInspThreadKey) return;
    lastInspThreadKey = fp;

    // запоминаем, был ли админ внизу переписки и какие спойлеры размышлений открыты
    const wasNearBottom = switched || !silent || (threadEl.scrollHeight - threadEl.scrollTop - threadEl.clientHeight < 90);
    const openThinks = new Set();
    threadEl.querySelectorAll("details.think").forEach((d, i) => {
      if (d.open) openThinks.add(i);
    });

    if (!msgs.length && !live) {
      threadEl.replaceChildren(el("p", { class: "hint", text: "Чат пустой." }));
      return;
    }
    const nodes = msgs.map((m) => buildInspMsgNode(m, data.user?.username || "гость", false));
    if (live) nodes.push(buildInspMsgNode(live, data.user?.username || "гость", true));
    threadEl.replaceChildren(...nodes);

    if (openThinks.size) {
      threadEl.querySelectorAll("details.think").forEach((d, i) => {
        if (openThinks.has(i)) d.open = true;
      });
    }
    if (wasNearBottom) {
      threadEl.scrollTop = threadEl.scrollHeight;
    }
  } catch (e) {
    if (!silent) toast(e.message, true);
  }
}

async function addUser() {
  const r = await ask({
    title: "Новый пользователь (Claude)",
    text: "У гостя автоматически откроется интерфейс Claude с дефолтными лимитами (5 ч и неделя).",
    ok: "Создать",
    fields: [
      { name: "username", label: "Логин" },
      { name: "password", label: "Пароль", type: "text", placeholder: "минимум 4 символа" },
    ],
  });
  if (!r) return;
  try {
    await api("/api/admin/users", { method: "POST", body: { username: r.username, password: r.password } });
    toast("Пользователь создан");
    loadAdmin(me, !$("#lock-toggle").checked);
  } catch (e) {
    toast(e.message, true);
  }
}
