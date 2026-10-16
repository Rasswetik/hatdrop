"""Telegram NFT relayer: a Telethon user-account wrapper (ported from GemDrop).

The module is deliberately free of Flask/app state: every coroutine receives the
credentials and the saved StringSession and returns plain data plus the (possibly
refreshed) session string, so app.py decides where and how it is stored.
"""
import asyncio
import inspect
import io
import re
import time


class RelayerError(RuntimeError):
    pass


def _imports():
    try:
        from telethon import TelegramClient, functions
        from telethon.errors import PhoneCodeExpiredError, PhoneCodeInvalidError, SessionPasswordNeededError
        from telethon.sessions import StringSession
    except Exception as exc:  # pragma: no cover - depends on the installed package
        raise RelayerError('Для релейера установите Telethon: pip install "telethon>=1.45,<2"') from exc
    return TelegramClient, functions, StringSession, SessionPasswordNeededError, PhoneCodeInvalidError, PhoneCodeExpiredError


def available():
    try:
        _imports()
        return True
    except RelayerError:
        return False


def run(coro):
    return asyncio.run(coro)


def _client(api_id, api_hash, session):
    TelegramClient, _, StringSession, *_ = _imports()
    try:
        api_id = int(api_id)
    except (TypeError, ValueError):
        raise RelayerError("API ID должен быть числом.")
    if not api_hash:
        raise RelayerError("Укажите API ID и API hash Telegram.")
    return TelegramClient(StringSession(session or ""), api_id, api_hash,
                          device_model="HatDrop Relayer", system_version="HatDrop", auto_reconnect=True)


def account_dict(me):
    return {
        "id": int(getattr(me, "id", 0) or 0),
        "name": " ".join(x for x in (getattr(me, "first_name", ""), getattr(me, "last_name", "")) if x).strip(),
        "username": str(getattr(me, "username", "") or ""),
        "phone": str(getattr(me, "phone", "") or ""),
    }


async def _finish(client):
    session = ""
    try:
        session = client.session.save() or ""
    except Exception:
        pass
    try:
        await client.disconnect()
    except Exception:
        pass
    return session


DELIVERY = {
    "SentCodeTypeApp": "app", "SentCodeTypeSms": "sms", "SentCodeTypeCall": "call", "SentCodeTypeFlashCall": "call",
    "SentCodeTypeMissedCall": "call", "SentCodeTypeFragmentSms": "fragment", "SentCodeTypeEmailCode": "email",
    "SentCodeTypeFirebaseSms": "sms", "SentCodeTypeSmsWord": "sms", "SentCodeTypeSmsPhrase": "sms",
}


def _delivery(sent):
    kind = DELIVERY.get(type(getattr(sent, "type", None)).__name__, "unknown")
    nxt = DELIVERY.get(type(getattr(sent, "next_type", None)).__name__, "") if getattr(sent, "next_type", None) else ""
    return {"phone_code_hash": str(getattr(sent, "phone_code_hash", "") or ""), "delivery": kind, "next": nxt}


def explain(exc):
    """Понятное описание ошибки Telethon/RPC для админки (секретов в тексте нет)."""
    name = type(exc).__name__
    table = {
        "ApiIdInvalidError": "Неверная пара API ID / API hash. Возьмите их на my.telegram.org → API development tools.",
        "PhoneNumberInvalidError": "Неверный номер телефона. Формат: +79990000000.",
        "PhoneNumberBannedError": "Этот номер заблокирован в Telegram.",
        "PhoneNumberFloodError": "Слишком много попыток для этого номера. Подождите несколько часов.",
        "PhoneNumberUnoccupiedError": "Этот номер не зарегистрирован в Telegram.",
        "SendCodeUnavailableError": "Все способы отправки кода исчерпаны. Подождите и запросите код позже.",
        "PasswordHashInvalidError": "Неверный пароль двухфакторной защиты (2FA).",
        "PhoneCodeInvalidError": "Неверный код Telegram.",
        "PhoneCodeExpiredError": "Код Telegram истёк. Запросите новый.",
        "PhoneCodeEmptyError": "Введите код из Telegram.",
        "AuthKeyUnregisteredError": "Сессия аккаунта недействительна. Войдите заново.",
        "SessionRevokedError": "Сессия отозвана в настройках Telegram. Войдите заново.",
        "UserDeactivatedBanError": "Аккаунт заблокирован Telegram.",
    }
    if name in table:
        return table[name]
    seconds = getattr(exc, "seconds", None)
    if name.startswith("FloodWait") or name == "FloodWaitError":
        wait = int(seconds or 0)
        return f"Telegram просит подождать {wait // 60 + 1} мин. перед следующей попыткой (FloodWait)."
    if isinstance(exc, (ConnectionError, TimeoutError, OSError)):
        return "Сервер не может подключиться к Telegram (сеть). Повторите позже."
    return ("Telegram: " + str(exc)).strip()[:240]


