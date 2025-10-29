const REVEAL_PHASE = {
    HIDDEN: 0,
    ENGLISH: 1,
    TRANSLATION: 2
};

export function createRoundSession({
    fetchBatch,
    render,
    speakItem = null,
    onRoundWillStart = null,
    enablePrefetch = false
}) {
    const state = {
        batch: [],
        index: -1,
        revealed: false,
        remaining: 0,
        revealPhase: REVEAL_PHASE.HIDDEN
    };

    let lastFetchArgs = [];
    let loading = false;
    let prefetchedPromise = null;
    let prefetchedKey = null;

    const clearPrefetch = () => {
        prefetchedPromise = null;
        prefetchedKey = null;
    };

    const setRevealPhase = (phase) => {
        state.revealPhase = phase;
        state.revealed = phase >= REVEAL_PHASE.TRANSLATION;
    };

    const serializeArgs = (args) => JSON.stringify(args ?? []);

    const getNextBatch = async (...args) => {
        const key = serializeArgs(args);
        if (prefetchedPromise) {
            if (prefetchedKey === key) {
                const data = await prefetchedPromise;
                clearPrefetch();
                return data;
            }
            // discard stale prefetch from other args
            clearPrefetch();
        }
        return fetchBatch(...args);
    };

    const schedulePrefetch = (...args) => {
        if (!enablePrefetch) return;
        const key = serializeArgs(args);
        if (prefetchedPromise && prefetchedKey === key) return;
        prefetchedPromise = fetchBatch(...args)
            .catch((error) => {
                prefetchedPromise = null;
                prefetchedKey = null;
                console.error("Prefetch failed", error);
                throw error;
            });
        prefetchedKey = key;
    };

    async function startRound(...args) {
        lastFetchArgs = args;
        if (loading) return;

        loading = true;

        try {
            onRoundWillStart?.();
            const response = await getNextBatch(...args);
            state.batch = response?.items ?? [];
            state.remaining = typeof response?.remaining === "number" ? response.remaining : state.remaining;
            state.index = state.batch.length ? 0 : -1;
            setRevealPhase(REVEAL_PHASE.HIDDEN);
            render(state);
            if (state.batch.length && speakItem) speakItem(state.batch[state.index], state);
            schedulePrefetch(...args);
        } finally {
            loading = false;
        }
    }

    async function advance() {
        if (loading) return;

        if (!state.batch.length) {
            await startRound(...lastFetchArgs);
            return;
        }

        if (state.revealPhase === REVEAL_PHASE.HIDDEN) {
            setRevealPhase(REVEAL_PHASE.ENGLISH);
            render(state);
            if (speakItem) speakItem(state.batch[state.index], state);
            return;
        }

        if (state.revealPhase === REVEAL_PHASE.ENGLISH) {
            setRevealPhase(REVEAL_PHASE.TRANSLATION);
            render(state);
            return;
        }

        state.index += 1;

        if (state.index >= state.batch.length) {
            await startRound(...lastFetchArgs);
            return;
        }

        setRevealPhase(REVEAL_PHASE.HIDDEN);
        render(state);
        if (speakItem) speakItem(state.batch[state.index], state);
    }

    function reveal() {
        if (!state.batch.length) return;
        if (state.revealPhase === REVEAL_PHASE.TRANSLATION) return;

        if (state.revealPhase === REVEAL_PHASE.HIDDEN) {
            setRevealPhase(REVEAL_PHASE.ENGLISH);
            render(state);
            return;
        }

        if (state.revealPhase === REVEAL_PHASE.ENGLISH) {
            setRevealPhase(REVEAL_PHASE.TRANSLATION);
            render(state);
        }
    }

    function setRemaining(value, { reRender = false } = {}) {
        if (typeof value !== "number" || Number.isNaN(value)) return;
        state.remaining = value;
        if (reRender) render(state);
    }

    function getCurrentItem() {
        if (state.index < 0 || state.index >= state.batch.length) return null;
        return state.batch[state.index];
    }

    return {
        state,
        startRound,
        advance,
        reveal,
        getCurrentItem,
        setRemaining,
        invalidatePrefetch: clearPrefetch
    };
}
