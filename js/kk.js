import { showToast } from "./ui/toast.js";
import { copyText } from "./utils/clipboard.js";
import { escapeHtml as esc } from "./utils/html.js";
import { createRoundSession } from "./core/session.js";
import { getRoundSize, setRoundSize, resetRoundSize, ROUND_SIZE_LIMITS, DEFAULT_ROUND_SIZE } from "./core/round-size.js";
import { runBootSequence } from "./boot-screen.js";
import { KK_SYMBOLS } from "./data/kk-symbols.js";

const codeEl = document.getElementById("code");
const statusEl = document.getElementById("status");
const replayBtn = document.getElementById("btnReplay");
const roundSizeButton = document.getElementById("btnRoundSize");
const copySymbolBtn = document.getElementById("copySymbol");
const copyHintBtn = document.getElementById("copyHint");
const copyExamplesBtn = document.getElementById("copyExamples");
const categorySelect = document.getElementById("categoryFilter");

const PLACEHOLDERS = {
    symbol: "[symbol hidden]",
    detail: "[tip hidden]",
    examples: "[examples hidden]"
};
const audioCache = new Map();
let activeAudio = null;
const CATEGORY_STORAGE_KEY = "kk_category";
const ALL_CATEGORY_VALUE = "all";
const AVAILABLE_CATEGORIES = Array.from(
    new Set(KK_SYMBOLS.map((item) => item.category).filter((category) => typeof category === "string" && category.trim()))
);
let currentCategory = loadStoredCategory();
const MODE_KEY = "kk";
const MIN_ALLOWED = Math.min(ROUND_SIZE_LIMITS.MIN, KK_SYMBOLS.length);
const MAX_ALLOWED = Math.min(ROUND_SIZE_LIMITS.MAX, KK_SYMBOLS.length);

const TEMPLATES = [
    ({ symbol, spellings, description, examples, category, showSymbol, showDetails, q, total, remain, seed, roundSize }) => [
        `<span class="cm">// kk@${seed} :: phonetic-journal</span>`,
        `<span class="kw">const</span> <span class="var">ROUND_SIZE</span> <span class="op">=</span> <span class="num">${roundSize}</span>`,
        `<span class="kw">const</span> <span class="var">focus</span> <span class="op">=</span> <span class="str">${showSymbol ? esc(symbol) : PLACEHOLDERS.symbol}</span>`,
        `<span class="kw">const</span> <span class="var">spelling</span> <span class="op">=</span> <span class="str">${showDetails ? esc(spellings) : PLACEHOLDERS.detail}</span>`,
        `<span class="kw">const</span> <span class="var">note</span> <span class="op">=</span> <span class="str">${showDetails ? esc(description) : PLACEHOLDERS.detail}</span>`,
        `<span class="kw">const</span> <span class="var">examples</span> <span class="op">=</span> <span class="str">${showDetails ? esc(examples) : PLACEHOLDERS.examples}</span>`,
        ``,
        `<span class="kw">function</span> <span class="var">recall</span>() {`,
        `  <span class="var">console</span>.<span class="prop">debug</span>(<span class="str">"remaining"</span><span class="op">,</span> <span class="num">${remain}</span>)`,
        `}`,
        ``,
        `<span class="var">recall</span>()`,
        `<span class="cm">// ${q}/${total} -- Space to reveal</span><span class="cursor"></span>`
    ],
    ({ symbol, spellings, description, examples, category, showSymbol, showDetails, q, total, remain, seed, roundSize }) => [
        `<span class="cm"># kk/${seed} :: drillpad</span>`,
        `<span class="kw">focus</span> <span class="op">=</span> <span class="str">${showSymbol ? esc(symbol) : PLACEHOLDERS.symbol}</span>`,
        `<span class="kw">spelling</span> <span class="op">=</span> <span class="str">${showDetails ? esc(spellings) : PLACEHOLDERS.detail}</span>`,
        `<span class="kw">tip</span> <span class="op">=</span> <span class="str">${showDetails ? esc(description) : PLACEHOLDERS.detail}</span>`,
        `<span class="kw">examples</span> <span class="op">=</span> <span class="str">${showDetails ? esc(examples) : PLACEHOLDERS.examples}</span>`,
        ``,
        `<span class="cm"># remain ${remain}</span>`,
        `<span class="cm"># press Space to advance</span><span class="cursor"></span>`
    ]
];

