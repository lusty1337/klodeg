// режим "Чат": фоновая генерация (переживает сворачивание и смену чата), скрытые раздумья для гостей, плавный стрим
import { api, stream, streamGet, upload, fileUrl, resolveApiBase } from "./api.js";
import {
  $, el, icon, setIcon, setChildren, toast, renderMarkdown, lightbox, copyText, ask, isMobile,
  CLAUDE_STARBURST_SVG,
} from "./ui.js";

const S = {
  chats: [],
  chatId: null,
  messages: [],
  pending: [],
  // поиск включён по умолчанию - модель сама решает, когда проверить факты в интернете
  web: localStorage.getItem("nh_web_v2") !== "0",
  // по умолчанию "Думать" выключено ради быстрых ответов (включается кнопкой или из меню модели)
  think: localStorage.getItem("nh_think_v2") === "1",
  isAdmin: false,
  generatingChats: new Set(),
  viewAbort: null,
  streamingChatId: null,
  filter: "",
  onUsage: () => {},
};
const E = {};

const SUGGESTIONS = [
  ["Объясни просто", "как работает нейросеть-трансформер"],
  ["Напиши код", "скрипт на Python, который переименует фото по дате съёмки"],
  ["Помоги придумать", "идею для короткометражки в жанре киберпанк"],
  ["Разбери", "чем отличается рекурсия от итерации на живых примерах"],
];

export function setChatRole(role) {
  S.isAdmin = role === "admin";
}

export function initChat({ onUsage }) {
  S.onUsage = onUsage;
  Object.assign(E, {
    list: $("#chat-list"),
    scroller: $("#messages"),
    thread: $("#thread"),
    empty: $("#empty-chat"),
    input: $("#input"),
    form: $("#composer"),
    send: $("#btn-send"),
    web: $("#btn-web"),
    think: $("#btn-think"),
    modelThink: $("#model-pop-think"),
    file: $("#file-input"),
    attRow: $("#att-row"),
    box: $("#composer-box"),
    search: $("#chat-search"),
    down: $("#btn-scroll-down"),
  });

  $("#btn-new-chat")?.addEventListener("click", () => newChat());
  $("#btn-claude-new-chat")?.addEventListener("click", () => newChat());
  E.form.addEventListener("submit", (e) => {
    e.preventDefault();
    isCurrentGenerating() ? stopCurrent() : send();
  });
  E.input.addEventListener("keydown", (e) => {
    // на телефоне Enter - перенос строки, отправка кнопкой
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && !isMobile()) {
      e.preventDefault();
      if (!isCurrentGenerating()) send();
    }
  });
  E.input.addEventListener("input", () => {
    autosize();
    syncSend();
  });
  E.input.addEventListener("paste", (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) {
      e.preventDefault();
      files.forEach(addFile);
    }
  });
  $("#btn-attach").addEventListener("click", () => E.file.click());
  E.file.addEventListener("change", () => {
    [...E.file.files].forEach(addFile);
    E.file.value = "";
  });
  E.web.addEventListener("click", () => {
    S.web = !S.web;
    localStorage.setItem("nh_web_v2", S.web ? "1" : "0");
    syncToggles();
  });
  const toggleThink = (next, notify = true) => {
    S.think = next;
    localStorage.setItem("nh_think_v2", S.think ? "1" : "0");
    syncToggles();
    if (notify) toast(S.think ? "Глубокое мышление включено" : "Быстрые ответы без размышлений");
  };
  E.think.addEventListener("click", () => toggleThink(!S.think, true));
  E.modelThink?.addEventListener("change", () => toggleThink(E.modelThink.checked, true));

  for (const ev of ["dragenter", "dragover"]) {
    E.box.addEventListener(ev, (e) => {
      e.preventDefault();
      E.box.classList.add("drag");
    });
  }
  for (const ev of ["dragleave", "drop"]) E.box.addEventListener(ev, () => E.box.classList.remove("drag"));
  E.box.addEventListener("drop", (e) => {
    e.preventDefault();
    [...e.dataTransfer.files].forEach(addFile);
  });
  E.search.addEventListener("input", () => {
    S.filter = E.search.value.trim().toLowerCase();
    renderList();
  });

  // кнопка "вниз" видна, пока конец переписки за пределами экрана (с запасом 120px)
  new IntersectionObserver(
    ([entry]) => E.down.classList.toggle("hidden", entry.isIntersecting || !S.messages.length),
    { root: E.scroller, rootMargin: "0px 0px 120px 0px" }
  ).observe($("#thread-end"));
  E.down.addEventListener("click", () => scrollDown(true, true));
  window.addEventListener("nh:chat-shown", syncTitle);

  // возвращение во вкладку после сворачивания телефона: подхватываем идущую или готовую генерацию
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) resyncVisibleChat();
  });
  window.addEventListener("online", () => resyncVisibleChat());

  setChildren(
    $("#suggestions"),
    SUGGESTIONS.map(([t, d]) =>
      el("button", {
        type: "button",
        class: "suggestion",
        onclick: () => {
          E.input.value = `${t} ${d}`;
          autosize();
          syncSend();
          E.input.focus();
        },
      }, el("span", {}, el("strong", { text: t }), ` ${d}`), icon("arrowRight", 16))
    )
  );
  syncToggles();
  syncSend();
}

