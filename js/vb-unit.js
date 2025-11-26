
import { LONGPRESS_MS, ADMIN_KEY_NAME } from "./config.js";
import {
    fetchUnitVocabBatch,
    markUnitVocabKnown,
    fetchUnitPronMarks,
    updateUnitPronMark,
    incrementUnitPracticeCounts
} from "./services/api.js";
import { speak } from "./utils/speech.js";
import { copyText } from "./utils/clipboard.js";
import { escapeHtml as esc } from "./utils/html.js";
import { showToast } from "./ui/toast.js";
import { createRoundSession } from "./core/session.js";
import { getRoundSize, setRoundSize, resetRoundSize, ROUND_SIZE_LIMITS, DEFAULT_ROUND_SIZE } from "./core/round-size.js";
import { runBootSequence } from "./boot-screen.js";
import { createTracker } from "./vocab-tracker.js";

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
const flagBtn = document.getElementById("btnFlag");
const vocabListBtn = document.getElementById("btnVocabList");
const vocabOverlay = document.getElementById("vocabOverlay");
const vocabPanel = document.getElementById("vocabPanel");
const vocabCloseBtn = document.getElementById("btnVocabClose");
const listActiveEl = document.getElementById("vocabListActive");

const UNIT_LIST_FETCH_COUNT = 800;
const STAR_ON = "\u2605";
const STAR_OFF = "\u2606";
const MODE_KEY = "vb-unit";
const READING_MARKS_STORAGE_KEY = "vb-unit.readingMarks";
const READING_MARK_IDLE_LABEL = "PRON Mark";
const READING_MARK_ACTIVE_LABEL = "PRON Marked";
const READING_LIST_LABEL = "PRON List";
const PRACTICE_COUNTS_STORAGE_KEY = "vb-unit.practiceCounts";
const PRACTICE_SYNC_THRESHOLD = 5;

let selectedUnit = unitSelect?.value || "1";
if (unitSelect && unitSelect.value !== selectedUnit) {
    unitSelect.value = selectedUnit;
}
document.body.dataset.unit = selectedUnit;

let roundSize = getRoundSize(MODE_KEY);
let templateIdx = 0;
let roundId = 0;
let adminMode = false;
let otherMenuOpen = false;

const tracker = createTracker({ mode: MODE_KEY, onChange: renderTrackerLists });
let readingMarks = loadReadingMarks();
let readingMarksLoading = false;
let readingMarksError = null;
let practiceCounts = loadPracticeCounts();
let practiceSyncScheduled = false;
let practiceSyncInFlight = false;

applyRoundSize(roundSize);
updateRoundSizeButton();
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
function lineNo(n) {
    return String(n).padStart(2, " ");
}

function buildCode(word, zh, showZh, q, total, remain, currentRoundSize, practiceCount) {
    const seed = (++roundId).toString(36).slice(-4);
    const lines = TEMPLATES[templateIdx]({ word, zh, showZh, q, total, remain, seed, roundSize: currentRoundSize, practiceCount });
    const start = Math.floor(Math.random() * 20) + 1;
    return lines.map((line, index) => `<span class="gutter">${lineNo(start + index)}</span>${line}`).join("\n");
}

function setStatus({ phase, progress, remaining, action, practiceCount }) {
    if (!statusEl) return;
    const practiceDisplay = typeof practiceCount === "number" && Number.isFinite(practiceCount) ? practiceCount : "--";
    statusEl.textContent = [
        `Unit ${selectedUnit} :: ${phase}`,
        `progress ${progress}`,
        `remaining ${remaining}`,
        `revisit ${practiceDisplay}`,
        `Space/Enter: ${action} | K = mark known`
    ].join("\n");
}

function updateRoundSizeButton() {
    if (roundSizeButton) {
        roundSizeButton.textContent = `Round ${roundSize}`;
    }
}

function applyRoundSize(value) {
    roundSize = value;
    updateRoundSizeButton();
    if (document?.body) {
        document.body.dataset.roundSize = String(roundSize);
    }
}

function renderList(targetEl, items = []) {
    if (!targetEl) return;
    if (!items.length) {
        targetEl.innerHTML = `<li class="vocab-item"><div class="vocab-item__meta"><span class="vocab-item__word muted">Empty</span></div></li>`;
        return;
    }
    targetEl.innerHTML = items
        .map((item) => {
            const star = item.flagged ? STAR_ON : STAR_OFF;
            return `<li class="vocab-item${item.flagged ? " is-flagged" : ""}" data-key="${esc(item.key)}">
                <div class="vocab-item__meta">
                    <span class="vocab-item__word">${esc(item.word || "")}</span>
                    ${item.zh ? `<span class="vocab-item__zh">${esc(item.zh)}</span>` : ""}
                </div>
                <button class="vocab-item__flag-dot" type="button" data-action="flag" data-key="${esc(item.key)}">${star}</button>
            </li>`;
        })
        .join("");
}

