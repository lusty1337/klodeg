// режим "Админка": модель, доступ гостей, апелляции, просмотр любых чатов, пользователи и квоты
import { api, fileUrl } from "./api.js";
import { $, el, icon, toast, fmtTokens, fmtReset, fmtDateTime, ask, renderMarkdown, lightbox } from "./ui.js";

let me = null;
let onLockChange = () => {};
let llmTimer = 0;
let inspUser = null;
let inspChatId = null;

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
    try {
      await api("/api/admin/llm/start", { method: "POST" });
      toast("Модель загружается…");
      pollLlm();
    } catch (e) {
      toast(e.message, true);
    }
  });
  $("#btn-llm-stop").addEventListener("click", async () => {
    try {
      await api("/api/admin/llm/stop", { method: "POST" });
      toast("Модель выгружена, память свободна");
      loadLlm();
      window.dispatchEvent(new CustomEvent("nh:refresh-status"));
    } catch (e) {
      toast(e.message, true);
    }
  });
  $("#insp-close").addEventListener("click", () => $("#chats-dialog").close());
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
}

export async function loadAdmin(currentUser, aiLocked) {
  me = currentUser;
  setLocked(aiLocked);
  loadLlm();
  try {
    const users = await api("/api/admin/users");
    renderAppeals(users);
    renderUsers(users);
    window.dispatchEvent(new CustomEvent("nh:appeals-updated"));
  } catch (e) {
    toast(e.message, true);
  }
}

function pollLlm() {
  clearInterval(llmTimer);
  let n = 0;
  llmTimer = setInterval(async () => {
    const st = await loadLlm();
    if (st !== "loading" || ++n > 200 || $(".view-admin").classList.contains("hidden")) clearInterval(llmTimer);
  }, 2000);
}