async def phone_start(api_id, api_hash, session, phone):
    client = _client(api_id, api_hash, session)  # session может быть пустой: тогда вход начинается с нуля
    try:
        await client.connect()
        if await client.is_user_authorized():
            return {"status": "authorized", "account": account_dict(await client.get_me())}, await _finish(client)
        sent = await client.send_code_request(phone)
        return {"status": "code_sent", **_delivery(sent)}, await _finish(client)
    except BaseException:
        await _finish(client)
        raise


async def qr_login_flow(api_id, api_hash, on_url, total=150):
    """Вход по QR: on_url(url) вызывается при каждом новом токене и возвращает False, если попытку заменили."""
    _, _, _, NeedPassword, *_ = _imports()
    client = _client(api_id, api_hash, "")
    try:
        await client.connect()
        qr = await client.qr_login()
        deadline = time.time() + total
        while True:
            if not on_url(str(qr.url)):
                return {"status": "cancelled"}, ""
            try:
                await qr.wait(timeout=25)
                break
            except NeedPassword:
                return {"status": "need_password"}, await _finish(client)
            except (asyncio.TimeoutError, TimeoutError):
                if time.time() > deadline:
                    return {"status": "expired"}, await _finish(client)
                await qr.recreate()
        return {"status": "authorized", "account": account_dict(await client.get_me())}, await _finish(client)
    except BaseException:
        await _finish(client)
        raise


async def session_check(api_id, api_hash, session):
    """Проверить готовую StringSession (созданную локально) и получить аккаунт."""
    client = _client(api_id, api_hash, session)
    try:
        await client.connect()
        if not await client.is_user_authorized():
            raise RelayerError("Эта сессия не авторизована или отозвана. Создайте новую.")
        return {"status": "authorized", "account": account_dict(await client.get_me())}, await _finish(client)
    except BaseException:
        await _finish(client)
        raise


async def resend_code(api_id, api_hash, session, phone, phone_code_hash):
    """Повторная отправка кода другим способом (Telegram → SMS → звонок)."""
    _, functions, *_ = _imports()
    client = _client(api_id, api_hash, session)
    try:
        await client.connect()
        sent = await client(functions.auth.ResendCodeRequest(phone_number=phone, phone_code_hash=phone_code_hash))
        return {"status": "code_sent", **_delivery(sent)}, await _finish(client)
    except BaseException:
        await _finish(client)
        raise


async def code_submit(api_id, api_hash, session, phone, code, phone_code_hash, password=None):
    _, _, _, NeedPassword, CodeInvalid, CodeExpired = _imports()
    client = _client(api_id, api_hash, session)
    try:
        await client.connect()
        try:
            await client.sign_in(phone=phone, code=code, phone_code_hash=phone_code_hash)
        except NeedPassword:
            if not password:
                return {"status": "need_password"}, await _finish(client)
            await client.sign_in(password=password)
        except CodeInvalid:
            raise RelayerError("Неверный код Telegram.")
        except CodeExpired:
            raise RelayerError("Код Telegram истёк. Запросите новый.")
        return {"status": "authorized", "account": account_dict(await client.get_me())}, await _finish(client)
    except BaseException:
        await _finish(client)
        raise


async def password_submit(api_id, api_hash, session, password):
    client = _client(api_id, api_hash, session)
    try:
        await client.connect()
        await client.sign_in(password=password)
        return {"status": "authorized", "account": account_dict(await client.get_me())}, await _finish(client)
    except BaseException:
        await _finish(client)
        raise


async def logout(api_id, api_hash, session):
    client = _client(api_id, api_hash, session)
    try:
        await client.connect()
        if await client.is_user_authorized():
            await client.log_out()
    finally:
        await _finish(client)


async def _saved_gifts(client):
    _, functions, *_ = _imports()
    payments = getattr(functions, "payments", None)
    cls = getattr(payments, "GetSavedStarGiftsRequest", None) if payments else None
    if cls is None and payments:
        cls = getattr(payments, "GetSavedGiftsRequest", None)
    if cls is None:
        raise RelayerError("В установленной версии Telethon нет API Saved Star Gifts. Обновите Telethon.")
    peer = await client.get_input_entity("me")
    values = {"peer": peer, "offset": "", "limit": 100}
    kwargs = {}
    for name, param in inspect.signature(cls.__init__).parameters.items():
        if name == "self":
            continue
        if name in values:
            kwargs[name] = values[name]
        elif param.default is inspect._empty:
            kwargs[name] = False
    result = await client(cls(**kwargs))
    return list(getattr(result, "gifts", None) or getattr(result, "saved_gifts", None) or [])


