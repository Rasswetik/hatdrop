import io
import unittest
from unittest import mock

from test_admin_dashboard import backend, signed_user
import relayer


def gift(key, sender=202, slug="PlushPepe-7", title="Plush Pepe", model="Cozy"):
    return {"key": key, "sender_id": sender, "slug": slug, "title": title, "number": "7", "model": model, "backdrop": ""}


class RelayerTests(unittest.TestCase):
    def setUp(self):
        backend.db = {"users": {}, "prices": {}, "settings": {}, "withdrawals": {}, "promocodes": {}, "quests": {}}
        backend.app.config.update(TESTING=True, SESSION_COOKIE_SECURE=False)
        self.client = backend.app.test_client()
        self.client.post("/api/state", json={"initData": signed_user(202)})
        self.user = backend.db["users"]["tg202"]
        self.start = self.user["balance"]
        self.catalog = {"plushpepe": {"name": "Plush Pepe", "floor": 100.0, "models": [{"model": "Cozy", "floor": 200.0}]}}
        patcher = mock.patch.object(backend, "CATALOG", self.catalog)
        patcher.start()
        self.addCleanup(patcher.stop)

    def scan(self, gifts):
        return backend.relayer_apply_scan({"status": "online", "account": {"username": "relay"}, "gifts": gifts})

    def test_baseline_then_floor_credit_to_balance_and_bot_message(self):
        old = gift("tg:1")
        self.assertTrue(self.scan([old])["baseline"])
        self.assertEqual(self.user["balance"], self.start)  # gifts that existed before linking are not credited
        backend.db["emoji"] = {"ton": {"id": "5368324170671202286", "emoji": "💎"}, "gifts": {"plushpepe": {"id": "5424972470023104089", "emoji": "🐸"}}, "saved": {}}
        backend.db["settings"]["tonconnect"] = {"app_url": "https://app.example"}
        sent = []
        with mock.patch.object(backend, "_send_tg_async", lambda *a, **k: sent.append((a, k))):
            stats = self.scan([old, gift("tg:2", slug="PlushPepe-8")])
        self.assertEqual(stats["delivered"], 1)
        self.assertEqual(self.user["prizes"], [])  # nothing goes to the inventory
        view = backend.relayer_status_view()
        self.assertEqual((view["stats"]["total"], view["stats"]["today"]["count"], view["stats"]["senders"]), ({"count": 1, "ton": 85.0}, 1, 1))
        self.assertEqual(view["stats"]["top"][0]["id"], "202")
        self.assertEqual(view["stats"]["gifts_value_ton"], 100.0 * 2)  # two saved gifts on the account, floor 100 each
        self.assertEqual(view["refresh_seconds"], backend.RELAYER_SCAN_SECONDS)
        self.assertEqual(self.user["balance"], self.start + 85.0)  # collection floor 100 * 0.85, model ignored
        text, markup = sent[0][0][1], sent[0][0][2]
        self.assertIn('href="https://t.me/nft/PlushPepe-8"', text)
        self.assertIn("85 TON", text)
        self.assertIn('<tg-emoji emoji-id="5368324170671202286">', text)
        self.assertIn('<tg-emoji emoji-id="5424972470023104089">', text)
        self.assertTrue(sent[0][1]["html"])
        self.assertEqual(markup["inline_keyboard"][0][0]["text"], "Открыть приложение")

    def test_floor_used_and_duplicates_ignored(self):
        self.scan([])
        g = gift("tg:3", model="Mystery")
        self.assertEqual(self.scan([g])["delivered"], 1)
        self.assertEqual(self.user["balance"], self.start + 85.0)
        self.assertEqual(self.scan([g])["processed"], 0)
        self.assertEqual(self.user["balance"], self.start + 85.0)

    def test_admin_emojis(self):
        self.user["is_admin"] = True
        fake = lambda ids: {i: {"id": i, "emoji": "🐸", "set_name": "s"} for i in ids if i == "5424972470023104089"}
        admin = lambda p, **b: self.client.post(p, json={"initData": signed_user(202), **b})
        with mock.patch.object(backend, "fetch_custom_emoji_map", fake), mock.patch.object(backend, "require_admin", lambda u: None):
            self.assertEqual(admin("/api/admin/emojis/ton", emoji_id="5424972470023104089").status_code, 200)
            self.assertEqual(admin("/api/admin/emojis/ton", emoji_id="1234567").status_code, 404)
            self.assertEqual(admin("/api/admin/gift-emojis/save", gift_id="plushpepe", emoji_id="5424972470023104089").json["item"]["emoji"], "🐸")
            self.assertEqual(admin("/api/admin/gift-emojis/save", gift_id="nope", emoji_id="5424972470023104089").status_code, 404)
            items = admin("/api/admin/gift-emojis").json["items"]
            self.assertEqual(items[0]["emoji_id"], "5424972470023104089")
            self.assertIn("tg-emoji", admin("/api/admin/emojis").json["ton_preview"])
            admin("/api/admin/emojis/remove", id="5424972470023104089")
            self.assertEqual(backend.emoji_doc()["gifts"], {})

    def test_unknown_sender_plain_gift_and_missing_price(self):
        self.scan([])
        self.scan([gift("tg:4", sender=999), gift("tg:5", slug="")])
        self.assertEqual(self.user["balance"], self.start)
        statuses = {e["key"]: e["status"] for e in backend.relayer_doc()["events"].values()}
        self.assertEqual(statuses["tg:4"], "unknown_user")
        self.assertEqual(statuses["tg:5"], "skipped")
        # No Portals price yet -> retried on the next scan instead of being lost.
        self.catalog.clear()
        self.assertEqual(self.scan([gift("tg:6")])["delivered"], 0)
        self.catalog["plushpepe"] = {"name": "Plush Pepe", "floor": 10.0, "models": []}
        self.assertEqual(self.scan([gift("tg:6")])["delivered"], 1)

    def test_public_config_and_admin_settings(self):
        self.assertFalse(backend.public_config()["gift_deposit"]["enabled"])
        ticket = self.client.post("/api/admin/session", json={"initData": signed_user(101)}).json["ticket"]
        self.client.post("/admin/login", json={"ticket": ticket})
        with self.client.session_transaction() as session:
            h = {"X-Admin-CSRF": session["admin_csrf"]}
        r = self.client.post("/api/admin/relayer/settings", headers=h, json={"api_id": "12345", "api_hash": "a" * 32, "enabled": True})
        self.assertEqual(r.status_code, 200)
        self.assertNotIn("a" * 32, r.get_data(as_text=True))
        self.assertEqual(self.client.post("/api/admin/relayer/settings", headers=h, json={"api_id": "x1"}).status_code, 400)
        # Not logged in yet -> not ready; players cannot reach admin routes.
        self.assertFalse(backend.relayer_ready())
        self.assertEqual(self.client.post("/api/admin/relayer/status", json={"initData": signed_user(202)}).status_code, 403)
        self.scan([])
        self.assertTrue(backend.relayer_ready())
        cfg = backend.public_config()["gift_deposit"]
        self.assertEqual((cfg["enabled"], cfg["account"], cfg["share"]), (True, "relay", 0.85))
        gifts = self.client.post("/api/gifts/mine", json={"initData": signed_user(202)}).json["gifts"]
        self.assertEqual(gifts[0]["credit_ton"], 85.0)

    def test_login_flow_routes_store_session(self):
        ticket = self.client.post("/api/admin/session", json={"initData": signed_user(101)}).json["ticket"]
        self.client.post("/admin/login", json={"ticket": ticket})
        with self.client.session_transaction() as session:
            h = {"X-Admin-CSRF": session["admin_csrf"]}
        self.client.post("/api/admin/relayer/settings", headers=h, json={"api_id": "12345", "api_hash": "b" * 32})
        async def phone(*a):
            return {"status": "code_sent", "phone_code_hash": "H"}, "S1"
        async def code(*a):
            return {"status": "authorized", "account": {"username": "relay", "id": 5}}, "S2"
        with mock.patch.object(relayer, "phone_start", phone), mock.patch.object(relayer, "code_submit", code):
            self.assertEqual(self.client.post("/api/admin/relayer/login/phone", headers=h, json={"phone": "+79990000000"}).status_code, 200)
            self.assertEqual(backend.relayer_doc()["session"], "S1")
            r = self.client.post("/api/admin/relayer/login/code", headers=h, json={"code": "12345"})
        self.assertEqual(r.json["state"]["account"]["username"], "relay")
        self.assertEqual(backend.relayer_doc()["session"], "S2")
        self.assertTrue(r.json["state"]["authorized"])

    def test_login_delivery_resend_2fa_and_readable_errors(self):
        ticket = self.client.post("/api/admin/session", json={"initData": signed_user(101)}).json["ticket"]
        self.client.post("/admin/login", json={"ticket": ticket})
        with self.client.session_transaction() as session:
            h = {"X-Admin-CSRF": session["admin_csrf"]}
        self.client.post("/api/admin/relayer/settings", headers=h, json={"api_id": "12345", "api_hash": "b" * 32})
        seen = {}
        async def phone(*a):
            return {"status": "code_sent", "phone_code_hash": "H1", "delivery": "app", "next": "sms"}, "S1"
        async def resend(*a):
            return {"status": "code_sent", "phone_code_hash": "H2", "delivery": "sms", "next": ""}, "S1"
        async def code(api_id, api_hash, session, phone_, code_, hash_, password=None):
            seen["password"], seen["hash"] = password, hash_
            return {"status": "authorized", "account": {"username": "relay", "id": 5}}, "S2"
        with mock.patch.object(relayer, "phone_start", phone), mock.patch.object(relayer, "resend_code", resend), mock.patch.object(relayer, "code_submit", code):
            r = self.client.post("/api/admin/relayer/login/phone", headers=h, json={"phone": "+79990000000"})
            self.assertEqual((r.json["auth"]["delivery"], r.json["auth"]["next"]), ("app", "sms"))
            r = self.client.post("/api/admin/relayer/login/resend", headers=h, json={})
            self.assertEqual(r.json["auth"]["delivery"], "sms")
            r = self.client.post("/api/admin/relayer/login/code", headers=h, json={"code": "12 345", "password": "pw"})
        self.assertEqual(seen, {"password": "pw", "hash": "H2"})
        self.assertTrue(r.json["state"]["authorized"])

        class ApiIdInvalidError(Exception):
            pass
        async def boom(*a):
            raise ApiIdInvalidError("x")
        with mock.patch.object(relayer, "phone_start", boom):
            r = self.client.post("/api/admin/relayer/login/phone", headers=h, json={"phone": "+79990000000"})
        self.assertEqual(r.status_code, 409)
        self.assertIn("API ID", r.json["message"])
        class FloodWaitError(Exception):
            seconds = 600
        self.assertIn("11 мин", relayer.explain(FloodWaitError()))

    def test_login_by_ready_session(self):
        ticket = self.client.post("/api/admin/session", json={"initData": signed_user(101)}).json["ticket"]
        self.client.post("/admin/login", json={"ticket": ticket})
        with self.client.session_transaction() as session:
            h = {"X-Admin-CSRF": session["admin_csrf"]}
        self.client.post("/api/admin/relayer/settings", headers=h, json={"api_id": "12345", "api_hash": "b" * 32})
        async def check(api_id, api_hash, session):
            return {"status": "authorized", "account": {"username": "relay", "id": 5}}, session
        self.assertEqual(self.client.post("/api/admin/relayer/login/session", headers=h, json={"session": "short"}).status_code, 400)
        string = "1" + "A" * 200
        with mock.patch.object(relayer, "session_check", check):
            r = self.client.post("/api/admin/relayer/login/session", headers=h, json={"session": string})
        self.assertTrue(r.json["state"]["authorized"])
        self.assertEqual(backend.relayer_doc()["session"], string)

    def test_login_by_qr(self):
        import time as _t
        ticket = self.client.post("/api/admin/session", json={"initData": signed_user(101)}).json["ticket"]
        self.client.post("/admin/login", json={"ticket": ticket})
        with self.client.session_transaction() as session:
            h = {"X-Admin-CSRF": session["admin_csrf"]}
        self.client.post("/api/admin/relayer/settings", headers=h, json={"api_id": "12345", "api_hash": "b" * 32})
        async def flow(api_id, api_hash, on_url, total=150):
            on_url("tg://login?token=AAA")
            await __import__("asyncio").sleep(0.3)
            return {"status": "authorized", "account": {"username": "relay", "id": 5}}, "SQ"
        with mock.patch.object(relayer, "qr_login_flow", flow), mock.patch.object(relayer, "_imports", lambda: None):
            r = self.client.post("/api/admin/relayer/login/qr", headers=h, json={})
            self.assertEqual((r.json["state"]["status"], r.json["auth"]["qr_url"]), ("qr_wait", "tg://login?token=AAA"))
            for _ in range(40):
                r = self.client.post("/api/admin/relayer/status", headers=h, json={})
                if r.json["state"]["authorized"]:
                    break
                _t.sleep(0.1)
        self.assertTrue(r.json["state"]["authorized"])
        self.assertEqual(backend.relayer_doc()["session"], "SQ")

    def test_qr_need_password_then_2fa(self):
        import time as _t
        ticket = self.client.post("/api/admin/session", json={"initData": signed_user(101)}).json["ticket"]
        self.client.post("/admin/login", json={"ticket": ticket})
        with self.client.session_transaction() as session:
            h = {"X-Admin-CSRF": session["admin_csrf"]}
        self.client.post("/api/admin/relayer/settings", headers=h, json={"api_id": "12345", "api_hash": "b" * 32})
        async def flow(api_id, api_hash, on_url, total=150):
            on_url("tg://login?token=BBB")
            return {"status": "need_password"}, "SP"
        async def pw(api_id, api_hash, session, password):
            return {"status": "authorized", "account": {"username": "relay", "id": 5}}, session
        with mock.patch.object(relayer, "qr_login_flow", flow), mock.patch.object(relayer, "password_submit", pw), mock.patch.object(relayer, "_imports", lambda: None):
            self.client.post("/api/admin/relayer/login/qr", headers=h, json={})
            for _ in range(40):
                r = self.client.post("/api/admin/relayer/status", headers=h, json={})
                if r.json["state"]["status"] == "need_password":
                    break
                _t.sleep(0.1)
            self.assertEqual(r.json["state"]["status"], "need_password")
            r = self.client.post("/api/admin/relayer/login/password", headers=h, json={"password": "x"})
        self.assertTrue(r.json["state"]["authorized"])
        self.assertEqual(backend.relayer_doc()["session"], "SP")

    def test_crop_png_trims_transparent_border(self):
        from PIL import Image
        img = Image.new("RGBA", (400, 400), (0, 0, 0, 0))
        img.paste((255, 0, 0, 255), (150, 160, 250, 240))
        buf = io.BytesIO()
        img.save(buf, "WEBP")
        out = Image.open(io.BytesIO(relayer.crop_png(buf.getvalue())))
        self.assertEqual(out.format, "PNG")
        self.assertLess(out.width, 200)
        self.assertEqual(out.width, out.height)


