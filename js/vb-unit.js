import { LONGPRESS_MS, ADMIN_KEY_NAME } from "./config.js";
import { fetchUnitVocabBatch, markUnitVocabKnown, fetchUnitPronMarks, updateUnitPronMark, incrementUnitPracticeCounts } from "./services/api.js";
import { speak } from "./utils/speech.js";
import { copyText } from "./utils/clipboard.js";
import { escapeHtml as esc } from "./utils/html.js";
import { showToast } from "./ui/toast.js";
import { createRoundSession } from "./core/session.js";
import { getRoundSize, setRoundSize, resetRoundSize, ROUND_SIZE_LIMITS, DEFAULT_ROUND_SIZE } from "./core/round-size.js";
import { runBootSequence } from "./boot-screen.js";

const codeEl = document.getElementById("code");
const statusEl = document.getElementById("status");
const fabEl = document.getElementById("fab");
const knownBtn = document.getElementById("btnKnown");
const adminBadge = document.getElementById("adminBadge");
const copyEnBtn = document.getElementById("copyEn");
const copyZhBtn = document.getElementById("copyZh");
const roundSizeButton = document.getElementById("btnRoundSize");
const unitSelect = document.getElementById("unitSelect");
const unitSelectWrapper = document.querySelector(".unit-select");
const readingMarkBtn = document.getElementById("btnPronMark");
const readingListBtn = document.getElementById("btnPronList");
const readingOverlay = document.getElementById("pronOverlay");
const readingPanel = document.getElementById("pronPanel");
const readingCloseBtn = document.getElementById("btnPronClose");
const readingListEl = document.getElementById("pronList");
const practiceResetBtn = document.getElementById("btnPracticeReset");
const otherToggleBtn = document.getElementById("btnOtherToggle");
const otherMenu = document.getElementById("otherMenu");
let selectedUnit = unitSelect?.value || "1";
if (unitSelect && unitSelect.value !== selectedUnit) {
    unitSelect.value = selectedUnit;
}

document.body.dataset.unit = selectedUnit;

if (statusEl) {
    statusEl.textContent = [
        `Unit ${selectedUnit} :: loading`,
        `remaining --`,
        `revisit --`,
        `Space/Enter: en->zh->next | K = mark known`
    ].join("\n");
}

const MODE_KEY = "vb-unit";
const READING_MARKS_STORAGE_KEY = "vb-unit.readingMarks";
const READING_MARK_IDLE_LABEL = "Pron Mark";
const READING_MARK_ACTIVE_LABEL = "Pron Marked";
const READING_LIST_LABEL = "Pron List";
const PRACTICE_COUNTS_STORAGE_KEY = "vb-unit.practiceCounts";
const PRACTICE_SYNC_THRESHOLD = 5;
let roundSize = getRoundSize(MODE_KEY);
let readingMarks = loadReadingMarks();
let currentReadingKey = null;
let readingMarksLoading = false;
let readingMarksError = null;
let readingMarksInitialized = Object.keys(readingMarks).length > 0;
let syncCurrentItemForReading = null;
let practiceCounts = loadPracticeCounts();
let practiceSyncScheduled = false;
let practiceSyncInFlight = false;
let otherMenuOpen = false;

function openOtherMenu() {
    if (!otherMenu) return;
    otherMenu.classList.add("show");
    otherMenu.setAttribute("aria-hidden", "false");
    otherToggleBtn?.setAttribute("aria-expanded", "true");
    otherToggleBtn?.classList.add("open");
    otherMenuOpen = true;
}

function closeOtherMenu() {
    if (!otherMenu) return;
    otherMenu.classList.remove("show");
    otherMenu.setAttribute("aria-hidden", "true");
    otherToggleBtn?.setAttribute("aria-expanded", "false");
    otherToggleBtn?.classList.remove("open");
    otherMenuOpen = false;
}

