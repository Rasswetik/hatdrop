import time
import unittest
from unittest import mock

from test_admin_dashboard import backend, signed_user


class StarsTests(unittest.TestCase):
    def setUp(self):
        backend.db = {"users": {}, "prices": {}, "settings": {}, "withdrawals": {}, "promocodes": {}, "quests": {}}
        backend.app.config.update(TESTING=True, SESSION_COOKIE_SECURE=False)
        self.c = backend.app.test_client()
        self.c.post("/api/state", json={"initData": signed_user(202)})
        self.user = backend.db["users"]["tg202"]
        self.sent = []
        def fake_tg(method, **params):
            self.sent.append((method, params))
            return "https://t.me/$invoice" if method == "createInvoiceLink" else True
        for patcher in (mock.patch.object(backend, "tg_api", fake_tg), mock.patch.object(backend, "BOT_TOKEN", "test-token")):
            patcher.start()
            self.addCleanup(patcher.stop)

    def post(self, path, **body):
        return self.c.post(path, json={"initData": signed_user(202), **body})

    def payment(self, order, charge="C1", total=None):
        return {"invoice_payload": f"stars:{order['order_id']}", "currency": "XTR", "total_amount": order["stars"] if total is None else total,
                "telegram_payment_charge_id": charge}

    def test_full_flow_credits_once_and_locks_withdrawals(self):
        self.assertTrue(self.post("/api/state").json["config"]["stars_deposit"]["enabled"])
        order = self.post("/api/stars/deposit/create", amount=2.5).json
        self.assertEqual(order["stars"], 250)
        invoice = [p for m, p in self.sent if m == "createInvoiceLink"][0]
        self.assertEqual((invoice["currency"], invoice["prices"][0]["amount"]), ("XTR", 250))
        backend.stars_pre_checkout({"id": "q", "from": {"id": 202}, "invoice_payload": f"stars:{order['order_id']}", "currency": "XTR", "total_amount": 250})
        self.assertTrue([p for m, p in self.sent if m == "answerPreCheckoutQuery"][0]["ok"])
        before = self.user["balance"]
        self.assertTrue(backend.stars_successful_payment(202, self.payment(order)))
        self.assertEqual(self.user["balance"], before + 2.5)
        # Replays, other charge ids and wrong totals never credit twice.
        self.assertFalse(backend.stars_successful_payment(202, self.payment(order)))
        self.assertFalse(backend.stars_successful_payment(202, self.payment(order, charge="C2")))
        self.assertEqual(self.user["balance"], before + 2.5)
        self.assertEqual(self.post("/api/stars/deposit/status", order_id=order["order_id"]).json["status"], "credited")
        self.assertGreater(self.post("/api/state").json["withdraw_locked_until"], time.time() + 20 * 86400)

    def test_wrong_amount_or_user_is_rejected(self):
        order = self.post("/api/stars/deposit/create", amount=1).json
        self.assertFalse(backend.stars_successful_payment(202, self.payment(order, total=1)))
        self.assertFalse(backend.stars_successful_payment(303, self.payment(order)))
        self.assertEqual(self.user["balance"], backend.START_BALANCE)
        backend.stars_pre_checkout({"id": "q", "from": {"id": 202}, "invoice_payload": f"stars:{order['order_id']}", "currency": "XTR", "total_amount": 5})
        self.assertFalse([p for m, p in self.sent if m == "answerPreCheckoutQuery"][-1]["ok"])

    def test_bad_amount_demo_and_disabled(self):
        self.assertEqual(self.post("/api/stars/deposit/create", amount=0.01).status_code, 400)
        self.assertEqual(self.c.post("/api/stars/deposit/create", json={"demoId": "x", "amount": 1}).status_code, 400)
        backend.db["settings"]["stars"] = {"enabled": False}
        self.assertEqual(self.post("/api/stars/deposit/create", amount=1).status_code, 503)

    def test_withdraw_blocked_after_stars_and_referral_bonus(self):
        referrer = backend.db["users"].setdefault("tg1", dict(self.user, id="tg1", key="k1", balance=0, ref_created=True))
        self.user["ref_by"] = "tg1"
        order = self.post("/api/stars/deposit/create", amount=10).json
        backend.stars_successful_payment(202, self.payment(order))
        self.assertEqual(referrer["ref_balance"], 1.0)
        backend.add_prize(self.user, "random", "Hat", 1.0)
        self.assertEqual(self.post("/api/withdraw", prize_id=self.user["prizes"][-1]["id"]).status_code, 400)

    def test_admin_can_change_rate(self):
        ticket = self.c.post("/api/admin/session", json={"initData": signed_user(101)}).json["ticket"]
        self.c.post("/admin/login", json={"ticket": ticket})
        with self.c.session_transaction() as session:
            h = {"X-Admin-CSRF": session["admin_csrf"]}
        self.assertEqual(self.c.post("/api/admin/stars/save", headers=h, json={"per_ton": 50}).status_code, 200)
        self.assertEqual(self.post("/api/stars/deposit/create", amount=2).json["stars"], 100)
        self.assertEqual(self.c.post("/api/admin/stars/save", headers=h, json={"per_ton": 0}).status_code, 400)


if __name__ == "__main__":
    unittest.main()