initCategoryOptions();
applyCategory(currentCategory);

function loadStoredCategory() {
    try {
        const stored = localStorage.getItem(CATEGORY_STORAGE_KEY);
        if (stored && AVAILABLE_CATEGORIES.includes(stored)) return stored;
    } catch (error) {
        console.warn("Failed to load category preference", error);
    }
    return ALL_CATEGORY_VALUE;
}

function saveCategoryPreference(value) {
    try {
        localStorage.setItem(CATEGORY_STORAGE_KEY, value);
    } catch (error) {
        console.warn("Failed to save category preference", error);
    }
}

function initCategoryOptions() {
    if (!categorySelect) return;
    categorySelect.innerHTML = "";
    const makeOption = (value, label) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        return option;
    };
    categorySelect.appendChild(makeOption(ALL_CATEGORY_VALUE, "全部"));
    AVAILABLE_CATEGORIES.forEach((category) => {
        categorySelect.appendChild(makeOption(category, category));
    });
}

function applyCategory(value = ALL_CATEGORY_VALUE) {
    const normalized = AVAILABLE_CATEGORIES.includes(value) ? value : ALL_CATEGORY_VALUE;
    currentCategory = normalized;
    saveCategoryPreference(normalized);
    if (categorySelect && categorySelect.value !== normalized) {
        categorySelect.value = normalized;
    }
    if (typeof document !== "undefined" && document.body) {
        document.body.dataset.categoryFilter = normalized;
    }
}

function getCategoryLabel(value = currentCategory) {
    if (!value || value === ALL_CATEGORY_VALUE) return "全部";
    return value;
}


function getCategorySource(category = currentCategory) {
    if (!category || category === ALL_CATEGORY_VALUE) return KK_SYMBOLS;
    return KK_SYMBOLS.filter((item) => item.category === category);
}

let templateIdx = 0;
let roundId = 0;
let lastAutoplayId = null;
let lastAutoplayPhase = null;
let audioStopToken = 0;

let roundSize = getRoundSize(MODE_KEY);
if (!Number.isFinite(roundSize) || roundSize <= 0) {
    roundSize = Math.min(DEFAULT_ROUND_SIZE, KK_SYMBOLS.length);
    setRoundSize(MODE_KEY, roundSize);
}

function updateRoundSizeButton() {
    if (!roundSizeButton) return;
    roundSizeButton.textContent = `Round ${roundSize}`;
}

function applyRoundSize(value) {
    roundSize = Math.max(MIN_ALLOWED, Math.min(value, MAX_ALLOWED));
    updateRoundSizeButton();
    if (typeof document !== "undefined" && document.body) {
        document.body.dataset.roundSize = String(roundSize);
    }
}

applyRoundSize(roundSize);

function formatExamples(item) {
    if (Array.isArray(item?.examples) && item.examples.length) {
        return item.examples.join(", ");
    }
    return "[missing examples]";
}

function setStatus({ phase, progress, remaining, action, category }) {
    if (!statusEl) return;
    statusEl.textContent = [
        `phase :: ${phase}`,
        `progress ${progress}`,
        `remaining ${remaining}`,
        `Space/Enter: ${action}`
    ].join("\n");
}

function buildCode({ symbol, spellings, description, examples, category, showSymbol, showDetails, q, total, remain, currentRoundSize }) {
    const seed = (++roundId).toString(36).slice(-4);
    const lines = TEMPLATES[templateIdx]({
        symbol,
        spellings,
        description,
        examples,
        category,
        showSymbol,
        showDetails,
        q,
        total,
        remain,
        seed,
        roundSize: currentRoundSize
    });
    const start = Math.floor(Math.random() * 20) + 1;
    const lineNo = (n) => String(n).padStart(2, " ");
    return lines.map((line, index) => `<span class="gutter">${lineNo(start + index)}</span>${line}`).join("\n");
}

