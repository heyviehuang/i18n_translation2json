export function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (match) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;"
    })[match]);
}
