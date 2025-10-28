import { fetchListeningNotes, addListeningNote, deleteListeningNote } from "./api.js";

export const NOTE_TYPES = Object.freeze({
    WORD: "word",
    PHRASE: "phrase"
});

const VALID_NOTE_TYPES = new Set(Object.values(NOTE_TYPES));

function normalizeType(type) {
    return VALID_NOTE_TYPES.has(type) ? type : NOTE_TYPES.WORD;
}

function normalizeTimestamp(value) {
    if (!value) return new Date().toISOString();
    try {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) throw new Error("Invalid timestamp");
        return date.toISOString();
    } catch {
        return new Date().toISOString();
    }
}

function normalizeNote(raw = {}) {
    const en = String(raw.en ?? raw.word ?? "").trim();
    const zh = String(raw.zh ?? raw.translation ?? "").trim();
    const idSource = raw.id ?? raw.noteId ?? raw.uuid ?? `${en}-${raw.createdAt ?? Date.now()}`;
    return {
        id: String(idSource),
        type: normalizeType(raw.type),
        en,
        zh,
        createdAt: normalizeTimestamp(raw.createdAt ?? raw.updatedAt ?? raw.timestamp)
    };
}

function sortNotes(notes) {
    return [...notes].sort((a, b) => {
        const timeA = Date.parse(a?.createdAt || 0);
        const timeB = Date.parse(b?.createdAt || 0);
        return timeB - timeA;
    });
}

export async function listNotes({ filter = null } = {}) {
    let response;
    try {
        response = await fetchListeningNotes({ filter });
    } catch (error) {
        console.error("Failed to fetch notes", error);
        throw new Error("Failed to load notes");
    }

    if (!response?.ok) {
        const message = response?.error || "Failed to load notes";
        const error = new Error(message);
        error.response = response;
        throw error;
    }

    const payload = Array.isArray(response?.notes)
        ? response.notes
        : Array.isArray(response?.items)
            ? response.items
            : [];

    return sortNotes(payload.map(normalizeNote));
}

export async function createNote({ type = NOTE_TYPES.WORD, en = "", zh = "" }) {
    const english = String(en ?? "").trim();
    const translation = String(zh ?? "").trim();
    const normalizedType = normalizeType(type);

    if (!english) throw new Error("Note requires English text");

    let response;
    try {
        response = await addListeningNote({ type: normalizedType, en: english, zh: translation });
    } catch (error) {
        console.error("Failed to create note", error);
        throw new Error("Failed to add note");
    }

    if (!response?.ok) {
        const message = response?.error || "Failed to add note";
        const error = new Error(message);
        error.response = response;
        throw error;
    }

    const payload = response?.note ?? response;
    return normalizeNote({
        ...payload,
        type: payload?.type ?? normalizedType,
        en: payload?.en ?? english,
        zh: payload?.zh ?? translation
    });
}

export async function removeNote(id) {
    if (!id) throw new Error("Note id is required");

    let response;
    try {
        response = await deleteListeningNote(id);
    } catch (error) {
        console.error("Failed to delete note", error);
        throw new Error("Failed to delete note");
    }

    if (!response?.ok) {
        const message = response?.error || "Failed to delete note";
        const error = new Error(message);
        error.response = response;
        throw error;
    }

    return true;
}