function render(state) {
    if (!codeEl) return;

    const { batch, index, revealed, remaining, revealPhase = 0 } = state;
    const totalItems = batch.length || roundSize;
    const remainingDisplay = batch.length && index >= 0 ? Math.max(0, totalItems - (index + 1)) : "--";
    const filterLabel = getCategoryLabel();

    if (index < 0 || index >= batch.length) {
        codeEl.innerHTML = buildCode({
            symbol: "RVOCA.kk()",
            spellings: "loading",
            description: "loading symbols",
            examples: "loading",
            category: filterLabel,
            showSymbol: false,
            showDetails: false,
            q: 0,
            total: totalItems,
            remain: remainingDisplay,
            currentRoundSize: roundSize
        });
        document.body.dataset.symbol = "";
        document.body.dataset.examples = "";
        document.body.dataset.category = "";
        setStatus({
            phase: "loading",
            progress: "0/0",
            remaining: remainingDisplay,
            action: "reload",
            category: filterLabel
        });
        return;
    }

    const current = batch[index];
    const q = index + 1;
    const showSymbol = revealPhase >= 1;
    const showDetails = revealPhase >= 2 && revealed;
    const symbolText = showSymbol ? current.symbol : PLACEHOLDERS.symbol;
    const spellingText = showDetails ? current.spellings : PLACEHOLDERS.detail;
    const descriptionText = showDetails ? current.description : PLACEHOLDERS.detail;
    const examplesText = showDetails ? formatExamples(current) : PLACEHOLDERS.examples;
    const categoryLabel = current.category || "未分類";
    const categoryText = showSymbol ? categoryLabel : PLACEHOLDERS.detail;

    codeEl.innerHTML = buildCode({
        symbol: symbolText,
        spellings: spellingText,
        description: descriptionText,
        examples: examplesText,
        category: categoryText,
        showSymbol,
        showDetails,
        q,
        total: totalItems,
        remain: remainingDisplay,
        currentRoundSize: roundSize
    });

    document.body.dataset.symbol = showSymbol ? current.symbol : "";
    document.body.dataset.examples = showDetails ? formatExamples(current) : "";
    document.body.dataset.category = showSymbol ? categoryLabel : "";

    if (revealPhase === 0) {
        scheduleAutoplay(current, revealPhase);
    }

    const phaseLabel = showDetails ? "details" : showSymbol ? "symbol" : "hidden";
    const actionHint = showDetails ? "next" : showSymbol ? "details" : "show symbol";
    setStatus({
        phase: phaseLabel,
        progress: `${q}/${totalItems}`,
        remaining: remainingDisplay,
        action: actionHint,
        category: showSymbol ? categoryLabel : filterLabel
    });
}

