import hashlib
import hmac
import json
import time
import unittest
from unittest import mock

from test_admin_dashboard import backend, signed_user


class PaymentsTests(unittest.TestCase):
    def setUp(self):
        backend.db = {"users": {}, "prices": {}, "settings": {"bot_username": "hatbot",
                      "crypto_pay": {"token": "123:ABC", "enabled": True}}, "withdrawals": {}, "promocodes": {}, "quests": {}}
        backend.app.config.update(TESTING=True, SESSION_COOKIE_SECURE=False)
        self.c = backend.app.test_client()
        self.c.post("/api/state", json={"initData": signed_user(202)})
        self.user = backend.db["users"]["tg202"]
        self.calls = []
        def fake(method, payload=None, cfg=None):
            self.calls.append((method, payload))
            if method == "createInvoice":
                return {"invoice_id": 77, "status": "active", "bot_invoice_url": "https://t.me/CryptoBot?start=IVxx"}
            if method == "getInvoices":
                return {"items": [self.invoice(status="paid")]}
            return {"app_id": 5, "name": "Pay"}
        for patcher in (mock.patch.object(backend, "crypto_request", fake), mock.patch.object(backend, "BOT_TOKEN", "test-token")):
            patcher.start()
            self.addCleanup(patcher.stop)

    def post(self, path, **body):
        return self.c.post(path, json={"initData": signed_user(202), **body})

    def invoice(self, status="paid", amount="5.00", asset="TON"):
        order = next(iter(backend.db["crypto_orders"].values()))
        return {"invoice_id": 77, "status": status, "amount": amount, "asset": asset, "payload": order["payload"], "currency_type": "crypto"}

    def test_create_verify_credit_once(self):
        self.assertTrue(self.post("/api/state").json["config"]["crypto_deposit"]["enabled"])
        order = self.post("/api/cryptobot/deposit/create", amount=5).json
        self.assertTrue(order["invoice_url"].startswith("https://t.me/"))
        self.assertEqual(self.post("/api/cryptobot/deposit/create", amount=5).json["order_id"], order["order_id"])  # reused
        before = self.user["balance"]
        self.assertEqual(self.post("/api/cryptobot/deposit/verify", order_id=order["order_id"]).json["status"], "credited")
        self.assertEqual(self.user["balance"], before + 5)
        self.assertEqual(self.post("/api/cryptobot/deposit/verify", order_id=order["order_id"]).json["status"], "credited")
        self.assertEqual(self.user["balance"], before + 5)
        self.assertFalse(backend.crypto_credit_invoice(self.invoice()))

    def test_wrong_amount_or_asset_is_rejected(self):
        self.post("/api/cryptobot/deposit/create", amount=5)
        for bad in (self.invoice(amount="4.00"), self.invoice(asset="USDT")):
            with self.assertRaises(backend.ApiError):
                backend.crypto_credit_invoice(bad)
        self.assertEqual(self.user["balance"], backend.START_BALANCE)

    def test_webhook_signature(self):
        self.post("/api/cryptobot/deposit/create", amount=5)
        cfg = backend.crypto_cfg()
        body = json.dumps({"update_type": "invoice_paid", "payload": self.invoice()}).encode()
        sig = hmac.new(hashlib.sha256(cfg["token"].encode()).digest(), body, hashlib.sha256).hexdigest()
        url = "/api/cryptobot/webhook/" + backend.crypto_webhook_secret(cfg)
        self.assertEqual(self.c.post(url, data=body, headers={"crypto-pay-api-signature": "bad", "Content-Type": "application/json"}).status_code, 403)
        self.assertEqual(self.c.post("/api/cryptobot/webhook/wrong", data=body, headers={"crypto-pay-api-signature": sig}).status_code, 403)
        r = self.c.post(url, data=body, headers={"crypto-pay-api-signature": sig, "Content-Type": "application/json"})
        self.assertTrue(r.json["credited"])
        self.assertEqual(self.user["balance"], backend.START_BALANCE + 5)

    def test_limits_disabled_and_admin_save(self):
        self.assertEqual(self.post("/api/cryptobot/deposit/create", amount=0.01).status_code, 400)
        ticket = self.c.post("/api/admin/session", json={"initData": signed_user(101)}).json["ticket"]
        self.c.post("/admin/login", json={"ticket": ticket})
        with self.c.session_transaction() as session:
            h = {"X-Admin-CSRF": session["admin_csrf"]}
        r = self.c.post("/api/admin/cryptobot/save", headers=h, json={"enabled": False, "testnet": True})
        self.assertEqual(r.status_code, 200)
        self.assertNotIn("123:ABC", r.get_data(as_text=True))
        self.assertEqual(self.post("/api/cryptobot/deposit/create", amount=5).status_code, 503)


