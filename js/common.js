const API_BASE = "https://script.google.com/macros/s/AKfycbyOv4GDW2Ns8pYfUDm1bKEPoTbYxPTS3VC8HdwLTLF8KyOpDEgqhS-XgIZ_ppDJGKo/exec";
const TOKEN = "rvo-2025-chiuchiou";

const ROUND_SIZE = 15;

export function jsonpListen(params) {
    return new Promise((resolve, reject) => {
        const cb = "cb_" + Math.random().toString(36).slice(2);
        const qs = new URLSearchParams({ token: TOKEN, callback: cb, ...params });
        const s = document.createElement("script");
        s.src = API_BASE_LISTEN + "?" + qs.toString();
        s.onerror = () => reject(new Error("JSONP error"));
        window[cb] = (data) => { resolve(data); s.remove(); delete window[cb]; };
        document.body.appendChild(s);
        setTimeout(() => reject(new Error("timeout")), 15000);
    });
}

export function speak(t) {
    if (!("speechSynthesis" in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(t);
    u.lang = "en-US"; u.rate = 0.95;
    speechSynthesis.speak(u);
}
