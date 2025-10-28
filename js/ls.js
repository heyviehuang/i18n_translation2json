import { LONGPRESS_MS, ADMIN_KEY_NAME } from "./config.js";
import { fetchListeningBatch, markListeningKnown } from "./services/api.js";
import { listNotes, createNote, removeNote, NOTE_TYPES } from "./services/notes.js";
import { speak } from "./utils/speech.js";
import { copyText } from "./utils/clipboard.js";
import { escapeHtml as esc } from "./utils/html.js";
import { showToast } from "./ui/toast.js";
import { createRoundSession } from "./core/session.js";
import { getRoundSize, setRoundSize, resetRoundSize, ROUND_SIZE_LIMITS, DEFAULT_ROUND_SIZE } from "./core/round-size.js";

const codeEl = document.getElementById("code");
const statusEl = document.getElementById("status");
const fabEl = document.getElementById("fab");
const knownBtn = document.getElementById("btnKnown");
const adminBadge = document.getElementById("adminBadge");
const copyEnBtn = document.getElementById("copyEn");
const copyZhBtn = document.getElementById("copyZh");
const roundSizeButton = document.getElementById("btnRoundSize");
const noteToggleBtn = document.getElementById("btnNotes");
const notesOverlay = document.getElementById("notesOverlay");
const notesPanel = document.getElementById("notesPanel");
const noteForm = document.getElementById("noteForm");
const noteEnInput = document.getElementById("noteEn");
const noteZhInput = document.getElementById("noteZh");
const noteUseCurrentBtn = document.getElementById("noteUseCurrent");
const noteCloseBtn = document.getElementById("btnCloseNotes");
const notesListEl = document.getElementById("notesList");
const noteFilterButtons = document.querySelectorAll("[data-note-filter]");

const englishSelector = "[data-role=\"sentence\"]";

const NOTE_FILTER_ALL = "all";
const NOTE_TYPE_LABELS = {
    [NOTE_TYPES.WORD]: "WORD",
    [NOTE_TYPES.PHRASE]: "PHRASE"
};
const NOTES_SYNC_TTL_MS = 60_000;

let adminMode = false;
let pressTimer = null;
let notesCache = [];
let noteFilter = NOTE_FILTER_ALL;
let notesLoading = false;
let notesError = null;
let lastNotesSyncAt = 0;

const MODE_KEY = "ls";
let roundSize = getRoundSize(MODE_KEY);

function updateRoundSizeButton() {
    if (!roundSizeButton) return;
    roundSizeButton.textContent = `Round ${roundSize}`;
}

function applyRoundSize(value) {
    roundSize = value;
    updateRoundSizeButton();
    if (typeof document !== "undefined" && document.body) {
        document.body.dataset.roundSize = String(roundSize);
    }
}

applyRoundSize(roundSize);

function formatNoteDate(isoString) {
    if (!isoString) return "";
    try {
        return new Intl.DateTimeFormat(undefined, {
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit"
        }).format(new Date(isoString));
    } catch (error) {
        console.warn("Failed to format note timestamp", error);
        return "";
    }
}

function isNotesPanelOpen() {
    return notesPanel?.classList.contains("show") ?? false;
}

function updateNoteToggleLabel() {
    if (!noteToggleBtn) return;
    if (notesLoading) {
        noteToggleBtn.textContent = "Notes...";
        return;
    }
    if (notesError) {
        noteToggleBtn.textContent = "Notes (!)";
        return;
    }
    const count = notesCache.length;
    noteToggleBtn.textContent = count > 0 ? `Notes (${count})` : "Notes";
}

function updateFilterButtons() {
    noteFilterButtons.forEach((button) => {
        const targetFilter = button.dataset.noteFilter || NOTE_FILTER_ALL;
        const isActive = targetFilter === noteFilter;
        button.classList.toggle("active", isActive);
        button.setAttribute("aria-selected", String(isActive));
    });
}

function sortNotes(entries) {
    const seen = new Set();
    return entries
        .filter((note) => note && typeof note.id === "string" && !seen.has(note.id) && seen.add(note.id))
        .sort((a, b) => Date.parse(b?.createdAt || 0) - Date.parse(a?.createdAt || 0));
}