function updateFlagButton(currentItem) {
    if (!flagBtn) return;
    const flagged = currentItem ? tracker.isFlagged(currentItem) : false;
    flagBtn.classList.toggle("is-active", flagged);
    flagBtn.setAttribute("aria-pressed", flagged ? "true" : "false");
    flagBtn.textContent = flagged ? STAR_ON : STAR_OFF;
}

function renderTrackerLists(currentItem = null) {
    const { studying } = tracker.getLists();
    const filtered = studying.filter((item) => !item.unit || item.unit === selectedUnit);
    renderList(listActiveEl, filtered);
    updateFlagButton(currentItem);
}

async function loadFullUnitList() {
    try {
        const response = await fetchUnitVocabBatch({ count: UNIT_LIST_FETCH_COUNT, unit: selectedUnit });
        const items = Array.isArray(response?.items) ? response.items : [];
        if (items.length) tracker.upsertBatch(items);
        renderTrackerLists(session.getCurrentItem());
    } catch (error) {
        console.error("Failed to load unit list", error);
        showToast("Failed to load list");
    }
}

function toggleListPanel() {
    if (!vocabPanel || !vocabOverlay) return;
    const isOpen = vocabPanel.classList.toggle("show");
    vocabOverlay.classList.toggle("show", isOpen);
    vocabPanel.setAttribute("aria-hidden", isOpen ? "false" : "true");
    vocabOverlay.setAttribute("aria-hidden", isOpen ? "false" : "true");
}

function speakItem(item) {
    if (!item) return;
    try {
        speak(item.word);
    } catch (error) {
        console.warn("speak failed", error);
    }
}

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

function makePracticeKey(item) {
    if (!item) return null;
    const unit = item.unit || selectedUnit || "";
    const word = item.word || item.en || "";
    if (!word) return null;
    return `${unit}::${word}`;
}

