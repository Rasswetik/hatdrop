import time
import unittest
from unittest import mock

from test_admin_dashboard import backend, signed_user


class BroadcastTests(unittest.TestCase):
    def setUp(self):
        backend.db = {"users": {}, "prices": {}, "settings": {}, "withdrawals": {}, "promocodes": {}, "quests": {}}
        backend.app.config.update(TESTING=True, SESSION_COOKIE_SECURE=False)
        self.c = backend.app.test_client()
        for uid in (101, 202, 303):
            self.c.post("/api/state", json={"initData": signed_user(uid)})
        backend.db["users"]["tg202"]["username"] = "bob"
        self.calls = []

        def fake_tg(method, **params):
            self.calls.append((method, params))
            if params.get("chat_id") == 303:
                raise ValueError("Forbidden: bot was blocked by the user")
            return True
        for p in (mock.patch.object(backend, "tg_api", fake_tg), mock.patch.object(backend, "BOT_TOKEN", "test-token")):
            p.start(); self.addCleanup(p.stop)
        ticket = self.c.post("/api/admin/session", json={"initData": signed_user(101)}).json["ticket"]
        self.c.post("/admin/login", json={"ticket": ticket})
        with self.c.session_transaction() as s:
            self.h = {"X-Admin-CSRF": s["admin_csrf"]}

    def test_links(self):
        self.assertEqual(backend.parse_post_link("https://t.me/my_chan/15"), ("@my_chan", 15))
        self.assertEqual(backend.parse_post_link("t.me/c/1234567890/7"), (-1001234567890, 7))
        with self.assertRaises(backend.ApiError):
            backend.parse_post_link("https://example.com/x/1")

    def test_recipients(self):
        self.assertEqual(len(backend.broadcast_recipients("all", "")), 3)
        self.assertEqual(backend.broadcast_recipients("list", "@bob, 303"), ["tg202", "tg303"])

    def test_copy_message_to_selected_and_stats(self):
        r = self.c.post("/api/admin/broadcast/start", headers=self.h, json={"audience": "list", "list": "@bob 303", "link": "https://t.me/chan/5"})
        self.assertEqual(r.status_code, 200)
        for _ in range(100):
            if backend.db["broadcasts"][r.json["id"]]["status"] == "done":
                break
            time.sleep(0.05)
        row = backend.db["broadcasts"][r.json["id"]]
        self.assertEqual((row["sent"], row["blocked"], row["total"]), (1, 1, 2))
        self.assertTrue(all(m == "copyMessage" and p["from_chat_id"] == "@chan" and p["message_id"] == 5 for m, p in self.calls))


if __name__ == "__main__":
    unittest.main()
