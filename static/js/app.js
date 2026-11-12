const $ = (s) => document.querySelector(s);
const KEY = "evergreen_chat_v1";
const SUGGESTIONS = ["Explain context windows simply", "Write a Python function to reverse a string", "Give me 3 project ideas for beginners"];

let state = load();
let controller = null;

function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.sessions && s.sessions.length) return s; } catch (e) {}
  const id = uid();
  return { activeId: id, sessions: [newSession(id)] };
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function newSession(id) { return { id, title: "New chat", system: window.DEFAULT_SYSTEM, messages: [] }; }
function active() { return state.sessions.find((s) => s.id === state.activeId); }

function renderMarkdown(text) {
  return DOMPurify.sanitize(marked.parse(text, { breaks: true }));
}

function renderSessions() {
  const list = $("#sessionList");
  list.innerHTML = "";
  state.sessions.forEach((s) => {
    const li = document.createElement("li");
    if (s.id === state.activeId) li.className = "active";
    li.innerHTML = `<i class="bi bi-chat-left"></i><span></span><button class="del" aria-label="Delete chat"><i class="bi bi-x-lg"></i></button>`;
    li.querySelector("span").textContent = s.title;
    li.onclick = () => { state.activeId = s.id; save(); renderAll(); closeSidebar(); };
    li.querySelector(".del").onclick = (e) => { e.stopPropagation(); deleteSession(s.id); };
    list.appendChild(li);
  });
}

function renderMessages() {
  const box = $("#messages");
  box.innerHTML = "";
  const s = active();
  if (!s.messages.length) {
    box.innerHTML = `<div class="empty"><h2>What can I help with?</h2><p>Start a conversation or try one of these.</p><div class="chips"></div></div>`;
    SUGGESTIONS.forEach((t) => {
      const b = document.createElement("button");
      b.className = "chip"; b.textContent = t;
      b.onclick = () => { $("#input").value = t; send(); };
      box.querySelector(".chips").appendChild(b);
    });
    return;
  }
  s.messages.forEach((m) => addBubble(m.role, m.content));
  box.scrollTop = box.scrollHeight;
}

function addBubble(role, text) {
  const el = document.createElement("div");
  el.className = "msg " + role;
  if (role === "assistant") el.innerHTML = text ? renderMarkdown(text) : `<span class="typing"><i></i><i></i><i></i></span>`;
  else el.textContent = text;
  $("#messages").appendChild(el);
  return el;
}

function renderAll() { renderSessions(); renderMessages(); hideError(); }
function closeSidebar() {
  const el = $("#sidebar");
  const inst = bootstrap.Offcanvas.getInstance(el);
  if (inst) inst.hide();
}
function showError(msg) { const e = $("#errorBox"); e.textContent = msg; e.classList.remove("d-none"); }
function hideError() { $("#errorBox").classList.add("d-none"); }

function deleteSession(id) {
  state.sessions = state.sessions.filter((s) => s.id !== id);
  if (!state.sessions.length) { const n = uid(); state.sessions.push(newSession(n)); state.activeId = n; }
  else if (state.activeId === id) state.activeId = state.sessions[0].id;
  save(); renderAll();
}

function setBusy(busy) {
  $("#sendBtn").classList.toggle("d-none", busy);
  $("#stopBtn").classList.toggle("d-none", !busy);
  $("#input").disabled = busy;
  if (!busy) $("#input").focus();
}

async function send() {
  const input = $("#input");
  const text = input.value.trim();
  if (!text || controller) return;
  const s = active();
  hideError();
  s.messages.push({ role: "user", content: text });
  if (s.messages.length === 1) s.title = text.slice(0, 40);
  input.value = ""; autoGrow();
  save(); renderSessions(); renderMessages();

  const bubble = addBubble("assistant", "");
  const box = $("#messages");
  box.scrollTop = box.scrollHeight;
  let reply = "";
  controller = new AbortController();
  setBusy(true);

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ system: s.system, messages: s.messages }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Server error (" + res.status + ").");
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n"); buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        const d = JSON.parse(line);
        if (d.error) throw new Error(d.error);
        if (d.reset) { reply = ""; bubble.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>'; continue; }
        reply += d.text;
        bubble.innerHTML = renderMarkdown(reply);
        box.scrollTop = box.scrollHeight;
      }
    }
  } catch (err) {
    if (err.name !== "AbortError") {
      showError(err.message || "Network error. Check your connection.");
      if (reply) { reply += "\n\n*(reply interrupted)*"; bubble.innerHTML = renderMarkdown(reply); }
    }
  } finally {
    if (reply) {
      s.messages.push({ role: "assistant", content: reply });
    } else {
      // Failed or stopped before any reply: undo the question so a retry does not duplicate it
      bubble.remove();
      if (s.messages.at(-1)?.role === "user") s.messages.pop();
      input.value = text; autoGrow();
      if (!s.messages.length) s.title = "New chat";
    }
    controller = null; setBusy(false); save();
    renderSessions(); renderMessages();
  }
}

function autoGrow() { const t = $("#input"); t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 140) + "px"; }

$("#chatForm").addEventListener("submit", (e) => { e.preventDefault(); send(); });
$("#input").addEventListener("input", autoGrow);
$("#input").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
$("#stopBtn").onclick = () => controller && controller.abort();
$("#newChatBtn").onclick = () => { const id = uid(); state.sessions.unshift(newSession(id)); state.activeId = id; save(); renderAll(); };
$("#clearBtn").onclick = () => { const s = active(); s.messages = []; s.title = "New chat"; save(); renderAll(); };
$("#systemModal").addEventListener("show.bs.modal", () => { $("#systemInput").value = active().system; });
$("#saveSystem").onclick = () => { active().system = $("#systemInput").value.trim() || window.DEFAULT_SYSTEM; save(); };
$("#resetSystem").onclick = () => { $("#systemInput").value = window.DEFAULT_SYSTEM; };

renderAll();