function loadPracticeCounts() {
    try {
        const raw = localStorage.getItem(PRACTICE_COUNTS_STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch (error) {
        console.error("Failed to load practice counts", error);
        return {};
    }
}

function persistPracticeCounts() {
    try {
        localStorage.setItem(PRACTICE_COUNTS_STORAGE_KEY, JSON.stringify(practiceCounts));
    } catch (error) {
        console.error("Failed to persist practice counts", error);
    }
}

function ensurePracticeEntry(item) {
    const key = makePracticeKey(item);
    if (!key) return null;
    if (!practiceCounts[key]) {
        practiceCounts[key] = { key, word: item.word || "", unit: item.unit || selectedUnit, id: item.id ?? null, local: 0, synced: 0 };
    }
    return practiceCounts[key];
}

function getPracticeCount(item) {
    const key = makePracticeKey(item);
    if (!key) return 0;
    return practiceCounts[key]?.local ?? 0;
}

function getPracticeCountByKey(key) {
    return practiceCounts[key]?.local ?? 0;
}

function incrementPracticeCount(item) {
    const entry = ensurePracticeEntry(item);
    if (!entry) return;
    entry.local += 1;
    persistPracticeCounts();
    schedulePracticeSync();
}

function schedulePracticeSync() {
    if (practiceSyncInFlight || practiceSyncScheduled) return;
    practiceSyncScheduled = true;
    setTimeout(() => {
        practiceSyncScheduled = false;
        maybeSyncPracticeCounts();
    }, 300);
}

async function maybeSyncPracticeCounts() {
    if (practiceSyncInFlight) return;
    const adminKey = getAdminKey();
    if (!adminKey) return;
    const pending = Object.values(practiceCounts).filter((entry) => entry.local - entry.synced >= PRACTICE_SYNC_THRESHOLD);
    if (!pending.length) return;
    practiceSyncInFlight = true;
    try {
        const payload = pending.map((entry) => ({
            id: entry.id ?? null,
            word: entry.word || "",
            unit: entry.unit || selectedUnit,
            delta: entry.local - entry.synced
        }));
        await incrementUnitPracticeCounts(payload, adminKey);
        pending.forEach((entry) => {
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
    if (session?.state) render(session.state);
}
function loadReadingMarks() {
    try {
        const raw = localStorage.getItem(READING_MARKS_STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch (error) {
        console.error("Failed to load reading marks", error);
        return {};
    }
}

function persistReadingMarks() {
    try {
        localStorage.setItem(READING_MARKS_STORAGE_KEY, JSON.stringify(readingMarks));
    } catch (error) {
        console.error("Failed to persist reading marks", error);
    }
}

function getReadingKey(item) {
    if (!item) return null;
    const unit = item.unit || selectedUnit || "";
    const word = item.word || item.en || "";
    if (item.id != null) return String(item.id);
    if (!word) return null;
    return `${unit}::${word}`;
}

function getReadingEntry(itemOrKey) {
    const key = typeof itemOrKey === "string" ? itemOrKey : getReadingKey(itemOrKey);
    if (!key) return null;
    return readingMarks[key] || null;
}

function isReadingMarked(item) {
    const entry = getReadingEntry(item);
    return Boolean(entry?.marked);
}

function upsertReadingEntry(item, marked) {
    const key = getReadingKey(item);
    if (!key) return null;
    readingMarks[key] = {
        key,
        id: item.id ?? null,
        word: item.word || "",
        zh: item.zh || "",
        unit: item.unit || selectedUnit,
        marked,
        updatedAt: Date.now()
    };
    persistReadingMarks();
    return readingMarks[key];
}

async function setReadingMark(item, marked) {
    if (!item) return;
    if (!adminMode && !ensureAdmin()) return;
    const adminKey = getAdminKey();
    const previous = { ...readingMarks };
    upsertReadingEntry(item, marked);
    syncReadingControlsForItem(item);
    renderReadingListIfOpen();
    try {
        await updateUnitPronMark({
            id: item.id ?? null,
            adminKey,
            unit: item.unit || selectedUnit,
            marked,
            word: item.word || "",
            zh: item.zh || ""
        });
    } catch (error) {
        console.error("Failed to update reading mark", error);
        showToast("Failed to sync reading mark");
        readingMarks = previous;
        persistReadingMarks();
        syncReadingControlsForItem(item);
        renderReadingListIfOpen();
    }
}

function getReadingEntries() {
    return Object.values(readingMarks || {}).filter((entry) => entry.marked);
}

function renderReadingList() {
    if (!readingListEl) return;
    if (readingMarksLoading && !Object.keys(readingMarks).length) {
        readingListEl.innerHTML = `<li class="notes-empty">Syncing reading marks...</li>`;
        return;
    }
    if (readingMarksError && !getReadingEntries().length) {
        readingListEl.innerHTML = `<li class="notes-empty">Unable to load reading marks</li>`;
        return;
    }
    const entries = getReadingEntries();
    if (!entries.length) {
        readingListEl.innerHTML = `<li class="notes-empty">No reading marks yet</li>`;
        return;
    }
    const items = entries
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
        .map((entry) => {
            const practice = getPracticeCountByKey(entry.key);
            const badge = practice > 0 ? `<span class="notes-item__badge">x${practice}</span>` : "";
            return `<li class="notes-item" data-reading-key="${esc(entry.key)}">
                <div class="notes-item__title">${esc(entry.word || "")}</div>
                ${entry.zh ? `<div class="notes-item__sub">${esc(entry.zh)}</div>` : ""}
                ${badge}
            </li>`;
        });
    readingListEl.innerHTML = items.join("\n");
}

function renderReadingListIfOpen() {
    if (isReadingPanelOpen()) {
        renderReadingList();
    }
}

async function refreshReadingMarksFromServer({ silent = false } = {}) {
    if (readingMarksLoading) return;
    readingMarksLoading = true;
    readingMarksError = null;
    if (!silent) renderReadingListIfOpen();
    try {
        const response = await fetchUnitPronMarks({ unit: selectedUnit });
        const items = Array.isArray(response?.items) ? response.items : [];
        const next = { ...readingMarks };
        items.forEach((item) => {
            const key = getReadingKey(item);
            if (!key) return;
            next[key] = {
                key,
                id: item.id ?? null,
                word: item.word || "",
                zh: item.zh || "",
                unit: item.unit || selectedUnit,
                marked: Boolean(item.marked ?? true),
                updatedAt: Date.parse(item.updatedAt || "") || Date.now()
            };
        });
        readingMarks = next;
        persistReadingMarks();
        renderReadingListIfOpen();
        syncReadingControlsForItem(session.getCurrentItem());
        updateReadingListButton();
    } catch (error) {
        console.error("Failed to load reading marks", error);
        readingMarksError = error;
        renderReadingListIfOpen();
    } finally {
        readingMarksLoading = false;
    }
}

function syncReadingControlsForItem(item) {
    if (!readingMarkBtn) return;
    const marked = isReadingMarked(item);
    readingMarkBtn.classList.toggle("is-active", marked);
    readingMarkBtn.setAttribute("aria-pressed", marked ? "true" : "false");
    readingMarkBtn.textContent = marked ? READING_MARK_ACTIVE_LABEL : READING_MARK_IDLE_LABEL;
}

function updateReadingListButton() {
    if (!readingListBtn) return;
    const count = getReadingEntries().length;
    readingListBtn.textContent = count ? `${READING_LIST_LABEL} (${count})` : READING_LIST_LABEL;
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
    if (otherMenuOpen) closeOtherMenu();
    else openOtherMenu();
}
function render(state) {
    if (!codeEl) return;
    const { batch, index, revealed, remaining, revealPhase = 0 } = state;
    tracker.upsertBatch(batch);
    const remainingDisplay = typeof remaining === "number" && !Number.isNaN(remaining) ? remaining : "--";

    document.body.dataset.roundSize = String(roundSize);
    document.body.dataset.unit = selectedUnit;

    if (index < 0 || index >= batch.length) {
        codeEl.innerHTML = buildCode("RVOCA.reload()", "not loaded", false, 0, roundSize, remainingDisplay, roundSize, "--");
        document.body.dataset.w = "";
        delete document.body.dataset.zh;
        syncReadingControlsForItem(null);
        renderTrackerLists(null);
        setStatus({
            phase: "loading",
            progress: "0/0",
            remaining: remainingDisplay,
            action: "reload",
            practiceCount: "--"
        });
        return;
    }

    const current = batch[index];
    const q = index + 1;
    const total = batch.length || roundSize;
    const showEnglish = revealPhase >= 1;
    const showZh = revealPhase >= 2 && revealed;
    const wordForDisplay = showEnglish ? current.word : "";

    let practiceCount = getPracticeCount(current);
    if (showZh && !current.__practiceLogged) {
        current.__practiceLogged = true;
        incrementPracticeCount(current);
        practiceCount = getPracticeCount(current);
    }

    codeEl.innerHTML = buildCode(wordForDisplay, current.zh || "[missing zh]", showZh, q, total, remainingDisplay, roundSize, practiceCount);

    document.body.dataset.w = showEnglish ? (current.word || "") : "";
    if (showZh && current.zh) document.body.dataset.zh = current.zh;
    else delete document.body.dataset.zh;

    syncReadingControlsForItem(current);
    renderTrackerLists(current);

    setStatus({
        phase: showZh ? "translation" : showEnglish ? "english" : "hidden",
        progress: `${q}/${total}`,
        remaining: remainingDisplay,
        action: showZh ? "next" : showEnglish ? "show zh" : "show en",
        practiceCount
    });
}

const session = createRoundSession({
    fetchBatch: ({ count = roundSize, unit = selectedUnit } = {}) => fetchUnitVocabBatch({ count, unit }),
    render,
    speakItem,
    onRoundWillStart: () => {
        setStatus({ phase: "loading", progress: "0/0", remaining: "--", action: "loading", practiceCount: "--" });
    },
    enablePrefetch: true
});

function setNextTemplate() {
    templateIdx = (templateIdx + 1) % TEMPLATES.length;
}

function handleCopy(getText) {
    const current = session.getCurrentItem();
    if (!current) return;
    const text = getText(current);
    if (!text) return;
    copyText(text)
        .then((ok) => showToast(ok ? "Copied" : "Copy failed"))
        .catch((error) => {
            console.error("Failed to copy text", error);
            showToast("Copy failed");
        });
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
        const remaining = typeof response.remaining === "number" ? response.remaining : Math.max(0, session.state.remaining - 1);
        session.setRemaining(remaining);
        session.invalidatePrefetch?.();
        tracker.markDeleted(current);
        renderTrackerLists(current);
        await session.advance().catch((error) => console.error("Failed to advance after markKnown", error));
    }
}

function handleUnitChange(unit) {
    if (!unit || unit === selectedUnit) return;
    selectedUnit = unit;
    if (unitSelect && unitSelect.value !== selectedUnit) {
        unitSelect.value = selectedUnit;
    }
    document.body.dataset.unit = selectedUnit;
    setStatus({ phase: "loading", progress: "0/0", remaining: "--", action: "reload", practiceCount: "--" });
    if (vocabPanel && vocabOverlay) {
        vocabPanel.classList.remove("show");
        vocabPanel.setAttribute("aria-hidden", "true");
        vocabOverlay.classList.remove("show");
        vocabOverlay.setAttribute("aria-hidden", "true");
    }
    renderTrackerLists(null);
    refreshReadingMarksFromServer({ silent: true });
    session.startRound({ unit: selectedUnit, count: roundSize }).catch((error) => {
        console.error("Failed to load unit batch", error);
        showToast("Failed to load data");
    });
}

function handleRoundSizeClick() {
    const current = roundSize;
    const promptText = `Round size (${ROUND_SIZE_LIMITS.min}-${ROUND_SIZE_LIMITS.max})`;
    const input = prompt(promptText, String(current));
    if (input === null) return;
    const nextValue = Number(input);
    if (!Number.isFinite(nextValue) || nextValue < ROUND_SIZE_LIMITS.min || nextValue > ROUND_SIZE_LIMITS.max) {
        alert(`Please enter a number between ${ROUND_SIZE_LIMITS.min} and ${ROUND_SIZE_LIMITS.max}`);
        return;
    }
    setRoundSize(MODE_KEY, nextValue);
    applyRoundSize(nextValue ?? DEFAULT_ROUND_SIZE);
    session.startRound({ unit: selectedUnit, count: roundSize }).catch((error) => {
        console.error("Failed to reload round", error);
        showToast("Failed to reload");
    });
}

function attachUnitStopPropagation(el) {
    el?.addEventListener("click", (event) => event.stopPropagation());
    el?.addEventListener("mousedown", (event) => event.stopPropagation());
    el?.addEventListener("touchstart", (event) => event.stopPropagation(), { passive: true });
}

unitSelect?.addEventListener("change", () => handleUnitChange(unitSelect.value));
attachUnitStopPropagation(unitSelect);
attachUnitStopPropagation(unitSelectWrapper);

roundSizeButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    event.preventDefault();
    handleRoundSizeClick();
});

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

flagBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    const current = session.getCurrentItem();
    tracker.toggleFlag(current);
    renderTrackerLists(current);
});

vocabListBtn?.addEventListener("click", async (event) => {
    event.stopPropagation();
    closeOtherMenu();
    await loadFullUnitList();
    toggleListPanel();
});

otherMenu?.addEventListener("click", (event) => event.stopPropagation());
vocabOverlay?.addEventListener("click", () => toggleListPanel());
vocabCloseBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleListPanel();
});