function isClaudeBrand() {
  return document.documentElement.dataset.brand === "claude";
}

function isCurrentGenerating() {
  return Boolean(S.chatId && (S.streamingChatId === S.chatId || S.generatingChats.has(S.chatId)));
}

function syncToggles() {
  E.web.setAttribute("aria-pressed", String(S.web));
  E.think.setAttribute("aria-pressed", String(S.think));
  if (E.modelThink) E.modelThink.checked = S.think;
}

function syncSend() {
  const busy = isCurrentGenerating();
  setIcon(E.send, busy ? "stop" : "arrowUp", 19);
  E.send.setAttribute("aria-label", busy ? "Остановить" : "Отправить");
  E.send.classList.toggle("stop", busy);
  E.send.disabled = !busy && !E.input.value.trim() && !S.pending.some((p) => p.meta);
}

function autosize() {
  E.input.style.height = "auto";
  E.input.style.height = Math.min(E.input.scrollHeight, 220) + "px";
}

function syncTitle() {
  if ($(".view-chat").classList.contains("hidden")) return;
  const c = S.chats.find((x) => x.id === S.chatId);
  $("#topbar-title").textContent = c ? c.title : "Новый чат";
}

function detachViewStream() {
  // отключаем только локальный читатель SSE - серверная задача продолжает генерировать в фоне
  if (S.viewAbort) {
    S.viewAbort.abort();
    S.viewAbort = null;
  }
  S.streamingChatId = null;
}

async function resyncVisibleChat() {
  if (!S.chatId || S.streamingChatId === S.chatId) return;
  if ($(".view-chat").classList.contains("hidden")) return;
  try {
    const data = await api(`/api/chats/${S.chatId}`);
    if (data.generating) {
      S.generatingChats.add(S.chatId);
      S.messages = data.messages;
      renderMessages(false);
      renderList();
      attachToRunningChat(S.chatId);
    } else if (S.generatingChats.has(S.chatId) || data.messages.length !== S.messages.length) {
      S.generatingChats.delete(S.chatId);
      S.messages = data.messages;
      renderMessages(false);
      renderList();
      syncSend();
    }
  } catch {}
}

// ---------------- список чатов ----------------
export async function loadChats() {
  S.chats = await api("/api/chats");
  S.generatingChats.clear();
  for (const c of S.chats) {
    if (c.generating) S.generatingChats.add(c.id);
  }
  renderList();
  if (S.chats.length && !S.chatId && !isMobile()) openChat(S.chats[0].id, false);
  else renderMessages(false);
}

