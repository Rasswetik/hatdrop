"""Telegram NFT relayer: a Telethon user-account wrapper (ported from GemDrop).

The module is deliberately free of Flask/app state: every coroutine receives the
credentials and the saved StringSession and returns plain data plus the (possibly
refreshed) session string, so app.py decides where and how it is stored.
"""
import asyncio
import inspect
import io
import re


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


async def phone_start(api_id, api_hash, session, phone):
    client = _client(api_id, api_hash, session)
    try:
        await client.connect()
        if await client.is_user_authorized():
            return {"status": "authorized", "account": account_dict(await client.get_me())}, await _finish(client)
        sent = await client.send_code_request(phone)
        return {"status": "code_sent", "phone_code_hash": str(getattr(sent, "phone_code_hash", "") or "")}, await _finish(client)
    except BaseException:
        await _finish(client)
        raise


async def code_submit(api_id, api_hash, session, phone, code, phone_code_hash):
    _, _, _, NeedPassword, CodeInvalid, CodeExpired = _imports()
    client = _client(api_id, api_hash, session)
    try:
        await client.connect()
        try:
            await client.sign_in(phone=phone, code=code, phone_code_hash=phone_code_hash)
        except NeedPassword:
            return {"status": "need_password"}, await _finish(client)
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
    return {
        "key": "tg:" + str(key),
        "sender_id": sender,
        "slug": slug,
        "title": title or "Telegram NFT",
        "number": number,
        "model": _attribute(gift, "model"),
        "backdrop": _attribute(gift, "backdrop"),
    }


async def fetch_gifts(api_id, api_hash, session):
    client = _client(api_id, api_hash, session)
    try:
        await client.connect()
        if not await client.is_user_authorized():
            return {"status": "login_required"}, await _finish(client)
        me = account_dict(await client.get_me())
        gifts = [entry_info(e) for e in await _saved_gifts(client)]
        return {"status": "online", "account": me, "gifts": gifts}, await _finish(client)
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
