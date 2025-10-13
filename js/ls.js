import { ROUND_SIZE } from "./config.js";
import { fetchListeningBatch } from "./services/api.js";
import { speak } from "./utils/speech.js";
import { copyText } from "./utils/clipboard.js";
import { escapeHtml as esc } from "./utils/html.js";
import { showToast } from "./ui/toast.js";
import { createRoundSession } from "./core/session.js";

function buildCode(word, q, total, remain, revealed, zh) {
    const start = 10;
    const pad = (n) => String(n).padStart(2, " ");
    const lines = [
        `<span class="cm">// rvoca listening :: runtime</span>`,
        `<span class="kw">const</span> <span class="var">ROUND_SIZE</span> <span class="op">=</span> <span class="num">${ROUND_SIZE}</span>`,
        ``,
        `<span class="kw">try</span> {`,
        `  <span class="var">speak</span>(<span class="str">'${esc(word)}'</span>)`,
        `} <span class="kw">catch</span> (<span class="var">err</span>) {}`,
        ``,
        `<span class="cm">// remain:</span> <span class="num">${remain}</span> <span class="cm">// progress:</span> <span class="num">${q}</span>/<span class="num">${total}</span>`,
        `<span class="cm">// press Space to reveal, then next</span><span class="cursor"></span>`
    ];

    if (revealed) {
        lines.push(`<span class="cm"># ${esc(zh || "No translation")}</span>`);
    }

    return lines.map((line, index) => `<span class="gutter">${pad(start + index)}</span>${line}`).join("\n");
}

function render(state) {
    const code = document.getElementById("code");
    if (!code) return;

    const { batch, index, revealed, remaining } = state;

    if (index < 0 || index >= batch.length) {
        code.innerHTML = buildCode("RVOCA.reload()", 0, ROUND_SIZE, remaining, false, "");
        return;
    }

    const current = batch[index];
    const q = index + 1;
    const total = batch.length || ROUND_SIZE;
    code.innerHTML = buildCode(current.word, q, total, remaining, revealed, current.zh);
}

const session = createRoundSession({
    fetchBatch: (options = {}) => {
        const { series = null, count = ROUND_SIZE } = options;
        return fetchListeningBatch({ count, series });
    },
    render,
    speakItem: (item) => speak(item.word)
});

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

document.addEventListener("keydown", (event) => {
    if (event.code === "Space" || event.code === "Enter") {
        event.preventDefault();
        session.advance().catch((error) => console.error("Failed to advance session", error));
    }
});

document.body.addEventListener("click", () => session.advance().catch((error) => console.error("Failed to advance session", error)));

document.getElementById("copyEn")?.addEventListener("click", (event) => {
    event.stopPropagation();
    handleCopy((item) => item.word);
});

document.getElementById("copyZh")?.addEventListener("click", (event) => {
    event.stopPropagation();
    handleCopy((item) => item.zh || "");
});

session.startRound().catch((error) => {
    console.error("Failed to load listening batch", error);
    showToast("Failed to load data");
});