def _peer_id(peer):
    if peer is None:
        return 0
    if isinstance(peer, int):
        return int(peer)
    for name in ("user_id", "id"):
        try:
            value = int(getattr(peer, name, 0) or 0)
            if value:
                return value
        except (TypeError, ValueError):
            pass
    return 0


def _attribute(gift, kind):
    for attr in getattr(gift, "attributes", None) or []:
        if kind in type(attr).__name__.lower():
            return str(getattr(attr, "name", "") or "")
    return ""


def entry_info(entry):
    gift = getattr(entry, "gift", None) or entry
    slug = str(getattr(gift, "slug", "") or getattr(entry, "slug", "") or "").strip()
    title = str(getattr(gift, "title", "") or getattr(gift, "name", "") or getattr(entry, "title", "") or "").strip()
    number = str(getattr(gift, "num", "") or getattr(gift, "number", "") or getattr(entry, "num", "") or "").strip()
    match = re.match(r"^(.+?)-(\d+)$", slug) if slug else None
    if match:
        number = number or match.group(2)
        if not title or title.casefold() == "telegram nft":
            title = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", match.group(1)).replace("_", " ").strip()
    saved_id = str(getattr(entry, "saved_id", "") or getattr(entry, "msg_id", "") or getattr(entry, "id", "") or "")
    sender = _peer_id(getattr(entry, "from_id", None) or getattr(entry, "sender_id", None))
    key = saved_id or slug or f"{getattr(gift, 'id', '')}:{sender}:{getattr(entry, 'date', '')}"
    try:
        transfer_stars = max(0, int(getattr(entry, "transfer_stars", 0) or getattr(gift, "transfer_stars", 0) or 0))
    except (TypeError, ValueError):
        transfer_stars = 0
    can_at = getattr(entry, "can_transfer_at", None) or getattr(gift, "can_transfer_at", None)
    if hasattr(can_at, "timestamp"):
        try:
            can_at = int(can_at.timestamp())
        except Exception:
            can_at = 0
    try:
        can_at = max(0, int(can_at or 0))
    except (TypeError, ValueError):
        can_at = 0
    return {
        "key": "tg:" + str(key),
        "transfer_stars": transfer_stars,
        "can_transfer_at": can_at,
        "sender_id": sender,
        "slug": slug,
        "title": title or "Telegram NFT",
        "number": number,
        "model": _attribute(gift, "model"),
        "backdrop": _attribute(gift, "backdrop"),
    }


def _stars_value(value):
    for name in ("amount", "stars", "value"):
        if hasattr(value, name):
            return _stars_value(getattr(value, name))
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


async def _stars_balance(client):
    _, functions, *_ = _imports()
    payments = getattr(functions, "payments", None)
    cls = getattr(payments, "GetStarsStatusRequest", None) if payments else None
    if cls is None:
        return 0
    peer = await client.get_input_entity("me")
    kwargs = {}
    for name, param in inspect.signature(cls.__init__).parameters.items():
        if name == "self":
            continue
        if name == "peer":
            kwargs[name] = peer
        elif param.default is inspect._empty:
            kwargs[name] = False
    return _stars_value(getattr(await client(cls(**kwargs)), "balance", 0))


async def fetch_gifts(api_id, api_hash, session):
    client = _client(api_id, api_hash, session)
    try:
        await client.connect()
        if not await client.is_user_authorized():
            return {"status": "login_required"}, await _finish(client)
        me = account_dict(await client.get_me())
        gifts = [entry_info(e) for e in await _saved_gifts(client)]
        try:
            stars = await _stars_balance(client)
        except Exception:
            stars = None
        return {"status": "online", "account": me, "gifts": gifts, "stars_balance": stars}, await _finish(client)
    except BaseException:
        await _finish(client)
        raise