function applyNotesCache(nextEntries, { forceRender = false, updateTimestamp = false } = {}) {
    notesCache = sortNotes(nextEntries ?? []);
    notesError = null;
    if (updateTimestamp) lastNotesSyncAt = Date.now();
    updateNoteToggleLabel();
    const shouldRender = (forceRender || isNotesPanelOpen()) && !notesLoading;
    if (shouldRender) renderNotesList();
}

function renderNotesList() {
    if (!notesListEl) return;
    if (notesLoading) {
        notesListEl.innerHTML = `<li class="notes-empty">Loading notes...</li>`;
        return;
    }
    if (notesError) {
        notesListEl.innerHTML = `<li class="notes-empty">Unable to load notes. Please try again later.</li>`;
        return;
    }
    const source = noteFilter === NOTE_FILTER_ALL
        ? notesCache
        : notesCache.filter((note) => note?.type === noteFilter);

    if (!source.length) {
        notesListEl.innerHTML = `<li class="notes-empty">No notes yet</li>`;
        return;
    }

    const items = source.map((note) => {
        const typeLabel = NOTE_TYPE_LABELS[note?.type] ?? "NOTE";
        const zhBlock = note?.zh ? `<div class="notes-item__zh">${esc(note.zh)}</div>` : "";
        const timestamp = formatNoteDate(note?.createdAt);
        const timeMarkup = timestamp
            ? `<time datetime="${esc(note.createdAt || "")}">${esc(timestamp)}</time>`
            : "";
        return `<li class="notes-item" data-note-id="${esc(note.id)}">
    <div class="notes-item__meta">
        <span class="notes-item__type">${esc(typeLabel)}</span>
        ${timeMarkup}
    </div>
    <div class="notes-item__main">
        <div class="notes-item__en">${esc(note.en)}</div>
        ${zhBlock}
    </div>
    <div class="notes-item__actions">
        <button type="button" data-action="copy">Copy</button>
        <button type="button" data-action="delete">delete</button>
    </div>
</li>`;
    });
    notesListEl.innerHTML = items.join("\n");
}

async function syncNotes({ reRender = false, silent = false } = {}) {
    notesLoading = true;
    notesError = null;
    if (reRender || isNotesPanelOpen()) renderNotesList();
    updateNoteToggleLabel();

    try {
        const notes = await listNotes();
        applyNotesCache(notes, { updateTimestamp: true, forceRender: reRender });
    } catch (error) {
        notesError = error;
        if (!silent) showToast(error?.message || "Failed to load notes");
    } finally {
        notesLoading = false;
        updateNoteToggleLabel();
        if (reRender || isNotesPanelOpen()) renderNotesList();
    }
}

function setNoteFilter(value) {
    const nextFilter = value && value !== NOTE_FILTER_ALL ? value : NOTE_FILTER_ALL;
    if (noteFilter === nextFilter) return;
    noteFilter = nextFilter;
    updateFilterButtons();
    renderNotesList();
}

function getSelectedNoteType() {
    if (!noteForm) return NOTE_TYPES.WORD;
    const formData = new FormData(noteForm);
    const value = formData.get("noteType");
    if (typeof value === "string" && Object.values(NOTE_TYPES).includes(value)) {
        return value;
    }
    return NOTE_TYPES.WORD;
}

function populateCurrentToForm({ force = false } = {}) {
    const current = session.getCurrentItem();
    if (!current) return;

    if (noteEnInput) {
        if (force || !noteEnInput.value.trim()) {
            noteEnInput.value = current.en ?? current.word ?? "";
        }
    }

    if (noteZhInput) {
        if (force || !noteZhInput.value.trim()) {
            noteZhInput.value = current.zh ?? "";
        }
    }
}

function shouldRefreshNotes() {
    if (notesLoading) return false;
    if (notesError) return true;
    if (!notesCache.length) return true;
    return Date.now() - lastNotesSyncAt > NOTES_SYNC_TTL_MS;
}

function openNotesPanel() {
    updateFilterButtons();
    populateCurrentToForm({ force: false });
    notesPanel?.classList.add("show");
    notesPanel?.setAttribute("aria-hidden", "false");
    notesOverlay?.classList.add("show");
    notesOverlay?.setAttribute("aria-hidden", "false");
    noteToggleBtn?.setAttribute("aria-expanded", "true");
    noteToggleBtn?.classList.add("is-hidden");
    renderNotesList();
    window.setTimeout(() => noteEnInput?.focus(), 80);
    if (shouldRefreshNotes()) {
        void syncNotes({ reRender: true }).catch((error) => {
            console.error("Failed to load notes", error);
        });
    }
}

