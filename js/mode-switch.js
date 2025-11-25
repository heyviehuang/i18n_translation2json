export function initModeSwitch() {
    const nav = document.querySelector(".mode-switch");
    if (!nav) return;

    const toggle = nav.querySelector(".mode-switch__toggle");
    const menu = nav.querySelector(".mode-switch__menu");
    if (!toggle || !menu) return;

    const links = Array.from(menu.querySelectorAll("a"));

    const closeMenu = () => {
        nav.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
        menu.setAttribute("aria-hidden", "true");
    };

    const openMenu = () => {
        nav.classList.add("is-open");
        toggle.setAttribute("aria-expanded", "true");
        menu.setAttribute("aria-hidden", "false");
    };

    toggle.addEventListener("click", () => {
        if (nav.classList.contains("is-open")) {
            closeMenu();
        } else {
            openMenu();
            links[0]?.focus();
        }
    });

    toggle.addEventListener("keydown", (evt) => {
        if (evt.key === "ArrowDown") {
            evt.preventDefault();
            openMenu();
            links[0]?.focus();
        }
    });

    menu.addEventListener("keydown", (evt) => {
        if (evt.key === "Escape") {
            closeMenu();
            toggle.focus();
        }
    });

    document.addEventListener("click", (evt) => {
        if (!nav.contains(evt.target)) {
            closeMenu();
        }
    });
}