if __name__ == "__main__":
    unittest.main()


class BotEmojiTests(unittest.TestCase):
    def test_tokens_icons_and_escaping(self):
        import bot_messages as bm
        cfg = {"k": {"text": "A <b>{name}</b> [emoji:5368324170671202286:👍] {gift}", "buttons": [
            {"text": "Играть", "action": "app", "target": "menu", "style": "default", "icon": "5424972470023104089"}]}}
        p = bm.message_payload(cfg, "k", "https://app.example", name="<i>x&", gift="Шляпа")
        self.assertTrue(p["html"])
        self.assertEqual(p["text"], 'A &lt;b&gt;&lt;i&gt;x&amp;&lt;/b&gt; <tg-emoji emoji-id="5368324170671202286">👍</tg-emoji> Шляпа')
        self.assertEqual(p["reply_markup"]["inline_keyboard"][0][0]["icon_custom_emoji_id"], "5424972470023104089")
        with self.assertRaises(ValueError):
            bm.validate_message({"text": "x", "buttons": [{"text": "a", "action": "app", "target": "menu", "style": "default", "icon": "abc"}]})
        self.assertEqual(bm.validate_message({"text": "x", "buttons": [{"text": "a", "action": "app", "target": "menu", "style": "default", "icon": " 5424972470023104089 "}]})["buttons"][0]["icon"], "5424972470023104089")

    def test_send_falls_back_without_custom_emoji(self):
        calls = []
        def fake(method, **kw):
            calls.append(kw)
            if len(calls) == 1:
                raise ValueError("DOCUMENT_INVALID")
            return {}
        class Sync:
            def __init__(s, target, daemon=None): s.t = target
            def start(s): s.t()
        markup = {"inline_keyboard": [[{"text": "Go", "icon_custom_emoji_id": "5424972470023104089", "url": "https://t.me/x"}]]}
        with mock.patch.object(backend, "tg_api", fake), mock.patch.object(backend, "BOT_TOKEN", "t"), mock.patch.object(backend.threading, "Thread", Sync):
            backend._send_tg_async("tg1", 'Hi <tg-emoji emoji-id="5368324170671202286">👍</tg-emoji>', markup, html=True)
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[1]["text"], "Hi 👍")
        self.assertNotIn("icon_custom_emoji_id", calls[1]["reply_markup"]["inline_keyboard"][0][0])
        self.assertEqual(calls[1]["parse_mode"], "HTML")

    def test_pack_import_and_thumb_requires_admin(self):
        backend.db = {"users": {}, "prices": {}, "settings": {}, "withdrawals": {}, "promocodes": {}, "quests": {}}
        client = backend.app.test_client()
        client.post("/api/state", json={"initData": signed_user(202)})
        pack = {"name": "cool", "title": "Cool", "sticker_type": "custom_emoji", "stickers": [{"custom_emoji_id": "5368324170671202286", "emoji": "👍"}, {"custom_emoji_id": "5424972470023104089", "emoji": "🔥"}]}
        with mock.patch.object(backend, "tg_api", lambda m, **k: pack), mock.patch.object(backend, "require_admin", lambda u: None):
            r = client.post("/api/admin/emojis/pack", json={"initData": signed_user(202), "link": "https://t.me/addemoji/cool"})
            self.assertEqual((r.status_code, r.json["added"]), (200, 2))
            pack["sticker_type"] = "regular"
            self.assertEqual(client.post("/api/admin/emojis/pack", json={"initData": signed_user(202), "link": "cool"}).status_code, 400)
        self.assertEqual(set(backend.emoji_doc()["saved"]), {"5368324170671202286", "5424972470023104089"})
        self.assertEqual(client.get("/api/admin/emoji-thumb/5368324170671202286").status_code, 404)