function groupName(ts) {
  const d = new Date(ts * 1000);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = (today - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000;
  if (diff <= 0) return "Сегодня";
  if (diff === 1) return "Вчера";
  if (diff < 7) return "Последние 7 дней";
  if (diff < 30) return "Последние 30 дней";
  return d.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
}

function renderList() {
  const items = [];
  let group = null;
  const chats = S.filter ? S.chats.filter((c) => c.title.toLowerCase().includes(S.filter)) : S.chats;
  for (const c of chats) {
    const g = groupName(c.updated_at);
    if (g !== group) {
      group = g;
      items.push(el("li", { class: "chat-group", text: g }));
    }
    const isGen = S.generatingChats.has(c.id);
    items.push(
      el(
        "li",
        { class: `chat-item${isGen ? " is-generating" : ""}` },
        el(
          "button",
          {
            type: "button",
            class: "chat-open",
            title: isGen ? `${c.title} · генерирует ответ…` : c.title,
            "aria-current": c.id === S.chatId ? "page" : null,
            onclick: () => openChat(c.id),
          },
          isGen ? el("i", { class: "chat-gen-dot", "aria-hidden": "true" }) : null,
          el("span", { class: "chat-open-title", text: c.title })
        ),
        el(
          "span",
          { class: "acts" },
          el("button", {
            class: "icon-btn", type: "button", "aria-label": "Переименовать", title: "Переименовать",
            onclick: (e) => { e.stopPropagation(); renameChat(c); },
          }, icon("edit", 15)),
          el("button", {
            class: "icon-btn", type: "button", "aria-label": "Удалить", title: "Удалить",
            onclick: (e) => { e.stopPropagation(); deleteChat(c); },
          }, icon("trash", 15))
        )
      )
    );
  }
  if (!chats.length) items.push(el("li", { class: "chat-group", text: S.filter ? "Ничего не найдено" : "Чатов пока нет" }));
  setChildren(E.list, items);
}

async function renameChat(c) {
  const r = await ask({ title: "Переименовать чат", fields: [{ name: "title", value: c.title }], ok: "Сохранить" });
  const title = r?.title?.trim();
  if (!title || title === c.title) return;
  try {
    await api(`/api/chats/${c.id}`, { method: "PATCH", body: { title } });
    c.title = title;
    renderList();
    syncTitle();
  } catch (e) {
    toast(e.message, true);
  }
}

async function deleteChat(c) {
  if (!(await ask({ title: "Удалить чат?", text: `«${c.title}» удалится вместе со всеми сообщениями.`, ok: "Удалить", danger: true }))) return;
  try {
    await api(`/api/chats/${c.id}`, { method: "DELETE" });
    S.generatingChats.delete(c.id);
    S.chats = S.chats.filter((x) => x.id !== c.id);
    if (S.chatId === c.id) newChat(false);
    renderList();
  } catch (e) {
    toast(e.message, true);
  }
}

export function newChat(focus = true) {
  // смена чата не прерывает фоновую генерацию в прошлом чате
  detachViewStream();
  S.chatId = null;
  S.messages = [];
  renderMessages(false);
  renderList();
  syncTitle();
  syncSend();
  window.dispatchEvent(new CustomEvent("nh:open-chat-mode"));
  if (focus && !isMobile()) E.input.focus();
}

async function openChat(id, showChatMode = true) {
  if (showChatMode) window.dispatchEvent(new CustomEvent("nh:open-chat-mode"));
  if (S.chatId === id && S.streamingChatId === id) return;
  // отключаемся только от просмотра старого стрима, но не останавливаем модель
  detachViewStream();
  S.chatId = id;
  renderList();
  syncTitle();
  syncSend();
  try {
    const data = await api(`/api/chats/${id}`);
    if (S.chatId !== id) return;
    S.messages = data.messages;
    renderMessages(true);
    if (data.generating) {
      S.generatingChats.add(id);
      renderList();
      attachToRunningChat(id);
    } else {
      S.generatingChats.delete(id);
      renderList();
      syncSend();
    }
  } catch (e) {
    toast(e.message, true);
  }
}

// ---------------- отрисовка ----------------
function renderMessages(animate = false) {
  const has = S.messages.length > 0;
  E.empty.classList.toggle("hidden", has);
  E.thread.classList.toggle("hidden", !has);
  setChildren(
    E.thread,
    S.messages.map((m, i) => (m.role === "user" ? userEl(m, i, false) : assistantEl(m, i, false).root))
  );
  if (animate && has) {
    E.thread.classList.remove("thread-fade");
    void E.thread.offsetWidth;
    E.thread.classList.add("thread-fade");
  }
  markLast();
  scrollDown(true);
}

function markLast() {
  const nodes = E.thread.querySelectorAll(".msg");
  nodes.forEach((n, i) => n.classList.toggle("last", i === nodes.length - 1));
}

function attachmentsEl(atts) {
  if (!atts?.length) return null;
  return el(
    "div",
    { class: "att-list" },
    atts.map((a) => {
      if (a.kind === "image") {
        const img = el("img", { alt: a.name, loading: "lazy" });
        fileUrl(a.id)
          .then((u) => {
            img.src = u;
            img.onclick = () => lightbox(u);
          })
          .catch(() => {});
        return img;
      }
      return el("span", { class: "file-chip" }, icon("file", 15), el("span", { text: a.name }));
    })
  );
}

function actBtn(iconName, label, onclick, title = label) {
  return el("button", { type: "button", title, "aria-label": title, onclick }, icon(iconName, 15), label ? el("span", { text: label }) : null);
}

function userEl(m, idx, animate = false) {
  const root = el("div", { class: `msg user${animate ? " msg-enter" : ""}` });
  const bubble = m.content ? el("div", { class: "bubble", text: m.content }) : null;
  const isLast = idx === S.messages.length - 1;
  const actions = el(
    "div",
    { class: "actions" },
    actBtn("edit", "", () => openEditor(m, idx, root), "Изменить и перегенерировать"),
    m.content ? actBtn("copy", "", () => copyText(m.content), "Копировать") : null,
    !isLast && m.id ? actBtn("rewind", "", () => rewindTo(m, idx), "Откатить диалог сюда") : null
  );
  root.append(...[attachmentsEl(m.attachments), bubble, actions].filter(Boolean));
  return root;
}

function openEditor(m, idx, root) {
  if (isCurrentGenerating()) return;
  const ta = el("textarea", { rows: 3 });
  ta.value = m.content || "";
  const box = el(
    "div",
    { class: "edit-box" },
    ta,
    el(
      "div",
      { class: "row" },
      el("button", { type: "button", class: "btn ghost", text: "Отмена", onclick: () => renderMessages(false) }),
      el("button", {
        type: "button",
        class: "btn primary",
        text: "Отправить",
        onclick: () => {
          const t = ta.value.trim();
          if (!t && !m.attachments?.length) return toast("Сообщение пустое", true);
          editAndRegenerate(m, idx, t);
        },
      })
    )
  );
  root.querySelector(".bubble")?.remove();
  root.querySelector(".actions")?.remove();
  root.append(box);
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
}

function toolChip(name, args) {
  if (name === "web_search") return el("span", { class: "tool-chip" }, icon("search", 13), el("span", { text: `Ищу: ${args.query ?? ""}` }));
  if (name === "fetch_url") return el("span", { class: "tool-chip" }, icon("globe", 13), el("span", { text: `Читаю: ${args.url ?? ""}` }));
  return el("span", { class: "tool-chip", text: name });
}

function sparkEl(size = 18) {
  return el("span", {
    class: "claude-spark",
    style: `width:${size}px;height:${size}px`,
    html: CLAUDE_STARBURST_SVG,
    "aria-hidden": "true",
  });
}

function assistantEl(m, idx, animate = false) {
  const root = el("div", { class: `msg assistant${animate ? " msg-enter" : ""}` });

  // для админа оставляем раскрываемые размышления, для друзей - строго некликабельный индикатор без текста мыслей
  let thinkEl = null;
  let thinkSum = null;
  let thinkBody = null;
  let thinkPill = null;
  let thinkPillText = null;

  if (S.isAdmin) {
    thinkBody = el("div", { class: "think-body" });
    thinkSum = el("summary", { text: "Размышления" });
    thinkEl = el("details", { class: "think hidden" }, thinkSum, thinkBody);
  } else {
    thinkPillText = el("span", { class: "think-pill-text", text: "Думаю…" });
    thinkPill = el("div", { class: "think-pill hidden", "aria-live": "polite" }, sparkEl(17), thinkPillText);
  }

  const tools = el("div", { class: "tools hidden" });
  const status = el("div", { class: "status-line hidden" });
  const body = el("div", { class: "md" });
  const actions = el("div", { class: "actions" });
  root.append(S.isAdmin ? thinkEl : thinkPill, tools, status, body, actions);

  const view = {
    root,
    setReasoning(text, live = false) {
      if (!S.isAdmin || !thinkEl) return;
      thinkEl.classList.toggle("hidden", !text);
      thinkEl.classList.toggle("live", live);
      thinkBody.textContent = text;
      if (live) thinkBody.scrollTop = thinkBody.scrollHeight;
    },
    setThinkLabel(t) {
      if (S.isAdmin && thinkSum) thinkSum.textContent = t;
    },
    collapseAdminThink() {
      if (S.isAdmin && thinkEl) thinkEl.open = false;
    },
    setGuestThinking(active, hasThought = false, seconds = 0) {
      if (S.isAdmin || !thinkPill) return;
      if (active) {
        thinkPill.classList.remove("hidden");
        thinkPill.classList.add("live");
        thinkPillText.textContent = "Думаю…";
      } else if (hasThought) {
        thinkPill.classList.remove("hidden");
        thinkPill.classList.remove("live");
        thinkPillText.textContent = seconds > 0 ? `Обдумано за ${seconds} с` : "Обдумано";
      } else {
        thinkPill.classList.add("hidden");
        thinkPill.classList.remove("live");
      }
    },
    setContent(text) {
      body.innerHTML = renderMarkdown(text);
    },
    setTyping(on) {
      if (!on) return;
      if (isClaudeBrand()) {
        setChildren(body, el("div", { class: "claude-loading" }, sparkEl(20)));
      } else {
        setChildren(body, el("span", { class: "typing-dots" }, el("i"), el("i"), el("i")));
      }
    },
    setStatus(text) {
      status.classList.toggle("hidden", !text);
      status.textContent = text || "";
    },
    addTool(name, args) {
      tools.classList.remove("hidden");
      const c = toolChip(name, args);
      tools.append(c);
      return c;
    },
    clearTools() {
      tools.replaceChildren();
      tools.classList.add("hidden");
    },
    error(text) {
      root.querySelector(".error-box")?.remove();
      root.insertBefore(el("div", { class: "error-box", text }), actions);
    },
    setActions(msg, i) {
      const isLast = i === S.messages.length - 1;
      setChildren(
        actions,
        actBtn("copy", "", () => copyText(msg.content || "", "Ответ скопирован"), "Копировать"),
        actBtn("refresh", "", () => regenerate(i, "retry"), "Ответить заново"),
        actBtn("shorter", "", () => regenerate(i, "shorter"), "Короче"),
        actBtn("longer", "", () => regenerate(i, "longer"), "Подробнее"),
        !isLast && msg.id ? actBtn("rewind", "", () => rewindTo(msg, i), "Откатить диалог сюда") : null,
        S.isAdmin && msg.stats?.gen_tps
          ? el("span", { class: "stat", title: `Промпт: ${msg.stats.prompt_tps} ток/с`, text: `${msg.stats.gen_tps} ток/с` })
          : null
      );
    },
  };

  if (S.isAdmin) {
    view.setReasoning(m.reasoning || "");
  } else if (m.has_thinking) {
    view.setGuestThinking(false, true, 0);
  }
  (m.tools || []).forEach((t) => view.addTool(t.name, t.args || {}));
  view.setContent(m.content);
  if (idx >= 0) view.setActions(m, idx);
  return view;
}

function nearBottom() {
  const s = E.scroller;
  return s.scrollHeight - s.scrollTop - s.clientHeight < 140;
}

function scrollDown(force = false, smooth = false) {
  if (force || nearBottom()) {
    E.scroller.scrollTo({ top: E.scroller.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }
}

// ---------------- откат, правка, перегенерация ----------------
async function rewindTo(m, idx) {
  if (isCurrentGenerating() || !m.id) return;
  const removed = S.messages.length - 1 - idx;
  if (removed <= 0) return;
  if (!(await ask({ title: "Откатить диалог?", text: `Сообщения ниже этого (${removed}) будут удалены.`, ok: "Откатить", danger: true }))) return;
  try {
    await api(`/api/chats/${S.chatId}/messages/${m.id}/rewind`, { method: "DELETE" });
    S.messages = S.messages.slice(0, idx + 1);
    renderMessages(false);
  } catch (e) {
    toast(e.message, true);
  }
}

async function editAndRegenerate(m, idx, text) {
  if (isCurrentGenerating()) return;
  if (m.id) {
    try {
      await api(`/api/chats/${S.chatId}/messages/${m.id}/after`, { method: "DELETE" });
    } catch (e) {
      return toast(e.message, true);
    }
  }
  S.messages = S.messages.slice(0, idx);
  renderMessages(false);
  await send({ content: text, attachments: m.attachments || [] });
}

async function regenerate(asstIdx, mode) {
  if (isCurrentGenerating()) return;
  let u = asstIdx - 1;
  while (u >= 0 && S.messages[u].role !== "user") u--;
  if (u < 0) return;
  const userMsg = S.messages[u];
  if (!userMsg.id) return toast("Обнови чат и попробуй снова");
  try {
    await api(`/api/chats/${S.chatId}/messages/${userMsg.id}/rewind`, { method: "DELETE" });
  } catch (e) {
    return toast(e.message, true);
  }
  S.messages = S.messages.slice(0, u + 1);
  renderMessages(false);
  await send({ content: userMsg.content, attachments: userMsg.attachments || [], reuse: true, mode });
}

// ---------------- вложения ----------------
async function addFile(file) {
  const item = { file, loading: true, preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : null };
  S.pending.push(item);
  renderPending();
  try {
    item.meta = await upload(file);
  } catch (e) {
    toast(`${file.name}: ${e.message}`, true);
    S.pending = S.pending.filter((p) => p !== item);
  }
  item.loading = false;
  renderPending();
}

function renderPending() {
  setChildren(
    E.attRow,
    S.pending.map((p) =>
      el(
        "span",
        { class: `file-chip${p.loading ? " loading" : ""}` },
        p.preview ? el("img", { src: p.preview, alt: "" }) : icon("file", 15),
        el("span", { text: p.loading ? `${p.file.name} · загрузка…` : p.file.name }),
        el("button", {
          type: "button",
          "aria-label": "Убрать файл",
          onclick: () => {
            S.pending = S.pending.filter((x) => x !== p);
            renderPending();
          },
        }, icon("close", 13))
      )
    )
  );
  syncSend();
}

// ---------------- отправка и переподключение к фоновому стриму ----------------
async function send(resend) {
  if (isCurrentGenerating()) return;
  const content = resend ? resend.content : E.input.value.trim();
  if (!resend && S.pending.some((p) => p.loading)) return toast("Подожди, файл ещё загружается");
  const atts = resend ? resend.attachments : S.pending.filter((p) => p.meta).map((p) => p.meta);
  if (!content && !atts.length) return;

  if (!S.chatId) {
    try {
      const chat = await api("/api/chats", { method: "POST" });
      S.chatId = chat.id;
      S.chats.unshift(chat);
      renderList();
    } catch (e) {
      return toast(e.message, true);
    }
  }
  const curChat = S.chats.find((x) => x.id === S.chatId);
  if (curChat && curChat.title === "Новый чат" && !resend?.reuse) {
    // сразу показываем заголовок чата в сайдбаре, чтобы при переключении чата не висело "Новый чат"
    curChat.title = (content || (atts[0]?.name ?? "Чат")).replace(/\n/g, " ").slice(0, 60);
    renderList();
    syncTitle();
  }
  if (!resend) {
    E.input.value = "";
    autosize();
    S.pending = [];
    renderPending();
  }
  E.empty.classList.add("hidden");
  E.thread.classList.remove("hidden");

  let userMsg;
  if (resend?.reuse) {
    userMsg = S.messages[S.messages.length - 1];
  } else {
    userMsg = { id: null, role: "user", content, attachments: atts };
    S.messages.push(userMsg);
    E.thread.append(userEl(userMsg, S.messages.length - 1, true));
  }

  const chatId = S.chatId;
  const payload = {
    content,
    attachments: atts.map((a) => a.id),
    web_search: S.web,
    think: S.think,
    reuse_last_user: Boolean(resend?.reuse),
    regen_mode: resend?.mode && resend.mode !== "retry" ? resend.mode : null,
  };

  await runStreamView({ chatId, userMsg, startPayload: payload, contentBackup: resend ? null : content });
}

async function attachToRunningChat(chatId) {
  if (S.chatId !== chatId || S.streamingChatId === chatId) return;
  E.empty.classList.add("hidden");
  E.thread.classList.remove("hidden");
  const lastUser = [...S.messages].reverse().find((m) => m.role === "user") || null;
  await runStreamView({ chatId, userMsg: lastUser, startPayload: null, contentBackup: null });
}

async function runStreamView({ chatId, userMsg, startPayload, contentBackup }) {
  detachViewStream();
  const abort = new AbortController();
  S.viewAbort = abort;
  S.streamingChatId = chatId;
  S.generatingChats.add(chatId);
  renderList();
  syncSend();

  const asst = { id: null, role: "assistant", content: "", reasoning: "", has_thinking: false, tools: [], stats: null };
  const view = assistantEl(asst, -1, true);
  view.setTyping(true);
  E.thread.append(view.root);
  markLast();
  scrollDown(true);

  const t0 = performance.now();
  let thinkEnd = 0;
  let thinkingActive = false;
  let thinkSec = 0;
  let lastPaint = 0;
  let paintTimer = 0;
  let lastChip = null;
  let finishedOnServer = false;
  let syncNeeded = false;
  let failed = false;

  const paintNow = () => {
    paintTimer = 0;
    lastPaint = performance.now();
    if (asst.content) {
      view.setContent(asst.content);
    } else if (!thinkingActive) {
      view.setTyping(true);
    } else {
      // пока модель думает (у гостей), убираем лишнюю звёздочку в теле - работает индикатор "Думаю..."
      view.setContent("");
    }
    if (S.isAdmin) {
      view.setReasoning(asst.reasoning, !asst.content && Boolean(asst.reasoning));
    } else {
      view.setGuestThinking(thinkingActive, asst.has_thinking, thinkSec);
    }
    scrollDown();
  };

  // лёгкий троттлинг ~45 мс убирает дёрганье глаз от перерисовки Markdown на каждом токене
  const schedulePaint = () => {
    if (paintTimer) return;
    const wait = Math.max(0, 45 - (performance.now() - lastPaint));
    paintTimer = window.setTimeout(() => requestAnimationFrame(paintNow), wait);
  };

  const onEvent = (ev) => {
    switch (ev.type) {
      case "start":
        if (userMsg && ev.user_message_id) userMsg.id = ev.user_message_id;
        break;
      case "snapshot":
        if (userMsg && ev.user_message_id) userMsg.id = ev.user_message_id;
        view.setStatus(ev.status || "");
        asst.content = ev.content || "";
        asst.reasoning = S.isAdmin ? (ev.reasoning || "") : "";
        asst.has_thinking = Boolean(ev.has_thinking || ev.thinking);
        thinkingActive = Boolean(ev.thinking);
        thinkSec = ev.think_sec || 0;
        asst.tools = [];
        view.clearTools();
        for (const t of ev.tools || []) {
          lastChip = view.addTool(t.name, t.args || {});
          asst.tools.push(t);
        }
        paintNow();
        break;
      case "status":
        view.setStatus(ev.text || "");
        break;
      case "thinking":
        view.setStatus("");
        thinkingActive = Boolean(ev.active);
        if (ev.active) asst.has_thinking = true;
        if (ev.seconds) thinkSec = ev.seconds;
        paintNow();
        break;
      case "reasoning":
        view.setStatus("");
        asst.has_thinking = true;
        if (S.isAdmin) {
          asst.reasoning += ev.text || "";
          if (!asst.content) view.setThinkLabel("Размышляю…");
          schedulePaint();
        } else {
          thinkingActive = true;
          paintNow();
        }
        break;
      case "content":
        view.setStatus("");
        if (!asst.content && (asst.reasoning || thinkingActive)) {
          thinkEnd = performance.now();
          thinkingActive = false;
          if (!thinkSec) thinkSec = Math.max(1, Math.round((thinkEnd - t0) / 1000));
          if (S.isAdmin) {
            view.setThinkLabel(`Размышления · ${thinkSec} с`);
            view.collapseAdminThink();
          }
        }
        asst.content += ev.text || "";
        schedulePaint();
        break;
      case "tool":
        lastChip = view.addTool(ev.name, ev.args || {});
        asst.tools.push({ name: ev.name, args: ev.args || {} });
        break;
      case "tool_result":
        if (lastChip) lastChip.title = ev.preview || "";
        break;
      case "done":
        finishedOnServer = true;
        thinkingActive = false;
        if (ev.has_thinking) asst.has_thinking = true;
        if (ev.think_sec) thinkSec = ev.think_sec;
        asst.id = ev.message_id || null;
        asst.stats = ev.stats || null;
        if (ev.usage) S.onUsage(ev.usage);
        break;
      case "sync":
        finishedOnServer = true;
        syncNeeded = true;
        break;
      case "error":
        finishedOnServer = true;
        failed = true;
        thinkingActive = false;
        view.error(ev.message || "Ошибка генерации");
        break;
    }
  };

  try {
    if (startPayload) {
      try {
        await stream(`/api/chats/${chatId}/messages`, startPayload, onEvent, abort.signal);
      } catch (err) {
        // ошибка валидации/лимита/бана (HTTP 4xx) - не ретраим, сразу показываем и возвращаем текст
        if (err.name === "AbortError" || err.status) throw err;
        // сетевой разрыв при сворачивании вкладки или смене URL туннеля -> переподключаемся к фоновой задаче
        await reconnectLoop(chatId, onEvent, abort.signal, () => finishedOnServer);
      }
    } else {
      await reconnectLoop(chatId, onEvent, abort.signal, () => finishedOnServer, true);
    }

    // если поток закрылся без done/error (телефон усыпил сокет), тихо переподключаемся, пока чат открыт
    if (!finishedOnServer && !abort.signal.aborted) {
      await reconnectLoop(chatId, onEvent, abort.signal, () => finishedOnServer, true);
    }
  } catch (e) {
    if (e.name !== "AbortError") {
      failed = true;
      finishedOnServer = true;
      view.error(e.message || "Не удалось подключиться к серверу");
      if (e.status && !userMsg?.id && contentBackup) {
        S.messages.pop();
        E.input.value = contentBackup;
        autosize();
      }
    }
  } finally {
    if (paintTimer) clearTimeout(paintTimer);
    view.setStatus("");
    if (S.viewAbort === abort) S.viewAbort = null;
    if (S.streamingChatId === chatId) S.streamingChatId = null;

    if (finishedOnServer) {
      S.generatingChats.delete(chatId);
      renderList();
    }
    syncSend();

    // если пользователь переключился на другой чат - не трогаем DOM нового чата
    if (S.chatId !== chatId) return;

    if (syncNeeded) {
      await reloadQuiet(chatId);
    } else if (finishedOnServer) {
      paintNow();
      if (asst.content.trim() || asst.tools.length) {
        S.messages.push(asst);
        // обновляем кнопки действий прямо на месте без перерисовки всего треда (ноль мигания экрана)
        view.setActions(asst, S.messages.length - 1);
        markLast();
      } else if (!failed) {
        view.root.remove();
        markLast();
      } else {
        view.setContent("");
      }
      refreshTitle(chatId);
    } else if (abort.signal.aborted) {
      // клиент сам отцепился от просмотра (не стоп)
    }
  }
}

async function reconnectLoop(chatId, onEvent, signal, isDone, immediateFirst = false) {
  const delays = immediateFirst ? [0, 900, 1800, 3000, 4500] : [900, 1800, 3000, 4500];
  let lastErr = null;
  for (const ms of delays) {
    if (signal.aborted || isDone()) return;
    if (ms > 0) {
      await new Promise((r) => setTimeout(r, ms));
      if (signal.aborted || isDone()) return;
      await resolveApiBase(true).catch(() => {});
    }
    try {
      await streamGet(`/api/chats/${chatId}/stream`, onEvent, signal);
      if (isDone() || signal.aborted) return;
    } catch (err) {
      if (err.name === "AbortError" || err.status) throw err;
      lastErr = err;
    }
  }
  if (lastErr && !isDone() && !signal.aborted) throw lastErr;
}

async function reloadQuiet(chatId) {
  try {
    const data = await api(`/api/chats/${chatId}`);
    if (S.chatId === chatId) {
      S.messages = data.messages;
      renderMessages(false);
    }
  } catch {}
}

async function refreshTitle(chatId) {
  const c = S.chats.find((x) => x.id === chatId);
  try {
    S.chats = await api("/api/chats");
    for (const row of S.chats) {
      if (row.generating) S.generatingChats.add(row.id);
      else S.generatingChats.delete(row.id);
    }
    renderList();
    if (!c || c.title === "Новый чат") syncTitle();
  } catch {}
}

async function stopCurrent() {
  const cid = S.chatId;
  if (!cid) return;
  try {
    await api(`/api/chats/${cid}/stop`, { method: "POST" });
  } catch {}
  S.generatingChats.delete(cid);
  renderList();
  syncSend();
}
