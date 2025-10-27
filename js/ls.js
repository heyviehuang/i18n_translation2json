import { LONGPRESS_MS, ADMIN_KEY_NAME } from "./config.js";
import { fetchListeningBatch, markListeningKnown } from "./services/api.js";
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

const englishSelector = "[data-role=\"sentence\"]";

let adminMode = false;
let pressTimer = null;

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
