class MarketAutoAndAutoWithdrawTests(unittest.TestCase):
    def setUp(self):
        backend.db = {"users": {}, "prices": {}, "settings": {}, "withdrawals": {}, "promocodes": {}, "quests": {}}
        backend.app.config.update(TESTING=True, SESSION_COOKIE_SECURE=False)
        self.c = backend.app.test_client()
        self.c.post("/api/state", json={"initData": signed_user(202)})
        self.user = backend.db["users"]["tg202"]
        self.user["username"] = "buyer"

    def admin_headers(self):
        ticket = self.c.post("/api/admin/session", json={"initData": signed_user(101)}).json["ticket"]
        self.c.post("/admin/login", json={"ticket": ticket})
        with self.c.session_transaction() as session:
            return {"X-Admin-CSRF": session["admin_csrf"]}

    def test_market_auto_period_and_tick(self):
        h = self.admin_headers()
        self.assertEqual(self.c.post("/api/admin/market/auto", headers=h, json={"minutes": 0}).status_code, 400)
        r = self.c.post("/api/admin/market/auto", headers=h, json={"enabled": True, "minutes": 7})
        self.assertEqual(r.json["minutes"], 7)
        with mock.patch.object(backend, "start_portals_refresh") as refresh:
            backend.MARKET_AUTO_STATE["last"] = 1000.0
            self.assertFalse(backend.market_auto_tick(now=1000 + 7 * 60 - 1))
            self.assertTrue(backend.market_auto_tick(now=1000 + 7 * 60 + 1))
            self.assertEqual(refresh.call_count, 1)
            self.c.post("/api/admin/market/auto", headers=h, json={"enabled": False})
            self.assertFalse(backend.market_auto_tick(now=10 ** 9))

    def ready_relayer(self):
        doc = backend.relayer_doc()
        doc.update(enabled=True, api_id="1", api_hash="a" * 32, session="S")
        doc["state"].update(authorized=True)

    def test_auto_withdraw_threshold_and_transfer(self):
        self.ready_relayer()
        cheap = backend.add_prize(self.user, "nft:PlushPepe-1", "Plush Pepe #1", 8.0)
        cheap["nft_slug"] = "PlushPepe-1"
        rich = backend.add_prize(self.user, "nft:PlushPepe-2", "Plush Pepe #2", 50.0)
        rich["nft_slug"] = "PlushPepe-2"
        for p in (cheap, rich):
            r = self.c.post("/api/withdraw", json={"initData": signed_user(202), "prize_id": p["id"]})
            self.assertEqual(r.status_code, 200)
        reqs = backend.db["withdrawals"]
        self.assertEqual(reqs[f"tg202:{cheap['id']}"]["auto"], "queued")
        self.assertEqual(reqs[f"tg202:{rich['id']}"]["auto"], "manual")  # above the 10 TON default limit

        async def transfer(api_id, api_hash, session, jobs):
            self.assertEqual([j["slug"] for j in jobs], ["PlushPepe-1"])
            self.assertEqual(jobs[0]["username"], "buyer")
            return [{"id": jobs[0]["id"], "status": "completed", "slug": "PlushPepe-1"}], "S2"
        with mock.patch.object(backend.relayer_lib, "transfer_jobs", transfer), mock.patch.object(backend, "_send_bot_message"):
            self.assertEqual(backend.relayer_process_withdrawals(), 1)
        self.assertEqual(reqs[f"tg202:{cheap['id']}"]["status"], "completed")
        self.assertEqual(cheap["status"], "withdrawn")
        self.assertEqual(rich["status"], "withdraw_pending")
        self.assertEqual(backend.relayer_doc()["session"], "S2")

    def test_limit_can_be_changed_or_removed_and_failures_fall_back_to_manual(self):
        self.ready_relayer()
        h = self.admin_headers()
        self.c.post("/api/admin/relayer/settings", headers=h, json={"auto_limit_enabled": False})
        big = backend.add_prize(self.user, "nft:Big-1", "Big #1", 500.0)
        big["nft_slug"] = "Big-1"
        self.c.post("/api/withdraw", json={"initData": signed_user(202), "prize_id": big["id"]})
        key = f"tg202:{big['id']}"
        self.assertEqual(backend.db["withdrawals"][key]["auto"], "queued")
        async def fail(*a):
            return [{"id": key, "status": "not_found", "error": "нет"}], ""
        with mock.patch.object(backend.relayer_lib, "transfer_jobs", fail):
            for _ in range(5):
                backend.db["withdrawals"][key]["retry_at"] = 0
                backend.relayer_process_withdrawals()
        self.assertEqual(backend.db["withdrawals"][key]["auto"], "failed")
        self.assertEqual(big["status"], "withdraw_pending")
        self.c.post("/api/admin/relayer/settings", headers=h, json={"auto_enabled": False})
        self.assertFalse(backend.relayer_auto()["enabled"])


if __name__ == "__main__":
    unittest.main()
