// Режим «Чат»: список чатов, сообщения, правка с перегенерацией, откат, «Повторить / Короче / Длиннее».
import { api, stream, upload, fileUrl } from "./api.js";
import { $, el, icon, setIcon, setChildren, toast, renderMarkdown, lightbox, copyText, ask, isMobile } from "./ui.js";

const S = {
  chats: [],
  chatId: null,
  messages: [],
  pending: [],
  web: localStorage.getItem("nh_web") === "1",
  think: localStorage.getItem("nh_think") !== "0",
  controller: null,
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
    file: $("#file-input"),
    attRow: $("#att-row"),
    box: $("#composer-box"),
    search: $("#chat-search"),
    down: $("#btn-scroll-down"),
  });

  $("#btn-new-chat").addEventListener("click", () => newChat());
  E.form.addEventListener("submit", (e) => {
    e.preventDefault();
    S.controller ? stop() : send();
  });
  E.input.addEventListener("keydown", (e) => {
    // На телефоне Enter - перенос строки, отправка кнопкой
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && !isMobile()) {
      e.preventDefault();
      if (!S.controller) send();
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
    localStorage.setItem("nh_web", S.web ? "1" : "0");
    syncToggles();
  });
  E.think.addEventListener("click", () => {
    S.think = !S.think;
    localStorage.setItem("nh_think", S.think ? "1" : "0");
    syncToggles();
    toast(S.think ? "Модель будет размышлять перед ответом" : "Быстрые ответы без размышлений");
  });
  for (const ev of ["dragenter", "dragover"])
    E.box.addEventListener(ev, (e) => {
      e.preventDefault();
      E.box.classList.add("drag");
    });
  for (const ev of ["dragleave", "drop"]) E.box.addEventListener(ev, () => E.box.classList.remove("drag"));
  E.box.addEventListener("drop", (e) => {
    e.preventDefault();
    [...e.dataTransfer.files].forEach(addFile);
  });
  E.search.addEventListener("input", () => {
    S.filter = E.search.value.trim().toLowerCase();
    renderList();
  });
  // Кнопка «вниз» видна, пока конец переписки за пределами экрана (с запасом 120px)
  new IntersectionObserver(
    ([entry]) => E.down.classList.toggle("hidden", entry.isIntersecting || !S.messages.length),
    { root: E.scroller, rootMargin: "0px 0px 120px 0px" }
  ).observe($("#thread-end"));
  E.down.addEventListener("click", () => scrollDown(true, true));
  window.addEventListener("nh:chat-shown", syncTitle);

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

function syncToggles() {
  E.web.setAttribute("aria-pressed", String(S.web));
  E.think.setAttribute("aria-pressed", String(S.think));
}

function syncSend() {
  const busy = Boolean(S.controller);
  setIcon(E.send, busy ? "stop" : "arrowUp");
  E.send.setAttribute("aria-label", busy ? "Остановить" : "Отправить");
  E.send.classList.toggle("stop", busy);
  E.send.disabled = !busy && !E.input.value.trim() && !S.pending.some((p) => p.meta);
}

function autosize() {
  E.input.style.height = "auto";
  E.input.style.height = Math.min(E.input.scrollHeight, 220) + "px";
}

function syncTitle() {
  // Чат, открытый фоном, не должен перебивать заголовок другого режима
  if ($(".view-chat").classList.contains("hidden")) return;
  const c = S.chats.find((x) => x.id === S.chatId);
  $("#topbar-title").textContent = c ? c.title : "Новый чат";
}

