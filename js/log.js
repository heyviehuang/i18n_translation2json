import { escapeHtml as esc } from "./utils/html.js";
import { copyText } from "./utils/clipboard.js";
import { showToast } from "./ui/toast.js";
import { jsonp } from "./services/api.js";
import { LOG_API_BASE, TOKEN, ADMIN_KEY_NAME } from "./config.js";

const form = document.getElementById("logForm");
const titleInput = document.getElementById("noteTitle");
const bodyInput = document.getElementById("noteBody");
const clearBtn = document.getElementById("noteClear");
const saveBtn = document.getElementById("noteSave");
const notesList = document.getElementById("logNotes");
const searchInput = document.getElementById("noteSearch");
const statsEl = document.getElementById("noteStats");
const openDrawerBtn = document.getElementById("openDrawer");
const closeDrawerBtn = document.getElementById("closeDrawer");
const drawer = document.getElementById("drawer");
const drawerOverlay = document.getElementById("drawerOverlay");
const drawerTitle = document.getElementById("drawerTitle");
const viewerTitle = document.getElementById("viewerTitle");
const viewerBody = document.getElementById("viewerBody");
const paletteBtn = document.getElementById("btnPalette");
const paletteCloseBtn = document.getElementById("btnPaletteClose");
const palettePanel = document.getElementById("palettePanel");
const paletteOverlay = document.getElementById("paletteOverlay");
const prevBtn = document.getElementById("btnPrevLog");
const nextBtn = document.getElementById("btnNextLog");
const speakBtn = document.getElementById("btnSpeak");
let speaking = false;
let voices = [];

let notes = [];
let editingId = null;
let selectedNoteId = null;
let loading = false;

const maskEnabled = true;

function getAdminKey() {
    return localStorage.getItem(ADMIN_KEY_NAME) || "";
}

function ensureAdmin() {
    let key = getAdminKey();
    if (!key) {
        key = prompt("Enter admin PIN");
        if (!key) return null;
        localStorage.setItem(ADMIN_KEY_NAME, key);
    }
    return key;
}

function guardLogAccess() {
    const key = ensureAdmin();
    if (!key) {
        showToast("Log PIN required");
        return false;
    }
    return true;
}

async function fetchLogs() {
    const response = await jsonp({ action: "list", token: TOKEN }, { base: LOG_API_BASE });
    if (!response?.ok) throw new Error(response?.error || "Failed to load logs");
    const payload = Array.isArray(response.items) ? response.items : [];
    return payload.map(normalizeNote);
}

async function createRemoteLog({ title, body }) {
    const response = await jsonp({ action: "add", token: TOKEN, title, body }, { base: LOG_API_BASE });
    if (!response?.ok) throw new Error(response?.error || "Failed to add log");
    const item = response.item ?? response;
    return normalizeNote(item);
}

async function deleteRemoteLogs(ids = [], adminKey) {
    if (!ids?.length) return 0;
    const response = await jsonp(
        { action: "delete", token: TOKEN, ids: ids.join(","), adminKey },
        { base: LOG_API_BASE }
    );
    if (!response?.ok) throw new Error(response?.error || "Failed to delete log");
    return response.changed ?? ids.length;
}

function normalizeNote(raw = {}) {
    const now = new Date().toISOString();
    const title = String(raw.title ?? "").trim();
    const body = String(raw.body ?? "").trim();
    const id = String(raw.id || raw.noteId || `log-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    return {
        id,
        title: title || "Untitled",
        body,
        pinned: Boolean(raw.pinned),
        createdAt: raw.createdAt || now,
        updatedAt: raw.updatedAt || raw.createdAt || now
    };
}

function persistNotes() {
    /* no-op placeholder for legacy calls */
}

function renderStats(position = 0, total = 0) {
    if (!statsEl) return;
    const safeTotal = Math.max(0, total);
    const safePos = Math.max(0, Math.min(safeTotal, position));
    statsEl.textContent = `${safePos}/${safeTotal}`;
}

function formatDate(iso) {
    if (!iso) return "";
    try {
        return new Intl.DateTimeFormat(undefined, {
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit"
        }).format(new Date(iso));
    } catch (error) {
        console.warn("Failed to format note time", error);
        return "";
    }
}

function formatBody(body) {
    const encoded = esc(body);
    const withLines = encoded.replace(/\n/g, "<br>");
    const highlighted = withLines.replace(/([A-Za-z0-9][A-Za-z0-9\s'\-]*)/g, '<span class="log-en">$1</span>');
    return `<div class="log-body">${highlighted}</div>`;
}

function sortedNotes() {
    return [...notes].sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt);
    });
}

function renderViewer(note) {
    if (!viewerTitle || !viewerBody) return;
    if (!note) {
        viewerTitle.textContent = "log()";
        viewerBody.innerHTML = `<p class="muted">// select(log) -> focus();</p>`;
        return;
    }
    viewerTitle.textContent = note.title || "Untitled";
    viewerBody.innerHTML = formatBody(note.body || "");
}