function closeNotesPanel({ focusToggle = false } = {}) {
    notesPanel?.classList.remove("show");
    notesPanel?.setAttribute("aria-hidden", "true");
    notesOverlay?.classList.remove("show");
    notesOverlay?.setAttribute("aria-hidden", "true");
    noteToggleBtn?.setAttribute("aria-expanded", "false");
    noteToggleBtn?.classList.remove("is-hidden");
    if (focusToggle) noteToggleBtn?.focus();
}

function shouldIgnoreHotkeys(target) {
    if (!(target instanceof Element)) return false;
    if (target.closest(".notes-panel")) return true;
    if (target.isContentEditable) return true;
    const tagName = target.tagName;
    return tagName === "INPUT"
        || tagName === "TEXTAREA"
        || tagName === "SELECT"
        || tagName === "BUTTON"
        || tagName === "A";
}

function setStatus({ phase, progress, remaining, action }) {
    if (!statusEl) return;
    statusEl.textContent = [
        `# translation :: ${phase}`,
        `# progress ${progress}`,
        `# remaining ${remaining}`,
        `# Space/Enter: ${action}`
    ].join("\n");
}

function buildCode(en, zh, q, total, remaining, { showEnglish, showZh }, currentRoundSize) {
    const start = 10;
    const pad = (n) => String(n).padStart(2, " ");
    const G = (n) => `<span class="gutter">${pad(n)}</span>`;
    const enDisplay = showEnglish ? esc(en) : "";
    const EN = `<span class="str listen-en-line${showEnglish ? "" : " revealable"}" data-role="sentence">"${enDisplay}"</span>`;
    const ZH = showZh && zh ? `<br><span class="cm"># '${esc(zh)}'</span>` : "";

    const lines = [
        `${G(start + 0)}<span class="cm"># rvoca build</span>`,
        `${G(start + 1)}<span class="var">ROUND_SIZE</span><span class="op">=</span><span class="num">${currentRoundSize}</span>`,
        `${G(start + 2)}set -e`,
        `${G(start + 3)} `,
        `${G(start + 4)}res=$(jsonp <span class="str">action=nextBatch</span> <span class="str">count=${currentRoundSize}</span>)`,
        `${G(start + 5)}items=$(echo $res | jq <span class="str">'.items'</span>)`,
        `${G(start + 6)} `,
        `${G(start + 7)}export WORD=${EN}${ZH}`,
        `${G(start + 8)}echo <span class="str">"remaining ${remaining}"</span>`,
        `${G(start + 9)} `,
        `${G(start + 10)}ix=0`,
        `${G(start + 11)}speak $(jq -r <span class="str">'.[0].word'</span> <<< "$items")`,
        `${G(start + 12)} `,
        `${G(start + 13)}<span class="cm"># progress ${q}/${total}</span><span class="cursor"></span>`,
        `${G(start + 14)}exit 0`
    ];

    return lines.join("\n");
}



function render(state) {
    if (!codeEl) return;

    const { batch, index, revealed, remaining, revealPhase = 0 } = state;
    const remainingDisplay = typeof remaining === "number" && !Number.isNaN(remaining) ? remaining : "--";

    document.body.dataset.roundSize = String(roundSize);

    if (index < 0 || index >= batch.length) {
        codeEl.innerHTML = buildCode("RVOCA.reload()", "", 0, roundSize, remainingDisplay, { showEnglish: false, showZh: false }, roundSize);
        setStatus({ phase: "awaiting batch", progress: "0/0", remaining: remainingDisplay, action: "reload" });
        return;
    }

    const current = batch[index];
    const en = current.en ?? current.word ?? "";
    const zh = current.zh ?? "";
    const q = index + 1;
    const total = batch.length || roundSize;

    const showEnglish = revealPhase >= 1;
    const showZh = revealPhase >= 2 && revealed;
    codeEl.innerHTML = buildCode(en, zh, q, total, remainingDisplay, { showEnglish, showZh }, roundSize);
    const phaseLabel = showZh ? "revealed" : showEnglish ? "english" : "hidden";
    const actionHint = showZh ? "next" : showEnglish ? "show zh" : "show en";
    setStatus({
        phase: phaseLabel,
        progress: `${q}/${total}`,
        remaining: remainingDisplay,
        action: actionHint
    });
}

