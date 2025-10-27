import { ROUND_SIZE as CONFIG_DEFAULT_ROUND_SIZE } from "../config.js";

const STORAGE_PREFIX = "rvoca.roundSize";
export const ROUND_SIZE_LIMITS = { MIN: 5, MAX: 50 };
export const DEFAULT_ROUND_SIZE = CONFIG_DEFAULT_ROUND_SIZE;

function buildKey(mode = "default") {
    const suffix = typeof mode === "string" && mode.trim() ? mode.trim() : "default";
    return `${STORAGE_PREFIX}.${suffix}`;
}

function clamp(value) {
    return Math.max(ROUND_SIZE_LIMITS.MIN, Math.min(ROUND_SIZE_LIMITS.MAX, value));
}

function normalize(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
        return clamp(Math.trunc(value));
    }
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) return null;
        const parsed = Number.parseInt(trimmed, 10);
        if (Number.isFinite(parsed)) {
            return clamp(parsed);
        }
    }
    return null;
}

function getStorage() {
    try {
        if (typeof window !== "undefined" && window.localStorage) {
            return window.localStorage;
        }
    } catch (error) {
        console.warn("LocalStorage unavailable", error);
    }
    return null;
}

export function getRoundSize(mode = "default") {
    const storage = getStorage();
    if (!storage) return DEFAULT_ROUND_SIZE;
    const raw = storage.getItem(buildKey(mode));
    const normalized = normalize(raw);
    return normalized ?? DEFAULT_ROUND_SIZE;
}

export function setRoundSize(mode, value) {
    const normalized = normalize(value);
    if (normalized == null) return null;
    const storage = getStorage();
    storage?.setItem(buildKey(mode), String(normalized));
    return normalized;
}

export function resetRoundSize(mode = "default") {
    const storage = getStorage();
    storage?.removeItem(buildKey(mode));
    return DEFAULT_ROUND_SIZE;
}
