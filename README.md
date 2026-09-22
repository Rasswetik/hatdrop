# Telegram Mini App — Flask

## Структура

- `app.py` — Flask-сервер
- `requirements.txt` — зависимости
- `templates/base.html` — общий каркас
- `templates/index.html` — страница «Апгрейд»
- `templates/profile.html` — страница «Профиль»
- `static/css/app.css` — стили
- `static/js/app.js` — Telegram WebApp + профиль
- `static/img/hat.png` — сюда положить изображение шляпы

## Запуск

```bash
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Linux/macOS:

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python app.py
```

После запуска: `http://127.0.0.1:5000/`

## Telegram профиль

При открытии Mini App внутри Telegram скрипт берет пользователя из:

`Telegram.WebApp.initDataUnsafe.user`

Используются:
- `first_name`
- `last_name`
- `username`
- `photo_url`

Для реального production-приложения `initData` нужно дополнительно валидировать на сервере по токену бота перед тем, как доверять данным пользователя.

## Изображение шляпы

Помести файл:

`static/img/hat.png`

После этого он автоматически появится в центре круга на странице апгрейда.
