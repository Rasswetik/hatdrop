import unittest
from unittest import mock

from test_admin_dashboard import backend, signed_user


class WithdrawNotifyTests(unittest.TestCase):
    def setUp(self):
        backend.db = {"users": {}, "prices": {}, "settings": {}, "withdrawals": {}, "promocodes": {}, "quests": {}}
        backend.app.config.update(TESTING=True, SESSION_COOKIE_SECURE=False)
        self.c = backend.app.test_client()
        self.c.post("/api/state", json={"initData": signed_user(202)})
        self.user = backend.db["users"]["tg202"]
        self.sent = []
        patcher = mock.patch.object(backend, "_send_tg_async", lambda uid, text, markup=None, html=False: self.sent.append((uid, text)))
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_gift_emoji_and_admin_notice(self):
        key = next(iter(backend.gifts_map()))
        backend.emoji_doc()["gifts"][key] = {"id": "5368324170671202286", "emoji": "🎩"}
        prize = backend.add_prize(self.user, f"gift:{key}:Model", "Big Year", 5)
        r = self.c.post("/api/withdraw", json={"initData": signed_user(202), "prize_id": prize["id"]})
        self.assertEqual(r.status_code, 200)
        player = [t for u, t in self.sent if u == "tg202"][0]
        self.assertIn('<tg-emoji emoji-id="5368324170671202286">', player)
        self.assertNotIn("🎁", player)
        admins = [t for u, t in self.sent if u != "tg202"]
        self.assertTrue(admins and "Big Year" in admins[0])

    def test_admin_notice_contains_error(self):
        prize = backend.add_prize(self.user, "random", "Hat", 1)
        backend._notify_admins_withdrawal(self.user, prize, {}, error="FLOOD_WAIT 30")
        self.assertIn("FLOOD_WAIT 30", self.sent[0][1])


if __name__ == "__main__":
    unittest.main()


class PayloadTests(unittest.TestCase):
    def test_defaults_have_gift_emoji_and_red_open_button(self):
        from bot_messages import DEFAULT_MESSAGES, message_payload
        for key in ("withdraw_pending", "withdraw_completed", "season_place_prize", "withdraw_rejected"):
            p = message_payload(DEFAULT_MESSAGES, key, "https://x.example/", "A", "Big Year", gift_emoji='<tg-emoji emoji-id="123456">🎩</tg-emoji>')
            self.assertIn('<tg-emoji emoji-id="123456">', p["text"])
            self.assertIn("Big Year", p["text"])
            self.assertEqual(p["reply_markup"]["inline_keyboard"][0][0]["style"], "danger")
