import { speak } from "./utils/speech.js";

const textArea = document.getElementById("practiceText");
const btnSpeak = document.getElementById("btnSpeak");
const btnClear = document.getElementById("btnClear");
const statusEl = document.getElementById("practiceStatus");
const rateSlider = document.getElementById("rateSlider");
const rateBar = document.getElementById("rateBar");
const rateValue = document.getElementById("rateValue");

const EN_LANG = "en-US";
const ZH_LANG = "zh-TW";

function formatRateBar(rate) {
    const min = Number(rateSlider.min);
    const max = Number(rateSlider.max);
    const steps = 10;
    const clamped = Math.min(Math.max(rate, min), max);
    const ratio = (clamped - min) / (max - min);
    const filled = Math.round(ratio * steps);
    const empty = steps - filled;
    return `[${"#".repeat(filled)}${"-".repeat(empty)}]`;
}

function updateRateUI() {
    const rate = Number(rateSlider.value);
    rateBar.textContent = formatRateBar(rate);
    rateValue.textContent = `${rate.toFixed(2)}x`;
}

function setStatus(message) {
    statusEl.textContent = message;
}

function isCJK(char) {
    return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u.test(char);
}

function splitSegments(text) {
    const segments = [];
    let buffer = "";
    let currentType = null;

    for (const ch of text) {
        const type = isCJK(ch) ? "cjk" : "latin";
        if (currentType === null) {
            currentType = type;
        }
        if (type !== currentType) {
            if (buffer.trim()) {
                segments.push({ text: buffer.trim(), type: currentType });
            }
            buffer = ch;
            currentType = type;
        } else {
            buffer += ch;
        }
    }

    if (buffer.trim()) {
        segments.push({ text: buffer.trim(), type: currentType });
    }

    return segments;
}

function speakAuto(text, rate) {
    const segments = splitSegments(text);
    if (!segments.length) return;

    speechSynthesis.cancel();

    segments.forEach((segment) => {
        const utterance = new SpeechSynthesisUtterance(segment.text);
        utterance.lang = segment.type === "cjk" ? ZH_LANG : EN_LANG;
        utterance.rate = rate;
        speechSynthesis.speak(utterance);
    });
}

function handleSpeak() {
    const text = textArea.value.trim();
    if (!text) {
        setStatus("Enter text first.");
        return;
    }
    const rate = Number(rateSlider.value);
    speakAuto(text, rate);
    setStatus(`Speaking at ${rate.toFixed(2)}x with auto en/zh detection…`);
}

function handleClear() {
    textArea.value = "";
    textArea.focus();
    setStatus("Cleared. Enter new text.");
}

function init() {
    if (!("speechSynthesis" in window)) {
        btnSpeak.disabled = true;
        setStatus("Speech synthesis is not supported in this browser.");
        return;
    }

    updateRateUI();

    btnSpeak.addEventListener("click", handleSpeak);
    btnClear.addEventListener("click", handleClear);
    rateSlider.addEventListener("input", updateRateUI);

    textArea.addEventListener("keydown", (evt) => {
        if ((evt.ctrlKey || evt.metaKey) && evt.key === "Enter") {
            evt.preventDefault();
            handleSpeak();
        }
    });
}

init();
