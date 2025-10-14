const DEFAULT_LINES = [
    "> SYSTEM BOOTING...",
    "> Loading vocab cartridges [########]",
    "> Initializing audio modules...",
    "> Syncing data with RVOCA cloud...",
    "> RVOCA READY."
];

function sleep(duration) {
    return new Promise((resolve) => setTimeout(resolve, duration));
}

export async function runBootSequence(options = {}) {
    const {
        lines = DEFAULT_LINES,
        baseDelay = 600,
        randomDelay = 400,
        finalPause = 400,
        onComplete = null
    } = options;

    const boot = document.getElementById("boot");
    const bootText = document.getElementById("bootText");
    if (!boot || !bootText) return;

    bootText.textContent = "";

    for (const line of lines) {
        bootText.textContent += `${line}\n`;
        const delay = baseDelay + Math.random() * randomDelay;
        await sleep(delay);
    }

    await sleep(finalPause);
    boot.style.opacity = "0";
    if (!boot.style.transition) {
        boot.style.transition = "opacity 1s ease";
    }

    setTimeout(() => {
        boot.remove();
        if (typeof onComplete === "function") onComplete();
    }, 1000);
}