// ---------------- список чатов ----------------
export async function loadChats() {
  S.chats = await api("/api/chats");
  renderList();
  if (S.chats.length && !S.chatId && !isMobile()) openChat(S.chats[0].id, false); // фоном: не уводить из режима, открытого по ссылке #image и т.п.
  else renderMessages();
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
    items.push(
      el(
        "li",
        { class: "chat-item" },
        el("button", {
          type: "button", class: "chat-open", text: c.title, title: c.title,
          "aria-current": c.id === S.chatId ? "page" : null,
          onclick: () => openChat(c.id),
        }),
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
    S.chats = S.chats.filter((x) => x.id !== c.id);
    if (S.chatId === c.id) newChat(false);
    renderList();
  } catch (e) {
    toast(e.message, true);
  }
}

export function newChat(focus = true) {
  if (S.controller) stop();
  S.chatId = null;
  S.messages = [];
  renderMessages();
  renderList();
  syncTitle();
  window.dispatchEvent(new CustomEvent("nh:open-chat-mode"));
  if (focus && !isMobile()) E.input.focus();
}

async function openChat(id, showChatMode = true) {
  if (showChatMode) window.dispatchEvent(new CustomEvent("nh:open-chat-mode"));
  if (S.controller) stop();
  S.chatId = id;
  renderList();
  syncTitle();
  try {
    const data = await api(`/api/chats/${id}`);
    if (S.chatId !== id) return;
    S.messages = data.messages;
    renderMessages();
  } catch (e) {
    toast(e.message, true);
  }
}

// ---------------- отрисовка ----------------
function renderMessages() {
  const has = S.messages.length > 0;
  E.empty.classList.toggle("hidden", has);
  E.thread.classList.toggle("hidden", !has);
  setChildren(
    E.thread,
    S.messages.map((m, i) => (m.role === "user" ? userEl(m, i) : assistantEl(m, i).root))
  );
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

function userEl(m, idx) {
  const root = el("div", { class: "msg user" });
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
  if (S.controller) return;
  const ta = el("textarea", { rows: 3 });
  ta.value = m.content || "";
  const box = el(
    "div",
    { class: "edit-box" },
    ta,
    el(
      "div",
      { class: "row" },
      el("button", { type: "button", class: "btn ghost", text: "Отмена", onclick: () => renderMessages() }),
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

function assistantEl(m, idx) {
  const root = el("div", { class: "msg assistant" });
  const thinkBody = el("div", { class: "think-body" });
  const thinkSum = el("summary", { text: "Размышления" });
  const think = el("details", { class: "think hidden" }, thinkSum, thinkBody);
  const tools = el("div", { class: "tools hidden" });
  const status = el("div", { class: "status-line hidden" });
  const body = el("div", { class: "md" });
  const actions = el("div", { class: "actions" });
  root.append(think, tools, status, body, actions);

  const view = {
    root,
    think,
    setReasoning(text, live = false) {
      think.classList.toggle("hidden", !text);
      think.classList.toggle("live", live);
      thinkBody.textContent = text;
      if (live) thinkBody.scrollTop = thinkBody.scrollHeight;
    },
    setThinkLabel(t) { thinkSum.textContent = t; },
    setContent(text) { body.innerHTML = renderMarkdown(text); },
    setTyping(on) {
      if (on) setChildren(body, el("span", { class: "typing-dots" }, el("i"), el("i"), el("i")));
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
    error(text) { root.insertBefore(el("div", { class: "error-box", text }), actions); },
    setActions(msg, i) {
      const isLast = i === S.messages.length - 1;
      setChildren(
        actions,
        actBtn("copy", "", () => copyText(msg.content || "", "Ответ скопирован"), "Копировать"),
        actBtn("refresh", "", () => regenerate(i, "retry"), "Ответить заново"),
        actBtn("shorter", "", () => regenerate(i, "shorter"), "Короче"),
        actBtn("longer", "", () => regenerate(i, "longer"), "Подробнее"),
        !isLast && msg.id ? actBtn("rewind", "", () => rewindTo(msg, i), "Откатить диалог сюда") : null,
        msg.stats?.gen_tps ? el("span", { class: "stat", title: `Промпт: ${msg.stats.prompt_tps} ток/с`, text: `${msg.stats.gen_tps} ток/с` }) : null
      );
    },
  };
  view.setReasoning(m.reasoning || "");
  (m.tools || []).forEach((t) => view.addTool(t.name, t.args || {}));
  view.setContent(m.content);
  view.setActions(m, idx);
  return view;
}

function nearBottom() {
  const s = E.scroller;
  return s.scrollHeight - s.scrollTop - s.clientHeight < 120;
}

function scrollDown(force = false, smooth = false) {
  if (force || nearBottom()) E.scroller.scrollTo({ top: E.scroller.scrollHeight, behavior: smooth ? "smooth" : "auto" });
}

// ---------------- откат, правка, перегенерация ----------------
async function rewindTo(m, idx) {
  if (S.controller || !m.id) return;
  const removed = S.messages.length - 1 - idx;
  if (removed <= 0) return;
  if (!(await ask({ title: "Откатить диалог?", text: `Сообщения ниже этого (${removed}) будут удалены.`, ok: "Откатить", danger: true }))) return;
  try {
    await api(`/api/chats/${S.chatId}/messages/${m.id}/rewind`, { method: "DELETE" });
    S.messages = S.messages.slice(0, idx + 1);
    renderMessages();
  } catch (e) {
    toast(e.message, true);
  }
}

async function editAndRegenerate(m, idx, text) {
  if (S.controller) return;
  if (m.id) {
    try {
      await api(`/api/chats/${S.chatId}/messages/${m.id}/after`, { method: "DELETE" });
    } catch (e) {
      return toast(e.message, true);
    }
  }
  S.messages = S.messages.slice(0, idx);
  renderMessages();
  await send({ content: text, attachments: m.attachments || [] });
}

async function regenerate(asstIdx, mode) {
  if (S.controller) return;
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
  renderMessages();
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

// ---------------- отправка ----------------
async function send(resend) {
  if (S.controller) return;
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
    E.thread.append(userEl(userMsg, S.messages.length - 1));
  }

  const asst = { id: null, role: "assistant", content: "", reasoning: "", tools: [], stats: null };
  const view = assistantEl(asst, S.messages.length);
  view.setActions = () => {};
  view.setTyping(true);
  E.thread.append(view.root);
  markLast();
  scrollDown(true);

  S.controller = new AbortController();
  syncSend();
  const chatId = S.chatId;
  const t0 = performance.now();
  let thinkEnd = 0;
  let raf = 0;
  const paint = () => {
    raf = 0;
    if (asst.content) view.setContent(asst.content);
    view.setReasoning(asst.reasoning, !asst.content);
    scrollDown();
  };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(paint); };
  let lastChip = null;
  let failed = false;

  try {
    await stream(
      `/api/chats/${chatId}/messages`,
      {
        content,
        attachments: atts.map((a) => a.id),
        web_search: S.web,
        think: S.think,
        reuse_last_user: Boolean(resend?.reuse),
        regen_mode: resend?.mode && resend.mode !== "retry" ? resend.mode : null,
      },
      (ev) => {
        switch (ev.type) {
          case "start":
            userMsg.id = ev.user_message_id;
            break;
          case "status":
            view.setStatus(ev.text);
            break;
          case "reasoning":
            view.setStatus("");
            asst.reasoning += ev.text;
            if (!asst.content) view.setThinkLabel("Размышляю…");
            schedule();
            break;
          case "content":
            view.setStatus("");
            if (!asst.content && asst.reasoning) {
              thinkEnd = performance.now();
              view.setThinkLabel(`Размышления · ${Math.max(1, Math.round((thinkEnd - t0) / 1000))} с`);
              view.think.open = false;
            }
            asst.content += ev.text;
            schedule();
            break;
          case "tool":
            lastChip = view.addTool(ev.name, ev.args);
            asst.tools.push({ name: ev.name, args: ev.args });
            break;
          case "tool_result":
            if (lastChip) lastChip.title = ev.preview;
            break;
          case "done":
            asst.id = ev.message_id;
            asst.stats = ev.stats;
            if (ev.usage) S.onUsage(ev.usage);
            break;
          case "error":
            failed = true;
            view.error(ev.message);
            break;
        }
      },
      S.controller.signal
    );
  } catch (e) {
    if (e.name !== "AbortError") {
      failed = true;
      view.error(e.message);
      // Сервер отклонил запрос (лимит, блокировка) - сообщение не сохранилось, вернём текст в поле
      if (e.status && !userMsg.id && !resend) {
        S.messages.pop();
        E.input.value = content;
        autosize();
      }
    }
  } finally {
    if (raf) cancelAnimationFrame(raf);
    view.setStatus("");
    if (asst.reasoning && !thinkEnd) view.setThinkLabel("Размышления");
    const aborted = S.controller?.signal.aborted;
    S.controller = null;
    syncSend();
    if (asst.content || asst.reasoning) {
      S.messages.push(asst);
      if (!asst.id && aborted) {
        // При остановке сервер сохранил ответ сам - перечитываем чат, чтобы получить настоящие id
        await reloadQuiet(chatId);
      } else if (!failed) {
        renderMessages();
      }
    } else {
      view.setContent(""); // убираем «печатает…»
    }
    if (S.chatId === chatId) refreshTitle(chatId);
  }
}

async function reloadQuiet(chatId) {
  try {
    const data = await api(`/api/chats/${chatId}`);
    if (S.chatId === chatId) {
      S.messages = data.messages;
      renderMessages();
    }
  } catch {}
}

async function refreshTitle(chatId) {
  const c = S.chats.find((x) => x.id === chatId);
  try {
    S.chats = await api("/api/chats");
    renderList();
    if (!c || c.title === "Новый чат") syncTitle();
  } catch {}
}

function stop() {
  S.controller?.abort();
}
