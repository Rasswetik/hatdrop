"""Локальный вход в аккаунт релейера: создаёт строку сессии для админки HatDrop.

Запускайте на своём компьютере (не на сервере):
    pip install "telethon>=1.45,<2"
    python tools/relayer_login.py
Введите API ID, API hash (my.telegram.org), номер телефона, код из Telegram и пароль 2FA (если есть).
Полученную строку вставьте в админке: «NFT-релейер» → «Вход по готовой сессии».
Строка равна полному доступу к аккаунту — никому её не передавайте.
"""
from telethon.sync import TelegramClient
from telethon.sessions import StringSession

api_id = int(input("API ID: ").strip())
api_hash = input("API hash: ").strip()
with TelegramClient(StringSession(), api_id, api_hash, device_model="HatDrop Relayer", system_version="HatDrop") as client:
    print("\nСтрока сессии:\n")
    print(client.session.save())
