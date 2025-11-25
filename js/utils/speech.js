const DEFAULT_OPTIONS = {
    lang: "en-US",
    rate: 0.95,
    queue: false
};

export function speak(text, options = {}) {
    if (!("speechSynthesis" in window) || !text) return;

    const { lang, rate, queue } = { ...DEFAULT_OPTIONS, ...options };

    if (!queue) {
        speechSynthesis.cancel();
    }

    const utterance = new SpeechSynthesisUtterance(text);

    utterance.lang = lang;
    utterance.rate = rate;

    speechSynthesis.speak(utterance);
}