async function loadLlm() {
  try {
    const d = await api("/api/admin/llm");
    const key = d.paused ? "paused" : d.state;
    const [cls, text] = key === "paused" ? ["warn", "Пауза: рисуется картинка"] : LLM_STATE[key] || LLM_STATE.offline;
    const tag = $("#llm-state");
    tag.className = `status-tag ${cls}`;
    tag.textContent = text;
    $("#llm-model-name").textContent = d.model + (d.state === "ready" && d.uptime ? ` · работает ${Math.round(d.uptime / 60)} мин` : "");
    $("#llm-problem").textContent = d.problem || "";
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
    text: "Пользователь увидит экран приостановки Клодега и сможет отправить апелляцию.",
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

function permSwitch(u, perm, label) {
  const admin = u.role === "admin";
  const box = el("input", { type: "checkbox", checked: admin || u.perms[perm], disabled: admin });
  box.addEventListener("change", async () => {
    if (!(await patch(u, { [`perm_${perm}`]: box.checked }))) box.checked = !box.checked;
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

function renderUsers(users) {
  $("#users").replaceChildren(
    ...users.map((u) => {
      const self = u.id === me.id;
      const role = el(
        "select",
        { disabled: self, "aria-label": `Роль ${u.username}`, style: "width:auto" },
        el("option", { value: "user", text: "гость (Клодег)" }),
        el("option", { value: "admin", text: "админ (NeuroHub)" })
      );
      role.value = u.role;
      role.addEventListener("change", async () => {
        if (await patch(u, { role: role.value })) loadAdmin(me, !$("#lock-toggle").checked);
      });
      const us = u.usage;
      const st = u.ban_status || "active";
      const [stCls, stLabel] = BAN_META[st] || BAN_META.suspended;
      const isBanned = st !== "active";
      const u5Text = `${fmtTokens(us.used_5h)}${us.limit_5h != null ? ` / ${fmtTokens(us.limit_5h)} (${us.pct_5h}%)` : ""}${us.reset_5h ? ` · сброс ${fmtReset(us.reset_5h)}` : ""}`;
      const uwText = `${fmtTokens(us.used_week)}${us.limit_week != null ? ` / ${fmtTokens(us.limit_week)} (${us.pct_week}%)` : ""}${us.reset_week ? ` · сброс ${fmtReset(us.reset_week, true)}` : ""}`;

      return el(
        "div",
        { class: `user-card${isBanned ? " disabled" : ""}` },
        el(
          "div",
          { class: "user-head" },
          el("div", { class: "avatar", text: u.username.slice(0, 1).toUpperCase() }),
          el(
            "div",
            { class: "grow" },
            el("strong", { text: u.username }),
            self ? el("span", { class: "muted", text: " · это ты" }) : null,
            u.ban_reason ? el("span", { class: "muted", text: ` · ${u.ban_reason}` }) : null
          ),
          !self ? el("span", { class: `status-tag ${stCls}`, text: stLabel }) : null,
          role
        ),
        el("div", { class: "user-perms" }, permSwitch(u, "image", "Картинки"), permSwitch(u, "voice", "Звонок"), permSwitch(u, "yolo", "Зрение")),
        el(
          "div",
          { class: "user-limits" },
          limitField(u, "limit_5h", "Лимит за 5 ч"),
          limitField(u, "limit_week", "Лимит за неделю"),
          el("div", { class: "user-usage" }, `5 ч: ${u5Text} · Неделя: ${uwText}`)
        ),
        el(
          "div",
          { class: "user-actions" },
          el("button", {
            class: "btn", type: "button",
            onclick: () => openUserChats(u),
          }, icon("chat", 15), `Чаты (${u.chat_count || 0})`),
          el("button", {
            class: "btn", type: "button",
            onclick: async () => {
              const r = await ask({ title: `Новый пароль для ${u.username}`, fields: [{ name: "pw", type: "text", placeholder: "минимум 4 символа" }], ok: "Сменить" });
              if (r?.pw) patch(u, { password: r.pw });
            },
          }, icon("key", 15), "Пароль"),
          el("button", {
            class: "btn", type: "button",
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
            class: "btn", type: "button",
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
          self ? null : (
            isBanned
              ? el("button", {
                  class: "btn primary", type: "button",
                  onclick: async () => {
                    if (await setBanStatus(u, "active")) loadAdmin(me, !$("#lock-toggle").checked);
                  },
                }, icon("play", 15), "Отозвать бан")
              : el("button", {
                  class: "btn danger", type: "button",
                  onclick: async () => {
                    if (await suspendPrompt(u)) loadAdmin(me, !$("#lock-toggle").checked);
                  },
                }, icon("lock", 15), "Приостановить")
          ),
          self ? null : el("button", {
            class: "btn ghost", type: "button",
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
      );
    })
  );
}

// ---------------- инспектор чатов ----------------
async function openUserChats(user) {
  inspUser = user;
  inspChatId = null;
  const dlg = $("#chats-dialog");
  $("#insp-title").textContent = `Чаты: ${user.username}`;
  const isSelf = me && user.id === me.id;
  const st = user.ban_status || "active";
  const [stCls, stLabel] = BAN_META[st] || BAN_META.suspended;
  const badge = $("#insp-status");
  badge.className = `status-tag ${stCls}`;
  badge.textContent = stLabel;
  const banBtn = $("#insp-ban-btn");
  banBtn.classList.toggle("hidden", isSelf);
  banBtn.className = `btn ${st === "active" ? "danger" : "primary"}${isSelf ? " hidden" : ""}`;
  banBtn.textContent = st === "active" ? "Приостановить" : "Отозвать бан";

  $("#insp-chat-list").replaceChildren(el("p", { class: "hint", text: "Загрузка чатов…" }));
  $("#insp-thread").replaceChildren(el("div", { class: "placeholder" }, icon("chat", 28), el("p", { text: "Выбери чат слева, чтобы прочитать переписку." })));
  if (!dlg.open) dlg.showModal();

  try {
    const data = await api(`/api/admin/users/${user.id}/chats`);
    if (data.user) {
      inspUser = { ...user, ...data.user };
      const [c2, l2] = BAN_META[inspUser.ban_status || "active"] || BAN_META.suspended;
      badge.className = `status-tag ${c2}`;
      badge.textContent = l2;
    }
    if (!data.chats.length) {
      $("#insp-chat-list").replaceChildren(el("p", { class: "hint", text: "У пользователя пока нет чатов." }));
      return;
    }
    renderInspChatList(data.chats);
    loadInspChat(data.chats[0].id, data.chats);
  } catch (e) {
    toast(e.message, true);
  }
}

function renderInspChatList(chats) {
  $("#insp-chat-list").replaceChildren(
    ...chats.map((c) =>
      el(
        "button",
        {
          type: "button",
          class: "insp-chat-btn",
          "aria-current": c.id === inspChatId ? "page" : null,
          onclick: () => loadInspChat(c.id, chats),
        },
        el("strong", { text: c.title }),
        el("span", { text: `${c.msg_count} сообщ. · ${fmtDateTime(c.updated_at)}` })
      )
    )
  );
}

async function loadInspChat(chatId, chats) {
  inspChatId = chatId;
  renderInspChatList(chats);
  $("#insp-thread").replaceChildren(el("p", { class: "hint", text: "Загружаю сообщения…" }));
  try {
    const data = await api(`/api/admin/chats/${chatId}`);
    if (!data.messages.length) {
      $("#insp-thread").replaceChildren(el("p", { class: "hint", text: "Чат пустой." }));
      return;
    }
    $("#insp-thread").replaceChildren(
      ...data.messages.map((m) => {
        const isUser = m.role === "user";
        const box = el("div", { class: `insp-msg${isUser ? " user" : ""}` });
        box.append(
          el(
            "div",
            { class: "insp-msg-meta" },
            el("strong", { text: isUser ? data.user.username : "Claude Fable 8" }),
            el("span", { text: fmtDateTime(m.created_at) })
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
        if (m.reasoning) {
          box.append(el("details", { class: "think" }, el("summary", { text: "Размышления" }), el("div", { class: "think-body", text: m.reasoning })));
        }
        if (m.content) {
          const body = el("div", { class: "md" });
          if (isUser) body.textContent = m.content;
          else body.innerHTML = renderMarkdown(m.content);
          box.append(body);
        }
        return box;
      })
    );
  } catch (e) {
    toast(e.message, true);
  }
}

async function addUser() {
  const r = await ask({
    title: "Новый пользователь (Клодег)",
    text: "У гостя автоматически откроется интерфейс «Клодег» с дефолтными лимитами (5 ч и неделя).",
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
