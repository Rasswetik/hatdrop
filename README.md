# Magic Upgrade

Flask backend + мини-апп Magic Upgrade + встроенный Telegram-бот (один процесс).

## Запуск

1. Открой `app.py`, найди рамку **«ВСТАВЬ ТОКЕН БОТА СЮДА»** и вставь токен из @BotFather
   в строку `BOT_TOKEN = os.environ.get('BOT_TOKEN') or ''` — между кавычками.
   (Либо задай переменную окружения `BOT_TOKEN` — на Render удобнее так.)
2. `pip install -r requirements.txt`
3. `python app.py`  (на Render start command: `gunicorn app:app`)

Бот стартует вместе с приложением: на `/start` отвечает приветствием и кнопкой
«🎩 Открыть апгрейд», которая открывает мини-апп.

Адрес мини-аппа для кнопки на Render определяется сам (`RENDER_EXTERNAL_URL`).
На другом хостинге задай `WEBAPP_URL=https://твой-домен` (только https).

Не запускай gunicorn с `--preload` — бот стартует в воркере. Воркеров можно
несколько: опрашивать Telegram будет только один.

Переменные окружения (все необязательные): `BOT_TOKEN`, `WEBAPP_URL`, `BOT_USERNAME`,
`DB_PATH`, `DEPOSIT_ADDRESS`, `DEPOSIT_MEMO`.
