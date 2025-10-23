import { VOCAB_API_BASE, LISTENING_API_BASE, UNIT_VOCAB_API_BASE, TOKEN, ROUND_SIZE } from "../config.js";

export function jsonp(params, { base = VOCAB_API_BASE } = {}) {
    return new Promise((resolve, reject) => {
        const callbackName = "cb_" + Math.random().toString(36).slice(2);
        const query = new URLSearchParams({ token: TOKEN, callback: callbackName, ...params });
        const script = document.createElement("script");
        let timeoutId = 0;

        const cleanup = () => {
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = 0;
            }
            if (script.parentNode) {
                script.parentNode.removeChild(script);
            }
            delete window[callbackName];
        };

        script.src = `${base}?${query.toString()}`;
        script.async = true;
        script.onerror = () => {
            cleanup();
            reject(new Error("JSONP error"));
        };

        window[callbackName] = (data) => {
            cleanup();
            resolve(data);
        };

        (document.body || document.head || document.documentElement).appendChild(script);
        timeoutId = window.setTimeout(() => {
            cleanup();
            reject(new Error("timeout"));
        }, 15000);
    });
}

export function fetchVocabBatch(count = ROUND_SIZE) {
    return jsonp({ action: "nextBatch", count }, { base: VOCAB_API_BASE });
}

export function fetchUnitVocabBatch({ count = ROUND_SIZE, unit = null } = {}) {
    const configuredUnitBase = typeof UNIT_VOCAB_API_BASE === "string" ? UNIT_VOCAB_API_BASE.trim() : "";
    const hasDedicatedUnitBase = configuredUnitBase && !configuredUnitBase.includes("REPLACE_WITH");
    const base = hasDedicatedUnitBase ? configuredUnitBase : VOCAB_API_BASE;
    if (!hasDedicatedUnitBase) {
        console.warn("UNIT_VOCAB_API_BASE is not configured; falling back to VOCAB_API_BASE");
    }
    const params = { action: "nextBatch", count };
    if (unit) params.unit = unit;
    return jsonp(params, { base });
}

export async function fetchListeningBatch({ count = ROUND_SIZE, series = null } = {}) {
    const params = { action: "nextbatch", count };
    if (series) params.series = series;
    const configuredListeningBase = typeof LISTENING_API_BASE === "string" ? LISTENING_API_BASE.trim() : "";
    const hasDedicatedListening = configuredListeningBase && !configuredListeningBase.includes("REPLACE_WITH");
    const base = hasDedicatedListening ? configuredListeningBase : VOCAB_API_BASE;
    if (!hasDedicatedListening) {
        console.warn("LISTENING_API_BASE is not configured; falling back to VOCAB_API_BASE");
    }
    const response = await jsonp(params, { base });
    const items = Array.isArray(response?.items) ? response.items : [];
    return {
        ...response,
        items: items.map((item) => ({
            ...item,
            word: item?.word ?? item?.en ?? "",
            zh: item?.zh ?? "",
            en: item?.en ?? item?.word ?? ""
        }))
    };
}

export function fetchSentenceBatch({ count = ROUND_SIZE, level = null } = {}) {
    const params = { action: "nextSentenceBatch", count };
    if (level) params.level = level;
    return jsonp(params, { base: VOCAB_API_BASE });
}

export function markKnown(id, adminKey) {
    return jsonp({ action: "markKnown", id, adminKey }, { base: VOCAB_API_BASE });
}

export function markUnitVocabKnown(id, adminKey, { unit = null } = {}) {
    const configuredUnitBase = typeof UNIT_VOCAB_API_BASE === "string" ? UNIT_VOCAB_API_BASE.trim() : "";
    const hasDedicatedUnitBase = configuredUnitBase && !configuredUnitBase.includes("REPLACE_WITH");
    const base = hasDedicatedUnitBase ? configuredUnitBase : VOCAB_API_BASE;
    if (!hasDedicatedUnitBase) {
        console.warn("UNIT_VOCAB_API_BASE is not configured; falling back to VOCAB_API_BASE for markKnown");
    }
    const params = { action: "markKnown", id, adminKey };
    if (unit) params.unit = unit;
    return jsonp(params, { base });
}

export function markListeningKnown(id, adminKey) {
    const configuredListeningBase = typeof LISTENING_API_BASE === "string" ? LISTENING_API_BASE.trim() : "";
    const hasDedicatedListening = configuredListeningBase && !configuredListeningBase.includes("REPLACE_WITH");
    const base = hasDedicatedListening ? configuredListeningBase : VOCAB_API_BASE;
    if (!hasDedicatedListening) {
        console.warn("LISTENING_API_BASE is not configured; falling back to VOCAB_API_BASE for markKnown");
    }
    return jsonp({ action: "markKnown", id, adminKey }, { base });
}