function renderNotes() {
    if (!notesList) return;
    const query = (searchInput?.value || "").trim().toLowerCase();
    const filtered = sortedNotes().filter((note) => {
        if (!query) return true;
        return note.title.toLowerCase().includes(query) || note.body.toLowerCase().includes(query);
    });

    if (loading) {
        notesList.innerHTML = `<li class="notes-item notes-empty">Loading logs...</li>`;
        renderStats(0, notes.length);
        return;
    }

    if (!filtered.length) {
        notesList.innerHTML = `<li class="notes-item notes-empty">No logs yet. Hit "New" on the right.</li>`;
        renderViewer(null);
        renderStats(0, 0);
        return;
    }

    if (!selectedNoteId || !filtered.some((note) => note.id === selectedNoteId)) {
        selectedNoteId = filtered[0].id;
    }

    const idx = filtered.findIndex((note) => note.id === selectedNoteId);
    const position = idx >= 0 ? idx + 1 : 0;
    const total = filtered.length;

    const cards = filtered.map((note) => {
        const timestamp = formatDate(note.updatedAt);
        const preview = note.body ? esc(note.body.slice(0, 120)) : "(empty)";
        const isActive = note.id === selectedNoteId;
        return `<li class="notes-item${isActive ? " is-active" : ""}" data-note-id="${esc(note.id)}">
    <div class="notes-item__meta">
        <span class="notes-item__type">${note.pinned ? "PIN" : "LOG"}</span>
        ${timestamp ? `<time datetime="${esc(note.updatedAt || "")}">${esc(timestamp)}</time>` : ""}
    </div>
    <div class="notes-item__main">
        <div class="notes-item__en">${esc(note.title)}</div>
        <div class="notes-item__zh">${preview}</div>
    </div>
    <div class="notes-item__actions">
        <button type="button" data-action="pin">${note.pinned ? "Unpin" : "Pin"}</button>
        <button type="button" data-action="edit">Edit</button>
        <button type="button" data-action="copy">Copy</button>
        <button type="button" data-action="delete">Delete</button>
    </div>
</li>`;
    });

    notesList.innerHTML = cards.join("\n");
    const current = notes.find((note) => note.id === selectedNoteId) || filtered[0];
    renderViewer(current);
    renderStats(position, total);
}

async function syncLogs({ silent = false } = {}) {
    if (!guardLogAccess()) return;
    loading = true;
    renderNotes();
    try {
        const items = await fetchLogs();
        notes = items;
        selectedNoteId = notes[0]?.id || null;
        renderNotes();
    } catch (error) {
        console.error("Failed to sync logs", error);
        if (!silent) showToast(error?.message || "Failed to load logs");
    } finally {
        loading = false;
        renderNotes();
    }
}

function resetForm() {
    editingId = null;
    form?.reset();
    if (saveBtn) saveBtn.textContent = "Save";
    if (drawerTitle) drawerTitle.textContent = "Add log";
}

function setEditing(noteId) {
    const target = notes.find((entry) => entry.id === noteId);
    if (!target) return;
    editingId = target.id;
    if (titleInput) titleInput.value = target.title;
    if (bodyInput) bodyInput.value = target.body;
    saveBtn.textContent = "Update";
    if (drawerTitle) drawerTitle.textContent = "Edit log";
    openDrawer();
    titleInput?.focus();
}

