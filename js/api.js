// обёртка над API бэкенда: динамический адрес туннеля, токен, JSON, файлы, SSE-стрим
let currentBase = (window.NEUROHUB_API || "").replace(/\/$/, "");
let resolvedOnce = false;

export function getBase() {
  return currentBase;
}

export async function resolveApiBase(force = false) {
  if (resolvedOnce && !force) return currentBase;
  resolvedOnce = true;

  const qsApi = new URLSearchParams(location.search).get("api");
  if (qsApi) {
    currentBase = qsApi.trim().replace(/\/$/, "");
    return currentBase;
  }
  const saved = (localStorage.getItem("nh_api") || "").trim().replace(/\/$/, "");
  if (saved) {
    currentBase = saved;
    return currentBase;
  }
  if (window.NEUROHUB_API) {
    currentBase = String(window.NEUROHUB_API).trim().replace(/\/$/, "");
    return currentBase;
  }
  const pointer = (window.NEUROHUB_ENDPOINT_JSON || "").trim();
  const fallback = (window.NEUROHUB_ENDPOINT_FALLBACK || "").trim();
  if (!pointer && !fallback) return currentBase;

  const extractApi = (data) => {
    if (data?.api) return String(data.api).trim().replace(/\/$/, "");
    // GitHub Gist REST API возвращает files["klodeg-endpoint.json"].content без кэша CDN
    const f = data?.files && (data.files["klodeg-endpoint.json"] || Object.values(data.files)[0]);
    if (f?.content) {
      const inner = JSON.parse(f.content);
      if (inner?.api) return String(inner.api).trim().replace(/\/$/, "");
    }
    return "";
  };

  for (const url of [pointer, fallback].filter(Boolean)) {
    try {
      const sep = url.includes("?") ? "&" : "?";
      const res = await fetch(`${url}${sep}t=${Date.now()}`, { cache: "no-store" });
      if (res.ok) {
        const apiUrl = extractApi(await res.json());
        if (apiUrl) {
          currentBase = apiUrl;
          return currentBase;
        }
      }
    } catch {
      // пробуем резервный URL или покажем оффлайн-экран при вызове /api/status
    }
  }
  return currentBase;
}

export const auth = {
  get token() { return localStorage.getItem("nh_token"); },
  set token(v) { v ? localStorage.setItem("nh_token", v) : localStorage.removeItem("nh_token"); },
};

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function handle(res) {
  if (res.ok) return res.status === 204 ? null : res.json();
  let msg = `Ошибка ${res.status}`;
  try {
    const data = await res.json();
    if (typeof data.detail === "string") msg = data.detail;
    else if (Array.isArray(data.detail)) msg = data.detail.map((d) => d.msg).join("; ");
  } catch { /* не JSON */ }
  if (res.status === 401) window.dispatchEvent(new CustomEvent("nh:unauthorized"));
  if (res.status === 403 && msg.includes("приостановлен")) {
    window.dispatchEvent(new CustomEvent("nh:banned"));
  }
  throw new ApiError(res.status, msg);
}

function headers(extra = {}) {
  const h = { ...extra };
  if (auth.token) h.Authorization = `Bearer ${auth.token}`;
  return h;
}

async function fetchWithRetry(path, init) {
  try {
    return await fetch(currentBase + path, init);
  } catch (err) {
    // если туннель сменил адрес во время работы, подтягиваем свежий URL из Gist и повторяем раз
    if (window.NEUROHUB_ENDPOINT_JSON && !localStorage.getItem("nh_api")) {
      const prev = currentBase;
      await resolveApiBase(true);
      if (currentBase && currentBase !== prev) {
        return fetch(currentBase + path, init);
      }
    }
    throw err;
  }
}

export async function api(path, { method = "GET", body } = {}) {
  const res = await fetchWithRetry(path, {
    method,
    headers: headers(body !== undefined ? { "Content-Type": "application/json" } : {}),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return handle(res);
}

export async function upload(file, path = "/api/upload") {
  const fd = new FormData();
  fd.append("file", file, file.name || "file");
  const res = await fetchWithRetry(path, { method: "POST", headers: headers(), body: fd });
  return handle(res);
}

const blobCache = new Map();
export async function fileUrl(id) {
  if (blobCache.has(id)) return blobCache.get(id);
  const res = await fetch(`${currentBase}/api/files/${id}`, { headers: headers() });
  if (!res.ok) throw new ApiError(res.status, "Файл недоступен");
  const url = URL.createObjectURL(await res.blob());
  blobCache.set(id, url);
  return url;
}

export function wsUrl(path) {
  const base = currentBase
    ? currentBase.replace(/^http/, "ws")
    : `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}`;
  return `${base}${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(auth.token || "")}`;
}

export async function stream(path, body, onEvent, signal) {
  const res = await fetchWithRetry(path, {
    method: "POST",
    headers: headers({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) return handle(res);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const flush = (chunk) => {
    for (const line of chunk.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      try {
        onEvent(JSON.parse(line.slice(6)));
      } catch (e) {
        console.error(e);
      }
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      flush(buf.slice(0, idx));
      buf = buf.slice(idx + 2);
    }
  }
  if (buf.trim()) flush(buf);
}
