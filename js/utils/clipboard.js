export async function copyText(text) {
    if (!text) return false;

    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);

    textarea.focus();
    textarea.select();

    let success = false;
    try {
        success = document.execCommand("copy");
    } catch (_) {
        success = false;
    }

    textarea.remove();
    return success;
}