function upsertNote({ title, body }) {
    const now = new Date().toISOString();
    if (editingId) {
        const existing = notes.find((entry) => entry.id === editingId);
        if (!existing) {
            editingId = null;
        } else {
            existing.title = title || "Untitled";
            existing.body = body;
            existing.updatedAt = now;
            renderNotes();
            closeDrawer();
            speakMixed(existing);
            return existing;
        }
    }

    const created = normalizeNote({
        id: crypto.randomUUID?.() || `log-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        title,
        body,
        createdAt: now,
        updatedAt: now
    });
    notes = [created, ...notes];
    selectedNoteId = created.id;
    renderNotes();
    closeDrawer();
    speakMixed(created);
    return created;
}

async function handleSubmit(event) {
    event.preventDefault();
    const title = (titleInput?.value || "").trim();
    const body = (bodyInput?.value || "").trim();
    if (!title && !body) {
        showToast("Please add a title or body");
        titleInput?.focus();
        return;
    }
    const submitButton = form?.querySelector('button[type="submit"]');
    submitButton?.setAttribute("disabled", "true");
    try {
        let created;
        if (editingId) {
            const adminKey = ensureAdmin();
            if (!adminKey) {
                showToast("Admin PIN required to update");
                return;
            }
            await deleteRemoteLogs([editingId], adminKey);
            notes = notes.filter((entry) => entry.id !== editingId);
        }
        created = await createRemoteLog({ title, body });
        notes = [created, ...notes.filter((entry) => entry.id !== created.id)];
        selectedNoteId = created.id;
        resetForm();
        renderNotes();
        closeDrawer();
        speakMixed(created);
        showToast("Saved");
    } catch (error) {
        console.error("Failed to save log", error);
        showToast(error?.message || "Failed to save log");
    } finally {
        submitButton?.removeAttribute("disabled");
        editingId = null;
    }
}

async function handleListClick(event) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const action = target.dataset.action;
    const card = target.closest("[data-note-id]");
    const noteId = card?.getAttribute("data-note-id");
    if (!noteId) return;
    const note = notes.find((entry) => entry.id === noteId);
    if (!note) return;

    if (!action) {
        selectedNoteId = noteId;
        renderNotes();
        closePalette();
        return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (action === "delete") {
        const adminKey = ensureAdmin();
        if (!adminKey) {
            showToast("Admin PIN required");
            return;
        }
        try {
            await deleteRemoteLogs([noteId], adminKey);
            notes = notes.filter((entry) => entry.id !== noteId);
            selectedNoteId = notes[0]?.id || null;
            renderNotes();
            showToast("Deleted");
            if (editingId === noteId) resetForm();
        } catch (error) {
            console.error("Failed to delete log", error);
            showToast(error?.message || "Failed to delete log");
        }
        return;
    }

    if (action === "copy") {
        const payload = note.body || note.title || "";
        if (!payload) return;
        copyText(payload).then((ok) => showToast(ok ? "Copied" : "Copy failed"));
        return;
    }

    if (action === "pin") {
        note.pinned = !note.pinned;
        note.updatedAt = new Date().toISOString();
        renderNotes();
        return;
    }

    if (action === "edit") {
        setEditing(noteId);
    }
}

function toggleMask() {
    /* mask is always on; no toggle UI */
}

function openPalette() {
    palettePanel?.classList.add("show");
    palettePanel?.setAttribute("aria-hidden", "false");
    paletteOverlay?.classList.add("show");
    paletteOverlay?.setAttribute("aria-hidden", "false");
    paletteBtn?.setAttribute("aria-expanded", "true");
    searchInput?.focus();
}

function closePalette() {
    palettePanel?.classList.remove("show");
    palettePanel?.setAttribute("aria-hidden", "true");
    paletteOverlay?.classList.remove("show");
    paletteOverlay?.setAttribute("aria-hidden", "true");
    paletteBtn?.setAttribute("aria-expanded", "false");
}

function openDrawer() {
    drawer?.classList.add("show");
    drawer?.setAttribute("aria-hidden", "false");
    drawerOverlay?.classList.add("show");
    drawerOverlay?.setAttribute("aria-hidden", "false");
    openDrawerBtn?.setAttribute("aria-expanded", "true");
}

function closeDrawer() {
    drawer?.classList.remove("show");
    drawer?.setAttribute("aria-hidden", "true");
    drawerOverlay?.classList.remove("show");
    drawerOverlay?.setAttribute("aria-hidden", "true");
    openDrawerBtn?.setAttribute("aria-expanded", "false");
}

function getFilteredNotes() {
    const query = (searchInput?.value || "").trim().toLowerCase();
    return sortedNotes().filter((note) => {
        if (!query) return true;
        return note.title.toLowerCase().includes(query) || note.body.toLowerCase().includes(query);
    });
}

function moveSelection(step = 1) {
    const filtered = getFilteredNotes();
    if (!filtered.length) return;
    const idx = filtered.findIndex((note) => note.id === selectedNoteId);
    const currentIdx = idx >= 0 ? idx : 0;
    const nextIdx = (currentIdx + step + filtered.length) % filtered.length;
    selectedNoteId = filtered[nextIdx].id;
    renderNotes();
    speakMixed(filtered[nextIdx]);
}

function speakMixed(log) {
    if (!log || !log.body) return;
    try {
        const text = String(log.body || "");
        const segments = splitSegments(text);
        speechSynthesis.cancel();
        speaking = true;
        updateSpeakLabel();
        let remaining = segments.length;
        segments.forEach((segment) => {
            const utterance = new SpeechSynthesisUtterance(segment.text);
            utterance.lang = segment.isEnglish ? "en-US" : "zh-TW";
            utterance.onend = () => {
                remaining -= 1;
                if (remaining <= 0) {
                    speaking = false;
                    updateSpeakLabel();
                }
            };
            speechSynthesis.speak(utterance);
        });
    } catch (error) {
        console.warn("Speak failed", error);
    }
}

function toggleSpeak() {
    if (speaking) {
        speechSynthesis.cancel();
        speaking = false;
        updateSpeakLabel();
        return;
    }
    const current = notes.find((n) => n.id === selectedNoteId) || notes[0];
    speakMixed(current);
}

function updateSpeakLabel() {
    if (!speakBtn) return;
    speakBtn.textContent = speaking ? "// pause()" : "// speak()";
}

function splitSegments(text) {
    const regex = /[A-Za-z0-9\s'’.,!?;-]+|[^A-Za-z0-9\s'’.,!?;-]+/g;
    const segments = [];
    for (const match of text.matchAll(regex)) {
        const chunk = match[0];
        if (!chunk.trim()) continue;
        const isEnglish = /^[A-Za-z0-9\s'’.,!?;-]+$/.test(chunk);
        segments.push({ text: chunk, isEnglish });
    }
    return segments.length ? segments : [{ text, isEnglish: false }];
}

function pickVoice(isEnglish) {
    const target = isEnglish ? "en" : "zh-TW";
    const exact = voices.find((v) => v.lang === (isEnglish ? "en-US" : "zh-TW"));
    if (exact) return exact;
    const match = voices.find((v) => v.lang?.toLowerCase().startsWith(target.toLowerCase()));
    return match || null;
}

renderStats();
renderNotes();
void syncLogs({ silent: true });

form?.addEventListener("submit", handleSubmit);

clearBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    resetForm();
});

searchInput?.addEventListener("input", () => {
    renderNotes();
});

notesList?.addEventListener("click", handleListClick);
openDrawerBtn?.addEventListener("click", () => {
    openDrawer();
    resetForm();
    titleInput?.focus();
});
closeDrawerBtn?.addEventListener("click", () => {
    closeDrawer();
});
drawerOverlay?.addEventListener("click", () => {
    closeDrawer();
});
paletteBtn?.addEventListener("click", () => {
    openPalette();
});
paletteCloseBtn?.addEventListener("click", () => {
    closePalette();
});
paletteOverlay?.addEventListener("click", () => {
    closePalette();
});
prevBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    moveSelection(-1);
});
nextBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    moveSelection(1);
});
speakBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    toggleSpeak();
});

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
        if (drawer?.classList.contains("show")) {
            closeDrawer();
            return;
        }
        if (palettePanel?.classList.contains("show")) {
            closePalette();
        }
    }
});

if (typeof window !== "undefined" && window.speechSynthesis) {
    voices = window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = () => {
        voices = window.speechSynthesis.getVoices();
    };
}