vocabPanel?.addEventListener("click", (event) => {
    const flagControl = event.target.closest?.("[data-action='flag']");
    if (!flagControl) return;
    event.stopPropagation();
    const key = flagControl.dataset.key;
    tracker.toggleFlagByKey(key);
    renderTrackerLists(session.getCurrentItem());
});

document.addEventListener("click", (event) => {
    if (!vocabPanel || !vocabOverlay) return;
    if (!vocabPanel.classList.contains("show")) return;
    const target = event.target;
    if (target instanceof Element && (vocabPanel.contains(target) || otherMenu?.contains(target))) return;
    toggleListPanel();
}, true);

otherToggleBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleOtherMenu();
});

document.addEventListener("click", (event) => {
    if (!otherMenuOpen) return;
    const target = event.target;
    if (target instanceof Element && (otherMenu.contains(target) || otherToggleBtn.contains(target))) return;
    closeOtherMenu();
}, true);
readingMarkBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const current = session.getCurrentItem();
    const next = !isReadingMarked(current);
    setReadingMark(current, next);
});

readingListBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openReadingPanel();
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

readingPanel?.addEventListener("click", (event) => event.stopPropagation());
readingPanel?.addEventListener("touchstart", (event) => event.stopPropagation(), { passive: true });

readingListEl?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const itemEl = target.closest("[data-reading-key]");
    if (!itemEl) return;
    const key = itemEl.dataset.readingKey;
    const entry = getReadingEntry(key);
    if (!entry) return;
    const current = session.getCurrentItem();
    const same = current && getReadingKey(current) === key;
    setReadingMark(entry, false);
    if (same) syncReadingControlsForItem(current);
});

practiceResetBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    clearLocalPracticeCounts();
});

copyEnBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    handleCopy((item) => item.word || "");
});

copyZhBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    handleCopy((item) => item.zh || "");
});

fabEl?.addEventListener("click", (event) => event.stopPropagation());

codeEl?.addEventListener("click", (event) => {
    event.stopPropagation();
    setNextTemplate();
    render(session.state);
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