class WithdrawMatchTests(unittest.TestCase):
    def items(self):
        mk = lambda slug, title, model, can=0, stars=0: (None, {"slug": slug, "title": title, "model": model, "can_transfer_at": can, "transfer_stars": stars})
        import time as t
        return [mk("PlushPepe-1", "Plush Pepe", "Cozy", can=int(t.time()) + 999), mk("PlushPepe-2", "Plush Pepe", "Cozy (1.5%)", stars=25),
                mk("PlushPepe-3", "Plush Pepe", "Rare", stars=0), mk("Hat-1", "Hat", "Cap")]

    def test_model_must_match_and_rarity_suffix_ignored(self):
        _, info = relayer.match_job(self.items(), {"slug": "", "collection": "Plush Pepe", "model": "Cozy"})
        self.assertEqual(info["slug"], "PlushPepe-2")  # unlocked one wins over the locked Cozy
        self.assertEqual(relayer.match_job(self.items(), {"slug": "", "collection": "Plush Pepe", "model": "Missing"}), (None, None))

    def test_random_gift_takes_any_prefers_free_unlocked(self):
        _, info = relayer.match_job(self.items(), {"slug": "", "collection": "Plush Pepe", "model": ""})
        self.assertEqual(info["slug"], "PlushPepe-3")
        self.assertEqual(relayer.match_job(self.items(), {"slug": "Hat-1", "collection": "", "model": ""})[1]["slug"], "Hat-1")

    def test_kick_runs_scan_only_when_stale(self):
        backend.db = {"users": {}, "settings": {}, "relayer": {"enabled": True, "session": "S", "api_id": "1", "api_hash": "h", "state": {"last_scan": 0}}}
        calls = []
        class Sync:
            def __init__(s, target, daemon=None): s.t = target
            def start(s): s.t()
        with mock.patch.object(backend, "relayer_scan", lambda *a, **k: calls.append(1)), mock.patch.object(backend.relayer_lib, "available", lambda: True), mock.patch.object(backend.threading, "Thread", Sync):
            backend.relayer_kick()
            backend.relayer_doc()["state"]["last_scan"] = int(__import__("time").time())
            backend.relayer_kick()
        self.assertEqual(calls, [1])