def crop_png(data, pad=0.04, size=512):
    """Telegram/Fragment gift art -> transparent PNG cropped to the picture and normalised."""
    from PIL import Image
    img = Image.open(io.BytesIO(data)).convert("RGBA")
    box = img.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox()
    if box:
        w, h = box[2] - box[0], box[3] - box[1]
        p = int(max(w, h) * pad)
        img = img.crop((max(0, box[0] - p), max(0, box[1] - p), min(img.width, box[2] + p), min(img.height, box[3] + p)))
    side = max(img.size)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(img, ((side - img.width) // 2, (side - img.height) // 2))
    if side > size:
        canvas = canvas.resize((size, size), Image.LANCZOS)
    out = io.BytesIO()
    canvas.save(out, "PNG", optimize=True)
    return out.getvalue()


def _model_key(value):
    """Название модели без редкости в скобках: «Cozy (1.5%)» == «Cozy»."""
    text = re.sub(r"\s*\([^)]*\)\s*$", "", str(value or ""))
    return re.sub(r"[^a-z0-9]+", "", text.casefold())


def match_job(items, job):
    """items: [(entry, info)]; job: {slug, collection, model}.

    Точный slug — только он. Иначе коллекция + модель: если модель задана, нужен подарок именно этой модели
    (другую не отдаём); если модели нет (случайный подарок) — подойдёт любой подарок коллекции, сначала тот,
    что можно передать сразу и дешевле. Нет подходящего — (None, None)."""
    def norm(v):
        return re.sub(r"[^a-z0-9]+", "", str(v or "").casefold())
    now = time.time()
    found = []
    for entry, info in items:
        slug = info.get("slug") or ""
        if not slug:
            continue
        if job.get("slug"):
            if slug.casefold() == job["slug"].casefold():
                return entry, info
            continue
        base = norm(re.sub(r"-\d+$", "", slug))
        want = norm(job.get("collection"))
        if want and want not in (norm(info.get("title")), base):
            continue
        if job.get("model") and _model_key(info.get("model")) != _model_key(job["model"]):
            continue
        locked = 1 if int(info.get("can_transfer_at") or 0) > now else 0
        found.append((locked, int(info.get("transfer_stars") or 0), len(found), entry, info))
    if not found:
        return None, None
    best = min(found, key=lambda x: x[:3])
    return best[3], best[4]


async def _transfer(client, entry_info_, target):
    from telethon import types
    _, functions, *_ = _imports()
    can_at = int(entry_info_.get("can_transfer_at") or 0)
    if can_at and can_at > time.time():
        raise RelayerError(f"NFT пока нельзя передать: Telegram transfer lock ещё {int(can_at - time.time())} сек.")
    saved_cls = getattr(types, "InputSavedStarGiftSlug", None)
    if saved_cls is None:
        raise RelayerError("Текущая версия Telethon не поддерживает InputSavedStarGiftSlug.")
    try:
        peer = await client.get_input_entity("@" + target["username"] if target.get("username") else int(target["tg_id"]))
    except Exception as exc:
        raise RelayerError("Не удалось определить Telegram-получателя.") from exc
    stargift = saved_cls(slug=entry_info_["slug"])
    price = int(entry_info_.get("transfer_stars") or 0)
    if price:
        if await _stars_balance(client) < price:
            raise RelayerError("Недостаточно Stars на релейере.")
        invoice = types.InputInvoiceStarGiftTransfer(stargift=stargift, to_id=peer)
        form = await client(functions.payments.GetPaymentFormRequest(invoice=invoice))
        await client(functions.payments.SendStarsFormRequest(form_id=form.form_id, invoice=invoice))
    else:
        await client(functions.payments.TransferStarGiftRequest(stargift=stargift, to_id=peer))
    return price


def classify_error(message):
    low = message.casefold()
    if "stars" in low:
        return "insufficient_stars"
    if "lock" in low or "пока нельзя" in low:
        return "blocked"
    if "получател" in low:
        return "recipient_unavailable"
    return "error"


async def transfer_jobs(api_id, api_hash, session, jobs):
    """Передаёт подарки с релейера получателям. jobs: [{id, tg_id, username, slug, collection, model}]."""
    client = _client(api_id, api_hash, session)
    results = []
    try:
        await client.connect()
        if not await client.is_user_authorized():
            raise RelayerError("Релейер не авторизован.")
        entries = await _saved_gifts(client)
        items = [(e, entry_info(e)) for e in entries]
        for job in jobs:
            entry, info = match_job(items, job)
            if not info:
                results.append({"id": job["id"], "status": "not_found", "error": "Подарок не найден на релейере."})
                continue
            try:
                paid = await _transfer(client, info, job)
            except Exception as exc:
                msg = str(exc)[:300]
                results.append({"id": job["id"], "status": classify_error(msg), "error": msg, "slug": info["slug"]})
                continue
            items = [(e, i) for e, i in items if i["slug"] != info["slug"]]
            results.append({"id": job["id"], "status": "completed", "slug": info["slug"], "transfer_stars": paid})
        return results, await _finish(client)
    except BaseException:
        await _finish(client)
        raise