function toggleOtherMenu() {
    if (otherMenuOpen) {
        closeOtherMenu();
    } else {
        openOtherMenu();
    }
}

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
updateReadingListButton();
syncReadingControlsForItem(null);
refreshReadingMarksFromServer({ silent: true });
schedulePracticeSync();
const TEMPLATES = [
    ({ word, zh, showZh, q, total, remain, seed, roundSize, practiceCount }) => {
        const seenLine = practiceCount > 0 ? `<span class="cm">// seen ${practiceCount}x</span>` : "";
        return [
            `<span class="cm">// rvoca@${seed} :: runtime bootstrap</span>`,
            `<span class="kw">import</span> <span class="var">{ jsonp, speak }</span> <span class="kw">from</span> <span class="str">'rvoca/runtime'</span>`,
            `<span class="kw">const</span> <span class="var">ROUND_SIZE</span> <span class="op">=</span> <span class="num">${roundSize}</span>`,
            `<span class="kw">let</span> <span class="var">batch</span><span class="op">:</span><span class="var">any[]</span> <span class="op">=</span> []<span class="op">,</span> <span class="var">ix</span> <span class="op">=</span> <span class="num">0</span>`,
            ``,
            `<span class="kw">async function</span> <span class="var">main</span>() {`,
            `  <span class="kw">const</span> <span class="var">res</span> <span class="op">=</span> <span class="kw">await</span> <span class="var">jsonp</span>({ <span class="prop">action</span><span class="op">:</span> <span class="str">"nextBatch"</span>, <span class="prop">count</span><span class="op">:</span> <span class="var">ROUND_SIZE</span> })`,
            `  <span class="var">batch</span> <span class="op">=</span> <span class="var">res</span>.<span class="prop">items</span> <span class="op">||</span> []`,
            `  <span class="kw">const</span> <span class="var">progress</span> <span class="op">=</span> <span class="str">"${q}/${total}"</span> <span class="cm">// progress</span>`,
            `  <span class="var">document</span>.<span class="prop">body</span>.<span class="prop">dataset</span>.<span class="prop">w</span> <span class="op">=</span> <span class="str">"${esc(word)}"</span>${showZh ? ` <span class="cm">// '${esc(zh)}'</span>` : ""}`,
            `  <span class="var">console</span>.<span class="prop">debug</span>(<span class="str">"remaining"</span><span class="op">,</span> <span class="num">${remain}</span>)`,
            `  <span class="kw">try</span> {`,
            `    <span class="var">speak</span>(<span class="var">batch</span>[<span class="var">ix</span>].<span class="prop">word</span>)`,
            `  } <span class="kw">catch</span> (<span class="var">err</span>) {`,
            `    <span class="var">console</span>.<span class="prop">warn</span>(<span class="str">"tts failed"</span>, <span class="var">err</span>)`,
            `  }`,
            `}`,
            ``,
            `<span class="var">main</span>()`,
            `<span class="cm">// remain:</span> <span class="num">${remain}</span> <span class="cm">// progress:</span> <span class="num">${q}</span>/<span class="num">${total}</span>`,
            seenLine,
            `<span class="cm">// press Space to reveal, then next</span><span class="cursor"></span>`
        ].filter(Boolean);
    },
    ({ word, zh, showZh, q, total, remain, seed, roundSize, practiceCount }) => {
        const seenLine = practiceCount > 0 ? `<span class="cm"># seen ${practiceCount}x</span>` : "";
        return [
            `<span class="cm"># rvoca/${seed} :: inference session</span>`,
            `<span class="kw">from</span> rvoca <span class="kw">import</span> jsonp, tts`,
            `<span class="var">ROUND_SIZE</span> <span class="op">=</span> <span class="num">${roundSize}</span>`,
            ``,
            `<span class="kw">def</span> <span class="var">load</span>():`,
            `    <span class="var">res</span> <span class="op">=</span> <span class="var">jsonp</span>({<span class="str">'action'</span><span class="op">:</span><span class="str">'nextBatch'</span>, <span class="str">'count'</span><span class="op">:</span><span class="var">ROUND_SIZE</span>})`,
            `    <span class="kw">return</span> <span class="var">res</span>.<span class="prop">items</span> <span class="kw">or</span> []`,
            ``,
            `<span class="var">batch</span> <span class="op">=</span> <span class="var">load</span>()`,
            `<span class="var">ix</span> <span class="op">=</span> <span class="num">0</span>`,
            `<span class="cm"># embed word</span>`,
            `<span class="var">token</span> <span class="op">=</span> <span class="str">"${esc(word)}"</span>${showZh ? ` <span class="cm"># '${esc(zh)}'</span>` : ""}`,
            ``,
            `<span class="kw">try</span>:`,
            `    <span class="var">tts</span>(<span class="var">batch</span>[<span class="var">ix</span>].<span class="prop">word</span>)`,
            `<span class="kw">except</span> <span class="var">Exception</span> <span class="kw">as</span> <span class="var">err</span>:`,
            `    <span class="kw">pass</span>`,
            ``,
            `<span class="cm"># remaining</span> <span class="num">${remain}</span>`,
            `<span class="cm"># progress ${q}/${total}</span>`,
            seenLine,
            `<span class="cursor"></span>`,
            ``,
            `<span class="cm"># EOF</span>`
        ].filter(Boolean);
    },
    ({ word, zh, showZh, q, total, remain, seed, roundSize, practiceCount }) => {
        const seenLine = practiceCount > 0 ? `<span class="cm"># seen ${practiceCount}x</span>` : "";
        return [
            `<span class="cm"># rvoca build ${seed}</span>`,
            `<span class="var">ROUND_SIZE</span><span class="op">=</span><span class="num">${roundSize}</span>`,
            `set -e`,
            ``,
            `res=$(jsonp <span class="str">action=nextBatch</span> <span class="str">count=${roundSize}</span>)`,
            `items=$(echo $res | jq <span class="str">'.items'</span>)`,
            ``,
            `export WORD=<span class="str">"${esc(word)}"</span>${showZh ? ` <span class="cm"># '${esc(zh)}'</span>` : ""}`,
            `echo <span class="str">"remaining ${remain}"</span>`,
            ``,
            `ix=0`,
            `speak $(jq -r <span class="str">'.[0].word'</span> <<< "$items")`,
            ``,
            `<span class="cm"># progress ${q}/${total}</span>`,
            seenLine,
            `<span class="cursor"></span>`,
            `exit 0`
        ].filter(Boolean);
    }
];

