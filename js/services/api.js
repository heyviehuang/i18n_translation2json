import { API_BASE, TOKEN, ROUND_SIZE } from "../config.js";

export function jsonp(params) {
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

        script.src = `${API_BASE}?${query.toString()}`;
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
    return jsonp({ action: "nextBatch", count });
}

export function fetchListeningBatch({ count = ROUND_SIZE, series = null } = {}) {
    const params = { action: "nextListeningBatch", count };
    if (series) params.series = series;
    return jsonp(params);
}

export function fetchSentenceBatch({ count = ROUND_SIZE, level = null } = {}) {
    const params = { action: "nextSentenceBatch", count };
    if (level) params.level = level;
    return jsonp(params);
}

export function markKnown(id, adminKey) {
    return jsonp({ action: "markKnown", id, adminKey });
}
