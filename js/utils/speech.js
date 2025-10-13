const DEFAULT_OPTIONS = {
    lang: "en-US",
    rate: 0.95
};

export function speak(text, options = {}) {
    if (!("speechSynthesis" in window) || !text) return;

    speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    const { lang, rate } = { ...DEFAULT_OPTIONS, ...options };

    utterance.lang = lang;
    utterance.rate = rate;

    speechSynthesis.speak(utterance);
}