const session = createRoundSession({
    fetchBatch: (options = {}) => {
        const { series = null, count } = options;
        const targetCount = typeof count === "number" ? count : roundSize;
        return fetchListeningBatch({ count: targetCount, series });
    },
    render,
    speakItem: (item) => speak(item.en ?? item.word ?? ""),
    enablePrefetch: true
});

updateFilterButtons();
updateNoteToggleLabel();
void syncNotes({ silent: true }).catch((error) => {
    console.error("Failed to preload notes", error);
});

noteToggleBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (isNotesPanelOpen()) {
        closeNotesPanel();
    } else {
        openNotesPanel();
    }
});

noteCloseBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeNotesPanel();
});

notesOverlay?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeNotesPanel({ focusToggle: true });
});

notesPanel?.addEventListener("click", (event) => {
    event.stopPropagation();
});

noteUseCurrentBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    populateCurrentToForm({ force: true });
    noteEnInput?.focus();
    noteEnInput?.select();
});

noteForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const type = getSelectedNoteType();
    const enValue = (noteEnInput?.value ?? "").trim();
    const zhValue = (noteZhInput?.value ?? "").trim();
    if (!enValue) {
        showToast("Please enter the English text first");
        noteEnInput?.focus();
        return;
    }
    const submitButton = noteForm.querySelector('button[type="submit"]');
    submitButton?.setAttribute("disabled", "true");
    try {
        const created = await createNote({ type, en: enValue, zh: zhValue });
        const nextCache = [created, ...notesCache.filter((note) => note.id !== created.id)];
        applyNotesCache(nextCache, { forceRender: true, updateTimestamp: true });
        if (noteEnInput) noteEnInput.value = "";
        if (noteZhInput) noteZhInput.value = "";
        populateCurrentToForm({ force: false });
        noteEnInput?.focus();
        showToast("Note added");
    } catch (error) {
        console.error("Failed to add note", error);
        showToast(error?.message || "Failed to add note");
    } finally {
        submitButton?.removeAttribute("disabled");
    }
});

noteFilterButtons.forEach((button) => {
    button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const value = button.dataset.noteFilter || NOTE_FILTER_ALL;
        setNoteFilter(value);
    });
});

notesListEl?.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const action = target.dataset.action;
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    const itemEl = target.closest(".notes-item");
    const noteId = itemEl?.getAttribute("data-note-id");

    if (action === "delete") {
        if (!noteId) return;
        target.setAttribute("disabled", "true");
        const previousCache = [...notesCache];
        const nextCache = notesCache.filter((entry) => entry.id !== noteId);
        applyNotesCache(nextCache, { forceRender: true });
        try {
            await removeNote(noteId);
            lastNotesSyncAt = Date.now();
            showToast("Note deleted");
        } catch (error) {
            console.error("Failed to delete note", error);
            applyNotesCache(previousCache, { forceRender: true });
            showToast(error?.message || "Failed to delete note");
        } finally {
            target.removeAttribute("disabled");
        }
        return;
    }

    if (action === "copy") {
        if (!noteId) return;
        const note = notesCache.find((entry) => entry.id === noteId);
        if (!note) return;
        const payload = note.zh ? `${note.en} ${note.zh}` : note.en;
        try {
            const success = await copyText(payload);
            showToast(success ? "Copied" : "Copy failed");
        } catch (error) {
            console.error("Failed to copy note", error);
            showToast("Copy failed");
        }
    }
});
roundSizeButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    event.preventDefault();
    if (!adminMode && !ensureAdmin()) return;

    const { MIN, MAX } = ROUND_SIZE_LIMITS;
    const input = prompt(
        `Set round size (${MIN}-${MAX}).\nCurrent: ${roundSize}.\nLeave blank to reset (${DEFAULT_ROUND_SIZE}).`,
        String(roundSize)
    );

    if (input === null) return;

    const trimmed = input.trim();
    let nextValue;

    if (trimmed === "") {
        nextValue = resetRoundSize(MODE_KEY);
    } else {
        const parsed = Number.parseInt(trimmed, 10);
        if (!Number.isFinite(parsed)) {
            showToast("Please enter a number");
            return;
        }
        nextValue = setRoundSize(MODE_KEY, parsed);
        if (nextValue == null) {
            showToast(`Use ${MIN}-${MAX}`);
            return;
        }
    }

    applyRoundSize(nextValue ?? DEFAULT_ROUND_SIZE);
    showToast(`Round size set to ${roundSize}`);
    session.startRound({ count: roundSize });
});

