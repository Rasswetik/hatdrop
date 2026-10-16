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
        self.catalog = {"plushpepe": {"name": "Plush Pepe", "floor": 100.0, "models": [{"model": "Cozy", "floor": 200.0}]}}
        patcher = mock.patch.object(backend, "CATALOG", self.catalog)
        patcher.start()
        self.addCleanup(patcher.stop)

    def scan(self, gifts):
        return backend.relayer_apply_scan({"status": "online", "account": {"username": "relay"}, "gifts": gifts})

    def test_baseline_then_delivery_at_85_percent_and_sale_without_fee(self):
        old = gift("tg:1")
        self.assertTrue(self.scan([old])["baseline"])
        self.assertEqual(self.user["prizes"], [])  # gifts that existed before linking are not credited
        stats = self.scan([old, gift("tg:2", slug="PlushPepe-8")])
        self.assertEqual(stats["delivered"], 1)
        prize = self.user["prizes"][0]
        self.assertEqual(prize["value"], 170.0)  # model price 200 * 0.85
        self.assertTrue(prize["image"].startswith("/nft-img/plushpepe-8") or prize["image"].startswith("/nft-img/PlushPepe-8"))
        self.assertEqual(self.client.post("/api/state", json={"initData": signed_user(202)}).json["prizes"][0]["sell_ton"], 170.0)
        before = self.user["balance"]
        self.assertEqual(self.client.post("/api/sell", json={"initData": signed_user(202), "prize_id": prize["id"]}).json["payout_ton"], 170.0)
        self.assertEqual(self.user["balance"], before + 170.0)

    def test_floor_used_when_model_unknown_and_duplicates_ignored(self):
        self.scan([])
        g = gift("tg:3", model="Mystery")
        self.assertEqual(self.scan([g])["delivered"], 1)
        self.assertEqual(self.user["prizes"][0]["value"], 85.0)
        self.assertEqual(self.scan([g])["processed"], 0)
        self.assertEqual(len(self.user["prizes"]), 1)

    def test_unknown_sender_plain_gift_and_missing_price(self):
        self.scan([])
        self.scan([gift("tg:4", sender=999), gift("tg:5", slug="")])
        self.assertEqual(self.user["prizes"], [])
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