let templateIdx = 0;
let roundId = 0;
let adminMode = false;

function buildCode(word, zh, showZh, q, total, remain, currentRoundSize, practiceCount) {
    const seed = (++roundId).toString(36).slice(-4);
    const lines = TEMPLATES[templateIdx]({ word, zh, showZh, q, total, remain, seed, roundSize: currentRoundSize, practiceCount });
    const start = Math.floor(Math.random() * 20) + 1;
    const lineNo = (n) => String(n).padStart(2, " ");
    return lines.map((line, index) => `<span class="gutter">${lineNo(start + index)}</span>${line}`).join("\n");
}

function setStatus({ phase, progress, remaining, action, practiceCount }) {
    if (!statusEl) return;
    const practiceDisplay = typeof practiceCount === "number" && Number.isFinite(practiceCount)
        ? practiceCount
        : "--";
    statusEl.textContent = [
        `Unit ${selectedUnit} :: ${phase}`,
        `progress ${progress}`,
        `remaining ${remaining}`,
        `revisit ${practiceDisplay}`,
        `Space/Enter: ${action} | K = mark known`
    ].join("\n");
}

function render(state) {
    if (!codeEl) return;

    const { batch, index, revealed, remaining, revealPhase = 0 } = state;
    const remainingDisplay = typeof remaining === "number" && !Number.isNaN(remaining) ? remaining : "--";

    document.body.dataset.unit = selectedUnit;
    document.body.dataset.roundSize = String(roundSize);

    if (index < 0 || index >= batch.length) {
        codeEl.innerHTML = buildCode("RVOCA.reload()", "not loaded", false, 0, roundSize, remainingDisplay, roundSize, 0);
        document.body.dataset.w = "";
        delete document.body.dataset.zh;
        setStatus({
            phase: "loading",
            progress: "0/0",
            remaining: remainingDisplay,
            revealed: false,
            action: "reload",
            practiceCount: "--"
        });
        syncReadingControlsForItem(null);
        return;
    }

    const current = batch[index] || {};
    const word = current.word || "";
    const zh = current.zh || "";
    const q = index + 1;
    const total = batch.length || roundSize;
    const showEnglish = revealPhase >= 1;
    const showZh = revealPhase >= 2 && revealed;
    let practiceCount = getPracticeCount(current);
    if (showZh && !current.__practiceLogged) {
        current.__practiceLogged = true;
        incrementPracticeCount(current);
        practiceCount = getPracticeCount(current);
    }

    codeEl.innerHTML = buildCode(showEnglish ? word : "", zh, showZh, q, total, remainingDisplay, roundSize, practiceCount);

    document.body.dataset.w = showEnglish ? word : "";
    if (showZh && zh) {
        document.body.dataset.zh = zh;
    } else {
        delete document.body.dataset.zh;
    }

    setStatus({
        phase: showZh ? "translation" : showEnglish ? "english" : "hidden",
        progress: q + "/" + total,
        remaining: remainingDisplay,
        revealed: showZh,
        action: showZh ? "next" : showEnglish ? "show zh" : "show en",
        practiceCount
    });
    syncReadingControlsForItem(current);
}

