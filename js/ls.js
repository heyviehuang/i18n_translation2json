import { ROUND_SIZE, LONGPRESS_MS, ADMIN_KEY_NAME } from "./config.js";
import { fetchListeningBatch, markListeningKnown } from "./services/api.js";
import { speak } from "./utils/speech.js";
import { copyText } from "./utils/clipboard.js";
import { escapeHtml as esc } from "./utils/html.js";
import { showToast } from "./ui/toast.js";
import { createRoundSession } from "./core/session.js";

const codeEl = document.getElementById("code");
const statusEl = document.getElementById("status");
const fabEl = document.getElementById("fab");
const knownBtn = document.getElementById("btnKnown");
const adminBadge = document.getElementById("adminBadge");
const copyEnBtn = document.getElementById("copyEn");
const copyZhBtn = document.getElementById("copyZh");

const englishSelector = "[data-role=\"sentence\"]";

let adminMode = false;
let pressTimer = null;

function setStatus(message) {
    if (statusEl) statusEl.textContent = message;
}

function buildCode(en, zh, q, total, remaining, revealed) {
    const start = 10;
    const pad = (n) => String(n).padStart(2, " ");
    const G = (n) => `<span class="gutter">${pad(n)}</span>`;
    const EN = `<span class="str listen-en-line${revealed ? "" : " revealable"}" data-role="sentence">"${esc(en)}"</span>`;
    const ZH = revealed && zh ? `<br><span class="cm"># '${esc(zh)}'</span>` : "";

    const lines = [
        `${G(start + 0)}<span class="cm"># rvoca build</span>`,
        `${G(start + 1)}<span class="var">ROUND_SIZE</span><span class="op">=</span><span class="num">${ROUND_SIZE}</span>`,
        `${G(start + 2)}set -e`,
        `${G(start + 3)} `,
        `${G(start + 4)}res=$(jsonp <span class="str">action=nextBatch</span> <span class="str">count=${ROUND_SIZE}</span>)`,
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

    const { batch, index, revealed, remaining } = state;

    if (index < 0 || index >= batch.length) {
        codeEl.innerHTML = buildCode("RVOCA.reload()", "", 0, ROUND_SIZE, remaining, false);
        setStatus(`# awaiting batch\n# Space/Enter->reload`);
        return;
    }

    const current = batch[index];
    const en = current.en ?? current.word ?? "";
    const zh = current.zh ?? "";
    const q = index + 1;
    const total = batch.length || ROUND_SIZE;

    codeEl.innerHTML = buildCode(en, zh, q, total, remaining, revealed);

    const headline = revealed ? "# translation :: revealed" : "# translation :: hidden";
    setStatus(`# translation :: hidden\n# progress ${q}/${total}\n# remaining ${remaining}`);
}

const session = createRoundSession({
    fetchBatch: (options = {}) => {
        const { series = null, count = ROUND_SIZE } = options;
        return fetchListeningBatch({ count, series });
    },
    render,
    speakItem: (item) => speak(item.en ?? item.word ?? "")
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

session.startRound().catch((error) => {
    console.error("Failed to load listening batch", error);
    setStatus(`# load failed\n# retry shortly`);
    showToast("Failed to load data");
});




