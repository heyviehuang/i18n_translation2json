
import { LONGPRESS_MS, ADMIN_KEY_NAME } from "./config.js";
import { fetchVocabBatch, markKnown } from "./services/api.js";
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

const TEMPLATES = [
    ({ word, zh, showZh, q, total, remain, seed, roundSize }) => [
        `<span class="cm">// rvoca@${seed} :: runtime bootstrap</span>`,
        `<span class="kw">import</span> <span class="var">{ jsonp, speak }</span> <span class="kw">from</span> <span class="str">'rvoca/runtime'</span>`,
        `<span class="kw">const</span> <span class="var">ROUND_SIZE</span> <span class="op">=</span> <span class="num">${roundSize}</span>`,
        `<span class="kw">let</span> <span class="var">batch</span><span class="op">:</span><span class="var">any[]</span> <span class="op">=</span> []<span class="op">,</span> <span class="var">ix</span> <span class="op">=</span> <span class="num">0</span>`,
        ``,
        `<span class="kw">async function</span> <span class="var">main</span>() {`,
        `  <span class="kw">const</span> <span class="var">res</span> <span class="op">=</span> <span class="kw">await</span> <span class="var">jsonp</span>({ <span class="prop">action</span><span class="op">:</span> <span class="str">"nextBatch"</span>, <span class="prop">count</span><span class="op">:</span> <span class="var">ROUND_SIZE</span> })`,
        `  <span class="var">batch</span> <span class="op">=</span> <span class="var">res</span>.<span class="prop">items</span> <span class="op">||</span> []`,
        `  <span class="kw">const</span> <span class="var">progress</span> <span class="op">=</span> <span class="str">"${q}/${total}"</span> <span class="cm">// progress</span>`,
        `  <span class="var">document</span>.<span class="prop">body</span>.<span class="prop">dataset</span>.<span class="prop">w</span> <span class="op">=</span> <span class="str">"${esc(word)}"</span>${showZh ? ` <span class="cm">'${esc(zh)}'</span>` : ""}`,
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
        `<span class="cm">// press Space to reveal, then next</span><span class="cursor"></span>`
    ],
    ({ word, zh, showZh, q, total, remain, seed, roundSize }) => [
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
        `<span class="cm"># progress ${q}/${total}</span><span class="cursor"></span>`,
        ``,
        `<span class="cm"># EOF</span>`
    ],
    ({ word, zh, showZh, q, total, remain, seed, roundSize }) => [
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
        `<span class="cm"># progress ${q}/${total}</span><span class="cursor"></span>`,
        `exit 0`
    ]
];

let templateIdx = 0;
let roundId = 0;
let adminMode = false;

const MODE_KEY = "vb";
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
        `phase :: ${phase}`,
        `progress ${progress}`,
        `remaining ${remaining}`,
        `Space/Enter: ${action} | K = mark known`
    ].join("\n");
}
function buildCode(word, zh, showZh, q, total, remain, currentRoundSize) {
    const seed = (++roundId).toString(36).slice(-4);
    const lines = TEMPLATES[templateIdx]({ word, zh, showZh, q, total, remain, seed, roundSize: currentRoundSize });
    const start = Math.floor(Math.random() * 20) + 1;
    const lineNo = (n) => String(n).padStart(2, " ");
    return lines.map((line, index) => `<span class="gutter">${lineNo(start + index)}</span>${line}`).join("\n");
}
function render(state) {
    if (!codeEl) return;

    const { batch, index, revealed, remaining, revealPhase = 0 } = state;
    const remainingDisplay = typeof remaining === "number" && !Number.isNaN(remaining) ? remaining : "--";

    document.body.dataset.roundSize = String(roundSize);

    if (index < 0 || index >= batch.length) {
        codeEl.innerHTML = buildCode("RVOCA.reload()", "not loaded", false, 0, roundSize, remainingDisplay, roundSize);
        document.body.dataset.w = "";
        delete document.body.dataset.zh;
        setStatus({
            phase: "loading",
            progress: "0/0",
            remaining: remainingDisplay,
            action: "reload"
        });
        return;
    }

    const current = batch[index];
    const q = index + 1;
    const total = batch.length || roundSize;
    const showEnglish = revealPhase >= 1;
    const showZh = revealPhase >= 2 && revealed;
    const wordForDisplay = showEnglish ? current.word : "";

    codeEl.innerHTML = buildCode(wordForDisplay, current.zh || "[missing zh]", showZh, q, total, remainingDisplay, roundSize);

    document.body.dataset.w = showEnglish ? (current.word || "") : "";
    if (showZh && current.zh) document.body.dataset.zh = current.zh;
    else delete document.body.dataset.zh;

    const phaseLabel = showZh ? "translation" : showEnglish ? "english" : "hidden";
    const actionHint = showZh ? "next" : showEnglish ? "show zh" : "show en";
    setStatus({
        phase: phaseLabel,
        progress: `${q}/${total}`,
        remaining: remainingDisplay,
        action: actionHint
    });
}
const session = createRoundSession({
    fetchBatch: ({ roundSize: sizeOverride } = {}) => {
        const count = typeof sizeOverride === "number" ? sizeOverride : roundSize;
        return fetchVocabBatch(count);
    },
    render,
    speakItem: (item) => speak(item.word),
    onRoundWillStart: () => {
        templateIdx = (templateIdx + 1) % TEMPLATES.length;
    },
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
    session.startRound({ roundSize });
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
        response = await markKnown(current.id, adminKey);
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
let pressTimer = null;

document.addEventListener("touchstart", () => {
    pressTimer = setTimeout(() => ensureAdmin(), LONGPRESS_MS);
}, { passive: true });

document.addEventListener("touchend", () => {
    if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
    }
}, { passive: true });

document.addEventListener("mousedown", () => {
    pressTimer = setTimeout(() => ensureAdmin(), LONGPRESS_MS);
});

document.addEventListener("mouseup", () => {
    if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
    }
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
        await session.startRound({ roundSize });
    } catch (error) {
        console.error("Failed to load vocab batch", error);
        showToast("Failed to load data");
    }
})();