function makeReadingKey(item) {
    if (!item) return null;
    if (typeof item.id === "number" || (typeof item.id === "string" && item.id !== "")) {
        return `id:${item.id}`;
    }
    const word = typeof item.word === "string" ? item.word.trim() : "";
    if (!word) return null;
    return `word:${word.toLowerCase()}`;
}

function syncReadingControlsForItem(item) {
    currentReadingKey = makeReadingKey(item);
    const isMarked = currentReadingKey ? Boolean(readingMarks[currentReadingKey]) : false;
    updateReadingMarkButton(isMarked);
    if (document?.body) {
        document.body.dataset.readingMarked = isMarked ? "1" : "0";
    }
}

function updateReadingMarkButton(isMarked) {
    if (!readingMarkBtn) return;
    const pressed = Boolean(isMarked);
    readingMarkBtn.classList.toggle("is-active", pressed);
    readingMarkBtn.setAttribute("aria-pressed", pressed ? "true" : "false");
    readingMarkBtn.textContent = pressed ? READING_MARK_ACTIVE_LABEL : READING_MARK_IDLE_LABEL;
}

function getReadingCount() {
    return Object.keys(readingMarks || {}).length;
}

function updateReadingListButton() {
    if (!readingListBtn) return;
    const count = getReadingCount();
    readingListBtn.textContent = count ? `${READING_LIST_LABEL} (${count})` : READING_LIST_LABEL;
}

function getReadingEntries() {
    return Object.values(readingMarks || {}).sort((a, b) => {
        const aTime = typeof a?.timestamp === "number" ? a.timestamp : 0;
        const bTime = typeof b?.timestamp === "number" ? b.timestamp : 0;
        return bTime - aTime;
    });
}

function parseReadingTimestamp(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
        const parsed = Date.parse(value);
        if (!Number.isNaN(parsed)) return parsed;
    }
    return Date.now();
}

function normalizeReadingEntry(raw = {}, { fallbackUnit = "" } = {}) {
    if (!raw || typeof raw !== "object") return null;
    const id = raw.id ?? raw.vocabId ?? raw.wordId ?? null;
    const word = typeof raw.word === "string"
        ? raw.word
        : typeof raw.en === "string"
            ? raw.en
            : "";
    const zh = typeof raw.zh === "string"
        ? raw.zh
        : typeof raw.translation === "string"
            ? raw.translation
            : "";
    const unitValue = raw.unit ?? raw.level ?? fallbackUnit ?? "";
    const unit = typeof unitValue === "string" ? unitValue : unitValue != null ? String(unitValue) : "";
    const entryKey = raw.key || makeReadingKey({ id, word });
    if (!entryKey) return null;
    return {
        key: entryKey,
        id,
        word,
        zh,
        unit,
        timestamp: parseReadingTimestamp(raw.timestamp ?? raw.updatedAt ?? raw.markedAt ?? raw.createdAt)
    };
}

function cloneReadingMarks() {
    return Object.values(readingMarks || {}).reduce((acc, entry) => {
        if (!entry?.key) return acc;
        acc[entry.key] = { ...entry };
        return acc;
    }, {});
}

function getReadingResponseItems(source) {
    if (!source || typeof source !== "object") return [];
    const candidates = [source.items, source.marks, source.entries, source.list];
    for (const candidate of candidates) {
        if (Array.isArray(candidate)) return candidate;
    }
    return [];
}