function shuffle(array) {
    for (let i = array.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

function enrichItem(item, idx) {
    return {
        ...item,
        _id: `${item.symbol}-${idx}-${Date.now()}`
    };
}

function sampleSymbols(count, { category = ALL_CATEGORY_VALUE } = {}) {
    const source = getCategorySource(category);
    if (!source.length) return [];
    const target = Math.max(1, Math.min(count, source.length));
    const pool = shuffle([...source]);
    return pool.slice(0, target).map(enrichItem);
}

const session = createRoundSession({
    fetchBatch: ({ roundSize: sizeOverride, category } = {}) => {
        const count = typeof sizeOverride === "number" ? sizeOverride : roundSize;
        const activeCategory = typeof category === "string" ? category : currentCategory;
        return Promise.resolve({ items: sampleSymbols(count, { category: activeCategory }) });
    },
    render,
    onRoundWillStart: () => {
        templateIdx = (templateIdx + 1) % TEMPLATES.length;
    },
    enablePrefetch: false
});

function getAudioSources(item) {
    const sources = [];
    const local = item?.audio?.local;
    if (local) {
        sources.push(encodeURI(local));
    }
    return sources;
}

function playAudioSource(src) {
    return new Promise((resolve, reject) => {
        let audio = audioCache.get(src);
        if (!audio) {
            audio = new Audio(src);
            audioCache.set(src, audio);
        }
        if (activeAudio && activeAudio !== audio) {
            try {
                activeAudio.pause();
            } catch (error) {
                console.warn("Failed to pause previous audio", error);
            }
        }
        activeAudio = audio;
        audio.currentTime = 0;
        audio.play().then(resolve).catch((error) => {
            audioCache.delete(src);
            reject(error);
        });
    });
}

async function playAudioForItem(item, { silent = false } = {}) {
    const sources = getAudioSources(item);
    audioStopToken += 1;
    const token = audioStopToken;
    for (const src of sources) {
        try {
            await playAudioSource(src);
            if (token !== audioStopToken) return false;
            return true;
        } catch (error) {
            console.warn(`Audio playback failed for ${src}`, error);
        }
    }
    if (!silent) showToast("Audio unavailable");
    return false;
}

function scheduleAutoplay(item, phase) {
    if (!item) return;
    if (lastAutoplayId === item._id && lastAutoplayPhase === phase) return;
    lastAutoplayId = item._id;
    lastAutoplayPhase = phase;
    audioStopToken += 1;
    playAudioForItem(item, { silent: false });
}

function playCurrentSample() {
    audioStopToken += 1;
    const current = session.getCurrentItem();
    if (!current) {
        showToast("No symbol selected");
        return;
    }
    playAudioForItem(current, { silent: false });
}

roundSizeButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    event.preventDefault();
    const { MIN, MAX } = ROUND_SIZE_LIMITS;
    const lowerBound = Math.min(MIN, KK_SYMBOLS.length);
    const upperBound = Math.min(MAX, KK_SYMBOLS.length);
    const input = prompt(
        `Set round size (${lowerBound}-${upperBound}).\nCurrent: ${roundSize}.\nLeave blank to reset (${Math.min(DEFAULT_ROUND_SIZE, KK_SYMBOLS.length)}).`,
        String(roundSize)
    );
    if (input === null) return;

    const trimmed = input.trim();
    let nextValue;

    if (trimmed === "") {
        nextValue = Math.min(resetRoundSize(MODE_KEY) ?? DEFAULT_ROUND_SIZE, KK_SYMBOLS.length);
    } else {
        const parsed = Number.parseInt(trimmed, 10);
        if (!Number.isFinite(parsed)) {
            showToast("Please enter a number");
            return;
        }
        const bounded = Math.max(lowerBound, Math.min(parsed, upperBound));
        nextValue = setRoundSize(MODE_KEY, bounded) ?? bounded;
    }

    applyRoundSize(nextValue ?? roundSize);
    showToast(`Round size set to ${roundSize}`);
    session.startRound({ roundSize, category: currentCategory }).catch((error) => console.error("Failed to restart round", error));
});

function handleCopy(getValue) {
    const current = session.getCurrentItem();
    if (!current) return;
    const text = getValue(current);
    if (!text) {
        showToast("Nothing to copy");
        return;
    }
    copyText(text)
        .then((ok) => showToast(ok ? "Copied" : "Copy failed"))
        .catch((error) => {
            console.error("Failed to copy text", error);
            showToast("Copy failed");
        });
}

replayBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    playCurrentSample();
});

copySymbolBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    handleCopy((item) => item.symbol);
});

copyHintBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    handleCopy((item) => `${item.spellings} - ${item.description}`);
});

copyExamplesBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    handleCopy((item) => formatExamples(item));
});

categorySelect?.addEventListener("change", (event) => {
    const value = (event.target?.value || "").trim() || ALL_CATEGORY_VALUE;
    applyCategory(value);
    session.startRound({ roundSize, category: currentCategory }).catch((error) => console.error("Failed to filter round", error));
});

document.addEventListener("keydown", (event) => {
    if (event.code === "Space" || event.code === "Enter") {
        event.preventDefault();
        session.advance().catch((error) => console.error("Failed to advance session", error));
    }
});

document.body.addEventListener("click", () => {
    session.advance().catch((error) => console.error("Failed to advance session", error));
});

(async () => {
    await runBootSequence();
    try {
        await session.startRound({ roundSize, category: currentCategory });
    } catch (error) {
        console.error("Failed to load KK symbols", error);
        showToast("Failed to load data");
    }
})();
