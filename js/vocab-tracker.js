const STORAGE_PREFIX = "rvoca_vocab_tracker";

function safeLoad(key) {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return { items: {} };
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return { items: {} };
        return { items: parsed.items ?? {} };
    } catch (error) {
        console.warn("Failed to load tracker state", error);
        return { items: {} };
    }
}

function safeSave(key, state) {
    try {
        localStorage.setItem(key, JSON.stringify(state));
    } catch (error) {
        console.warn("Failed to persist tracker state", error);
    }
}

function getKey(item) {
    if (!item) return null;
    if (item.id != null) return String(item.id);
    const word = item.word || item.en || "";
    if (!word) return null;
    const unit = item.unit || item.level || "";
    return unit ? `${unit}::${word}` : word;
}

function normalizeItem(item) {
    const key = getKey(item);
    if (!key) return null;
    return {
        key,
        id: item.id ?? null,
        word: item.word || item.en || "",
        zh: item.zh || "",
        unit: item.unit || item.level || ""
    };
}

export function createTracker({ mode = "default", onChange = null } = {}) {
    const storageKey = `${STORAGE_PREFIX}:${mode}`;
    let state = safeLoad(storageKey);

    const notify = () => {
        safeSave(storageKey, state);
        onChange?.();
    };

    const upsertBatch = (items = []) => {
        let changed = false;
        items.forEach((item) => {
            const normalized = normalizeItem(item);
            if (!normalized) return;
            const existing = state.items[normalized.key];
            if (!existing) {
                state.items[normalized.key] = {
                    ...normalized,
                    status: "active",
                    flagged: false,
                    updatedAt: Date.now()
                };
                changed = true;
                return;
            }
            if (!existing.zh && normalized.zh) {
                existing.zh = normalized.zh;
                changed = true;
            }
            if (existing.status !== "deleted" && normalized.unit && !existing.unit) {
                existing.unit = normalized.unit;
                changed = true;
            }
        });
        if (changed) notify();
    };

    const ensureEntry = (itemOrKey) => {
        const key = typeof itemOrKey === "string" ? itemOrKey : getKey(itemOrKey);
        if (!key) return null;
        let entry = state.items[key];
        if (!entry && typeof itemOrKey === "object" && itemOrKey) {
            const normalized = normalizeItem(itemOrKey);
            if (normalized) {
                entry = {
                    ...normalized,
                    status: "active",
                    flagged: false,
                    updatedAt: Date.now()
                };
                state.items[key] = entry;
                notify();
            }
        }
        return entry;
    };

    const markDeleted = (item) => {
        const entry = ensureEntry(item);
        if (!entry) return;
        entry.status = "deleted";
        entry.updatedAt = Date.now();
        notify();
    };

    const toggleFlagByKey = (key) => {
        const entry = ensureEntry(key);
        if (!entry) return false;
        entry.flagged = !entry.flagged;
        entry.updatedAt = Date.now();
        notify();
        return entry.flagged;
    };

    const toggleFlag = (item) => toggleFlagByKey(getKey(item));

    const isFlagged = (item) => {
        const entry = ensureEntry(item);
        return Boolean(entry?.flagged);
    };

    const sortEntries = (a, b) => {
        if (a.flagged !== b.flagged) return a.flagged ? -1 : 1;
        return (a.word || "").localeCompare(b.word || "");
    };

    const getLists = () => {
        const entries = Object.values(state.items || {});
        const studying = entries.filter((item) => item.status !== "deleted").sort(sortEntries);
        const done = entries.filter((item) => item.status === "deleted").sort(sortEntries);
        return { studying, done };
    };

    return {
        upsertBatch,
        markDeleted,
        toggleFlag,
        toggleFlagByKey,
        isFlagged,
        getLists
    };
}