function loadReadingMarks() {
    if (typeof localStorage === "undefined") return {};
    try {
        const raw = localStorage.getItem(READING_MARKS_STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return {};
        const entries = Object.values(parsed)
            .map((value) => normalizeReadingEntry(value, { fallbackUnit: selectedUnit }))
            .filter(Boolean);
        return entries.reduce((acc, entry) => {
            acc[entry.key] = entry;
            return acc;
        }, {});
    } catch (error) {
        console.error("Failed to load reading marks", error);
        return {};
    }
}

function persistReadingMarks() {
    if (typeof localStorage === "undefined") return;
    try {
        localStorage.setItem(READING_MARKS_STORAGE_KEY, JSON.stringify(readingMarks));
    } catch (error) {
        console.error("Failed to persist reading marks", error);
    }
}

function formatReadingTimestamp(timestamp) {
    if (typeof timestamp !== "number") return "";
    try {
        return new Date(timestamp).toLocaleString();
    } catch {
        return "";
    }
}

function renderReadingList() {
    if (!readingListEl) return;
    if (readingMarksLoading && !readingMarksInitialized) {
        readingListEl.innerHTML = `<li class="notes-empty">Syncing reading marks...</li>`;
        return;
    }
    const entries = getReadingEntries();
    if (readingMarksError && !entries.length) {
        readingListEl.innerHTML = `<li class="notes-empty">Unable to load reading marks</li>`;
        return;
    }
    if (!entries.length) {
        readingListEl.innerHTML = `<li class="notes-empty">No reading marks yet</li>`;
        return;
    }
    const items = entries.map((entry) => {
        const zhBlock = entry.zh ? `<div class="notes-item__zh">${esc(entry.zh)}</div>` : "";
        const unitLabel = entry.unit ? `Unit ${esc(entry.unit)}` : "Reading";
        const timeLabel = formatReadingTimestamp(entry.timestamp);
        const timeBlock = timeLabel ? `<span>${esc(timeLabel)}</span>` : "";
        const practiceCount = getPracticeCountByKey(entry.key || makePracticeKey(entry));
        const practiceBadge = practiceCount > 0 ? `<span class="notes-item__badge">x${practiceCount}</span>` : "";
        return `<li class="notes-item" data-reading-key="${esc(entry.key || "")}">
    <div class="notes-item__meta">
        <span class="notes-item__type">${unitLabel}</span>
        ${timeBlock}
        ${practiceBadge}
    </div>
    <div class="notes-item__main">
        <div class="notes-item__en">${esc(entry.word || "")}</div>
        ${zhBlock}
    </div>
    <div class="notes-item__actions">
        <button type="button" data-action="speak">Speak</button>
        <button type="button" data-action="copy-en">Copy EN</button>
        <button type="button" data-action="copy-zh">Copy ZH</button>
        <button type="button" data-action="remove">Remove</button>
    </div>
</li>`;
    });
    readingListEl.innerHTML = items.join("\n");
}

function renderReadingListIfOpen() {
    if (isReadingPanelOpen()) {
        renderReadingList();
    }
}

function loadPracticeCounts() {
    if (typeof localStorage === "undefined") return {};
    try {
        const raw = localStorage.getItem(PRACTICE_COUNTS_STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return {};
        return Object.entries(parsed).reduce((acc, [key, value]) => {
            if (!value || typeof value !== "object") return acc;
            const entryKey = key || value.key;
            if (!entryKey) return acc;
            acc[entryKey] = {
                key: entryKey,
                id: value.id ?? null,
                word: typeof value.word === "string" ? value.word : "",
                unit: typeof value.unit === "string" ? value.unit : "",
                local: Number(value.local) || 0,
                synced: Number(value.synced) || 0
            };
            return acc;
        }, {});
    } catch (error) {
        console.error("Failed to load practice counts", error);
        return {};
    }
}

function persistPracticeCounts() {
    if (typeof localStorage === "undefined") return;
    try {
        localStorage.setItem(PRACTICE_COUNTS_STORAGE_KEY, JSON.stringify(practiceCounts));
    } catch (error) {
        console.error("Failed to persist practice counts", error);
    }
}

function makePracticeKey(item) {
    if (!item) return null;
    if (item.id != null && item.id !== "") return `id:${item.id}`;
    const word = typeof item.word === "string" ? item.word.trim() : "";
    if (!word) return null;
    return `word:${word.toLowerCase()}`;
}

function getPracticeEntry(item) {
    const key = makePracticeKey(item);
    if (!key) return null;
    return practiceCounts[key] || null;
}

function getPracticeCount(item) {
    const entry = getPracticeEntry(item);
    return entry?.local ?? 0;
}

function getPracticeCountByKey(key) {
    return practiceCounts[key]?.local ?? 0;
}

function ensurePracticeEntry(item) {
    const key = makePracticeKey(item);
    if (!key) return null;
    if (!practiceCounts[key]) {
        practiceCounts[key] = {
            key,
            id: item.id ?? null,
            word: item.word || "",
            unit: item.unit || selectedUnit,
            local: 0,
            synced: 0
        };
    }
    return practiceCounts[key];
}

function incrementPracticeCount(item) {
    const entry = ensurePracticeEntry(item);
    if (!entry) return;
    entry.local += 1;
    entry.word = item.word || entry.word;
    entry.unit = item.unit || entry.unit || selectedUnit;
    persistPracticeCounts();
    schedulePracticeSync();
}

function schedulePracticeSync() {
    if (practiceSyncInFlight || practiceSyncScheduled) return;
    practiceSyncScheduled = true;
    const timer = typeof window !== "undefined" && typeof window.setTimeout === "function" ? window.setTimeout : setTimeout;
    timer(() => {
        practiceSyncScheduled = false;
        maybeSyncPracticeCounts();
    }, 300);
}

async function maybeSyncPracticeCounts() {
    if (practiceSyncInFlight) return;
    const adminKey = getAdminKey();
    if (!adminKey) return;
    const candidates = Object.values(practiceCounts).filter((entry) => {
        const delta = entry.local - entry.synced;
        return delta >= PRACTICE_SYNC_THRESHOLD;
    });
    if (!candidates.length) return;
    practiceSyncInFlight = true;
    const payload = candidates.map((entry) => ({
        id: entry.id ?? "",
        word: entry.word || "",
        unit: entry.unit || "",
        delta: entry.local - entry.synced
    }));
    try {
        await incrementUnitPracticeCounts(payload, adminKey);
        candidates.forEach((entry) => {
            entry.synced = entry.local;
        });
        persistPracticeCounts();
    } catch (error) {
        console.error("Failed to sync practice counts", error);
    } finally {
        practiceSyncInFlight = false;
        if (Object.values(practiceCounts).some((entry) => entry.local - entry.synced >= PRACTICE_SYNC_THRESHOLD)) {
            schedulePracticeSync();
        }
    }
}

function clearLocalPracticeCounts() {
    if (!Object.keys(practiceCounts).length) {
        showToast("No practice data");
        return;
    }
    if (!adminMode && !ensureAdmin()) return;
    const confirmed = confirm("Clear all local practice counts?");
    if (!confirmed) return;
    practiceCounts = {};
    persistPracticeCounts();
    showToast("Practice counts cleared");
    renderReadingListIfOpen();
    if (session?.state) {
        render(session.state);
    }
}

function replaceReadingMarks(next = {}) {
    readingMarks = next;
    persistReadingMarks();
    updateReadingListButton();
    renderReadingListIfOpen();
}

function refreshReadingUiForCurrentItem() {
    syncCurrentItemForReading?.();
}

function applyReadingEntries(entries = []) {
    const normalized = entries
        .map((entry) => normalizeReadingEntry(entry, { fallbackUnit: selectedUnit }))
        .filter(Boolean);
    const nextMap = normalized.reduce((acc, entry) => {
        acc[entry.key] = entry;
        return acc;
    }, {});
    replaceReadingMarks(nextMap);
    refreshReadingUiForCurrentItem();
}

async function refreshReadingMarksFromServer({ silent = false } = {}) {
    if (readingMarksLoading) return;
    readingMarksLoading = true;
    renderReadingListIfOpen();
    try {
        const response = await fetchUnitPronMarks();
        if (response?.ok === false) {
            throw new Error(response?.error || "Failed to sync reading marks");
        }
        const items = getReadingResponseItems(response);
        applyReadingEntries(items);
        readingMarksError = null;
        readingMarksInitialized = true;
    } catch (error) {
        readingMarksError = error;
        console.error("Failed to sync reading marks", error);
        if (!silent) {
            showToast("Failed to sync reading marks");
        }
    } finally {
        readingMarksLoading = false;
        renderReadingListIfOpen();
    }
}

function isReadingPanelOpen() {
    return readingPanel?.classList.contains("show") ?? false;
}

function openReadingPanel() {
    renderReadingList();
    readingPanel?.classList.add("show");
    readingPanel?.setAttribute("aria-hidden", "false");
    readingOverlay?.classList.add("show");
    readingOverlay?.setAttribute("aria-hidden", "false");
    readingListBtn?.setAttribute("aria-expanded", "true");
}

function closeReadingPanel({ focusToggle = false } = {}) {
    readingPanel?.classList.remove("show");
    readingPanel?.setAttribute("aria-hidden", "true");
    readingOverlay?.classList.remove("show");
    readingOverlay?.setAttribute("aria-hidden", "true");
    readingListBtn?.setAttribute("aria-expanded", "false");
    if (focusToggle) {
        readingListBtn?.focus();
    }
}

function toggleReadingPanel() {
    if (isReadingPanelOpen()) {
        closeReadingPanel({ focusToggle: false });
    } else {
        openReadingPanel();
    }
}

async function toggleReadingMark() {
    const current = session.getCurrentItem();
    if (!current) return;
    if (!adminMode && !ensureAdmin()) return;
    const key = makeReadingKey(current);
    if (!key) {
        showToast("Unable to mark this word");
        return;
    }
    const adminKey = getAdminKey();
    const existing = readingMarks[key];
    const willMark = !existing;
    const previousState = cloneReadingMarks();

    if (willMark) {
        readingMarks[key] = {
            key,
            id: current.id ?? null,
            word: current.word || "",
            zh: current.zh || "",
            unit: selectedUnit,
            timestamp: Date.now()
        };
    } else {
        delete readingMarks[key];
    }
    persistReadingMarks();
    updateReadingListButton();
    renderReadingListIfOpen();
    syncReadingControlsForItem(current);

    try {
        await updateUnitPronMark({
            id: current.id ?? existing?.id ?? null,
            adminKey,
            unit: selectedUnit,
            marked: willMark,
            word: current.word || "",
            zh: current.zh || ""
        });
        showToast(willMark ? "Reading mark synced" : "Reading mark removed");
        refreshReadingMarksFromServer({ silent: true });
    } catch (error) {
        console.error("Failed to sync reading mark", error);
        readingMarks = previousState;
        persistReadingMarks();
        updateReadingListButton();
        renderReadingListIfOpen();
        syncReadingControlsForItem(current);
        showToast("Failed to sync reading mark");
    }
}

// Copy-all and clear-all functionality removed per request.

const session = createRoundSession({
    fetchBatch: (options = {}) => {
        const { unit = selectedUnit, count } = options || {};
        const targetCount = typeof count === "number" ? count : roundSize;
        return fetchUnitVocabBatch({ count: targetCount, unit });
    },
    render,
    speakItem: (item) => speak(item.word || ""),
    enablePrefetch: true,
    onRoundWillStart: () => {
        templateIdx = (templateIdx + 1) % TEMPLATES.length;
        document.body.dataset.unit = selectedUnit;
        document.body.dataset.roundSize = String(roundSize);
    }
});

syncCurrentItemForReading = () => {
    syncReadingControlsForItem(session.getCurrentItem());
};

readingMarkBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleReadingMark();
});

readingListBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleReadingPanel();
});

readingCloseBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeReadingPanel({ focusToggle: true });
});

readingOverlay?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeReadingPanel({ focusToggle: true });
});

readingOverlay?.addEventListener("touchstart", (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeReadingPanel({ focusToggle: true });
}, { passive: false });

readingPanel?.addEventListener("click", (event) => {
    event.stopPropagation();
});

readingPanel?.addEventListener("touchstart", (event) => {
    event.stopPropagation();
}, { passive: true });

practiceResetBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    clearLocalPracticeCounts();
});

otherToggleBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleOtherMenu();
});

document.addEventListener("click", (event) => {
    if (!otherMenuOpen) return;
    const target = event.target;
    if (target instanceof Element && (otherMenu?.contains(target) || otherToggleBtn?.contains(target))) return;
    closeOtherMenu();
}, true);

readingListEl?.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const action = target.dataset.action;
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    const itemEl = target.closest(".notes-item");
    const key = itemEl?.getAttribute("data-reading-key") || "";
    const entry = key ? readingMarks[key] : null;
    if (!entry) return;

    if (action === "speak") {
        if (!(entry.word || "").trim()) {
            showToast("No word");
            return;
        }
        speak(entry.word || "");
        return;
    }

    if (action === "remove") {
        if (!adminMode && !ensureAdmin()) return;
        target.setAttribute("disabled", "true");
        const adminKey = getAdminKey();
        const previousState = cloneReadingMarks();
        delete readingMarks[key];
        persistReadingMarks();
        updateReadingListButton();
        renderReadingList();
        if (currentReadingKey === key) {
            syncReadingControlsForItem(session.getCurrentItem());
        }
        try {
            await updateUnitPronMark({
                id: entry.id ?? null,
                adminKey,
                unit: entry.unit || selectedUnit,
                marked: false,
                word: entry.word || "",
                zh: entry.zh || ""
            });
            showToast("Reading mark removed");
            refreshReadingMarksFromServer({ silent: true });
        } catch (error) {
            console.error("Failed to remove reading mark", error);
            readingMarks = previousState;
            persistReadingMarks();
            updateReadingListButton();
            renderReadingList();
            if (currentReadingKey === key) {
                syncReadingControlsForItem(session.getCurrentItem());
            }
            showToast("Failed to remove reading mark");
        } finally {
            target.removeAttribute("disabled");
        }
        return;
    }

    let text = "";
    if (action === "copy-en") {
        text = entry.word || "";
    } else if (action === "copy-zh") {
        text = entry.zh || "";
    }

    if (!text) {
        showToast("Nothing to copy");
        return;
    }

    try {
        const success = await copyText(text);
        showToast(success ? "Copied" : "Copy failed");
    } catch (error) {
        console.error("Failed to copy reading mark", error);
        showToast("Copy failed");
    }
});

roundSizeButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    event.preventDefault();
    if (!adminMode && !ensureAdmin()) return;

    const { MIN, MAX } = ROUND_SIZE_LIMITS;
    const message = "Set round size (" + MIN + "-" + MAX + ").\nCurrent: " + roundSize + ".\nLeave blank to reset (" + DEFAULT_ROUND_SIZE + ").";
    const input = prompt(message, String(roundSize));

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
            showToast("Use " + MIN + "-" + MAX);
            return;
        }
    }

    applyRoundSize(nextValue ?? DEFAULT_ROUND_SIZE);
    showToast("Round size set to " + roundSize);
    session.startRound({ unit: selectedUnit, count: roundSize });
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
    schedulePracticeSync();
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
        response = await markUnitVocabKnown(current.id, adminKey, { unit: selectedUnit });
    } catch (error) {
        console.error("Failed to mark vocab as known", error);
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
        session.invalidatePrefetch?.();
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

function handleUnitChange(unit) {
    if (!unit || unit === selectedUnit) return;

    selectedUnit = unit;
    if (unitSelect && unitSelect.value !== selectedUnit) {
        unitSelect.value = selectedUnit;
    }
    document.body.dataset.unit = selectedUnit;
    setStatus({ phase: "loading", progress: "0/0", remaining: "--", revealed: false, action: "reload", practiceCount: "--" });

    session.startRound({ unit: selectedUnit, count: roundSize }).catch((error) => {
        console.error("Failed to load unit batch", error);
        showToast("Failed to load data");
    });
}

unitSelect?.addEventListener("change", () => {
    handleUnitChange(unitSelect.value);
});

unitSelect?.addEventListener("click", (event) => {
    event.stopPropagation();
});

unitSelect?.addEventListener("mousedown", (event) => {
    event.stopPropagation();
});

unitSelect?.addEventListener("touchstart", (event) => {
    event.stopPropagation();
}, { passive: true });

unitSelectWrapper?.addEventListener("click", (event) => {
    event.stopPropagation();
});

unitSelectWrapper?.addEventListener("mousedown", (event) => {
    event.stopPropagation();
});

unitSelectWrapper?.addEventListener("touchstart", (event) => {
    event.stopPropagation();
}, { passive: true });

let pressTimer = null;

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

document.addEventListener("keydown", (event) => {
    const panelOpen = isReadingPanelOpen();
    if (panelOpen && event.key === "Escape") {
        event.preventDefault();
        closeReadingPanel({ focusToggle: true });
        return;
    }

    if (panelOpen) return;

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

document.body.addEventListener("click", () => {
    if (isReadingPanelOpen()) return;
    session.advance().catch((error) => console.error("Failed to advance session", error));
});

document.body.addEventListener("touchstart", () => {
    document.body.dataset.touch = "1";
}, { once: true, passive: true });

knownBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    markCurrentKnown();
});

copyEnBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    handleCopy((item) => item.word || "");
});

copyZhBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    handleCopy((item) => item.zh || "");
});

(async () => {
    await runBootSequence();
    try {
        await session.startRound({ unit: selectedUnit, count: roundSize });
    } catch (error) {
        console.error("Failed to load vocab batch", error);
        showToast("Failed to load data");
    }
})();
















