export function createRoundSession({
    fetchBatch,
    render,
    speakItem = null,
    onRoundWillStart = null
}) {
    const state = {
        batch: [],
        index: -1,
        revealed: false,
        remaining: 0
    };

    let lastFetchArgs = [];
    let loading = false;

    async function startRound(...args) {
        lastFetchArgs = args;
        if (loading) return;

        loading = true;

        try {
            onRoundWillStart?.();
            const response = await fetchBatch(...args);
            state.batch = response?.items ?? [];
            state.remaining = typeof response?.remaining === "number" ? response.remaining : state.remaining;
            state.index = state.batch.length ? 0 : -1;
            state.revealed = false;
            render(state);
            if (state.batch.length && speakItem) speakItem(state.batch[state.index], state);
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

        if (!state.revealed) {
            state.revealed = true;
            render(state);
            return;
        }

        state.index += 1;
        state.revealed = false;

        if (state.index >= state.batch.length) {
            await startRound(...lastFetchArgs);
            return;
        }

        render(state);
        if (speakItem) speakItem(state.batch[state.index], state);
    }

    function reveal() {
        if (!state.batch.length || state.revealed) return;
        state.revealed = true;
        render(state);
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
        setRemaining
    };
}
