(() => {
    const tg = window.Telegram?.WebApp;

    if (tg) {
        tg.ready();
        tg.expand();

        
        document.documentElement.style.setProperty(
            "--tg-bg",
            tg.backgroundColor || "#090727"
        );
    }

    const connectBtn = document.getElementById("connectBtn");
    if (connectBtn) {
        connectBtn.addEventListener("click", () => {
            
            
            connectBtn.classList.toggle("connected");
            connectBtn.innerHTML = connectBtn.classList.contains("connected")
                ? '<span class="wallet-icon">✓</span> Подключён'
                : '<span class="wallet-icon">▣</span> Подключить';
        });
    }
})();

window.TelegramProfile = {
    init() {
        const tg = window.Telegram?.WebApp;
        const user = tg?.initDataUnsafe?.user;

        const name = document.getElementById("profileName");
        const status = document.getElementById("profileStatus");
        const avatar = document.getElementById("profileAvatar");
        const fallback = document.getElementById("avatarFallback");

        if (!name) return;

        if (!user) {
            name.textContent = "Гость";
            status.textContent = "Откройте Mini App через Telegram";
            return;
        }

        const fullName = [user.first_name, user.last_name]
            .filter(Boolean)
            .join(" ");

        name.textContent = user.username
            ? `@${user.username}`
            : (fullName || `ID ${user.id}`);

        status.textContent = "Кошелёк не подключён";

        if (user.photo_url) {
            avatar.src = user.photo_url;
            avatar.hidden = false;
            fallback.hidden = true;
        }
    }
};