function getAdminKey() {
    return localStorage.getItem(ADMIN_KEY_NAME) || "";
}

function disableAdmin() {
    adminMode = false;
    fabEl?.classList.remove("show");
    adminBadge?.classList.remove("show");
}

function ensureAdmin() {
    let key = getAdminKey();
    if (!key) {
        key = prompt("Enter admin PIN");
        if (!key) return false;
        localStorage.setItem(ADMIN_KEY_NAME, key);
    }
    adminMode = true;
    fabEl?.classList.add("show");
    adminBadge?.classList.add("show");
    return true;
}

function resetAdmin(silent = false) {
    localStorage.removeItem(ADMIN_KEY_NAME);
    disableAdmin();
    if (!silent) alert("Admin PIN cleared. Please re-enter");
}

async function markCurrentKnown() {
    const current = session.getCurrentItem();
    if (!current) return;
    if (!adminMode && !ensureAdmin()) return;

    const adminKey = getAdminKey();
    let response;
    try {
        response = await markListeningKnown(current.id, adminKey);
    } catch (error) {
        console.error("Failed to mark sentence as known", error);
        showToast("Failed to update");
        return;
    }

    if (!response?.ok && /permission/i.test(response?.error || "")) {
        resetAdmin(true);
        alert("Admin PIN verification failed. Please try again.");
        if (ensureAdmin()) await markCurrentKnown();
        return;
    }

    if (response?.ok) {
        const remaining = typeof response.remaining === "number"
            ? response.remaining
            : Math.max(0, session.state.remaining - 1);
        session.setRemaining(remaining);
        await session.advance().catch((error) => console.error("Failed to advance after markKnown", error));
    }
}

async function handleCopy(getText) {
    const current = session.getCurrentItem();
    if (!current) return;
    const text = getText(current);
    if (!text) return;

    try {
        const success = await copyText(text);
        showToast(success ? "Copied" : "Copy failed");
    } catch (error) {
        console.error("Failed to copy text", error);
        showToast("Copy failed");
    }
}

function replayCurrent() {
    const current = session.getCurrentItem();
    if (!current) return;
    speak(current.en ?? current.word ?? "");
}

codeEl?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const sentenceTarget = target.closest(englishSelector);
    if (!sentenceTarget) return;
    event.stopPropagation();
    replayCurrent();
    if (!session.state.revealed) {
        session.reveal();
    }
});

knownBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    markCurrentKnown();
});

copyEnBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    handleCopy((item) => item.en ?? item.word ?? "");
});

copyZhBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    handleCopy((item) => item.zh || "");
});

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isNotesPanelOpen()) {
        event.preventDefault();
        closeNotesPanel({ focusToggle: true });
        return;
    }

    const target = event.target instanceof Element ? event.target : null;
    if (shouldIgnoreHotkeys(target)) return;

    if (isNotesPanelOpen()) return;

    if (event.code === "Space" || event.code === "Enter") {
        event.preventDefault();
        session.advance().catch((error) => console.error("Failed to advance session", error));
    } else if (event.key === "k" || event.key === "K") {
        event.preventDefault();
        markCurrentKnown();
    } else if (event.key === "r" || event.key === "R") {
        event.preventDefault();
        resetAdmin();
    }
});

document.body.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target && noteToggleBtn?.contains(target)) return;

    if (isNotesPanelOpen()) {
        if (target && (notesPanel?.contains(target) || notesOverlay?.contains(target))) {
            return;
        }
        closeNotesPanel();
        return;
    }

    session.advance().catch((error) => console.error("Failed to advance session", error));
});

document.addEventListener("touchstart", () => {
    pressTimer = window.setTimeout(() => ensureAdmin(), LONGPRESS_MS);
}, { passive: true });

document.addEventListener("touchend", () => {
    if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
    }
}, { passive: true });

document.addEventListener("mousedown", () => {
    pressTimer = window.setTimeout(() => ensureAdmin(), LONGPRESS_MS);
});

document.addEventListener("mouseup", () => {
    if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
    }
});

session.startRound({ count: roundSize }).catch((error) => {
    console.error("Failed to load listening batch", error);
    setStatus({ phase: "load failed", progress: "0/0", remaining: "--", action: "retry" });
    showToast("Failed to load data");
});






