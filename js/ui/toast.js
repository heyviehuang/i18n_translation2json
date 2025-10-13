export function showToast(message, { duration = 1200 } = {}) {
    if (!message) return;

    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;

    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("show"));

    setTimeout(() => {
        toast.classList.remove("show");
        toast.remove();
    }, duration);
}
