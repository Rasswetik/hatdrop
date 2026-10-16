import unittest

from test_admin_dashboard import backend, signed_user


def fresh_db():
    return {"users": {}, "prices": {}, "settings": {}, "withdrawals": {}, "promocodes": {}, "quests": {}}


class RtpTests(unittest.TestCase):
    def setUp(self):
        backend.db = fresh_db()
        backend.app.config.update(TESTING=True, SESSION_COOKIE_SECURE=False)
        self.client = backend.app.test_client()
        self.client.post("/api/state", json={"initData": signed_user(202)})
        self.user = backend.db["users"]["tg202"]

    def test_default_factor_is_one(self):
        for mode in backend.RTP_MODES:
            self.assertAlmostEqual(backend.rtp_factor(self.user, mode), 1.0)

    def test_adjustment_and_global_combine_and_clamp(self):
        backend.db["settings"]["rtp"] = {"upgrade": 90}
        self.user["rtp_adj"] = {"upgrade": 5}
        self.assertEqual(backend.effective_rtp(self.user, "upgrade"), 95)
        self.user["rtp_adj"] = {"upgrade": -500}
        self.assertEqual(backend.effective_rtp(self.user, "upgrade"), 0)

    def test_upgrade_rtp_changes_real_win_rate_only(self):
        self.user["balance"] = 1e9
        self.user["rtp_adj"] = {"upgrade": -backend.RTP_NOMINAL["upgrade"]}  # 0% -> never wins
        for _ in range(60):
            r = self.client.post("/api/spin", json={"initData": signed_user(202), "chance": 0.7, "tier": "random"})
            self.assertEqual(r.status_code, 200)
            self.assertFalse(r.json["win"])
        self.user["rtp_adj"] = {"upgrade": 200}  # factor > 1/0.7 -> always wins
        for _ in range(20):
            self.assertTrue(self.client.post("/api/spin", json={"initData": signed_user(202), "chance": 0.7, "tier": "random"}).json["win"])

    def test_chest_first_cell_follows_rtp(self):
        self.user["balance"] = 1e9
        self.user["rtp_adj"] = {"chests": -backend.RTP_NOMINAL["chests"]}
        for _ in range(15):
            self.client.post("/api/chests/start", json={"initData": signed_user(202), "bet": 1, "empties": 1})
            r = self.client.post("/api/chests/open", json={"initData": signed_user(202), "cell": 3}).json
            self.assertFalse(r["safe"])
        self.user["rtp_adj"] = {"chests": 200}
        for _ in range(15):
            self.client.post("/api/chests/start", json={"initData": signed_user(202), "bet": 1, "empties": 5})
            r = self.client.post("/api/chests/open", json={"initData": signed_user(202), "cell": 3}).json
            self.assertTrue(r["safe"])
            self.client.post("/api/chests/cashout", json={"initData": signed_user(202)})

    def test_admin_can_set_global_and_user_rtp(self):
        ticket = self.client.post("/api/admin/session", json={"initData": signed_user(101)}).json["ticket"]
        self.assertEqual(self.client.post("/admin/login", json={"ticket": ticket}).status_code, 200)
        with self.client.session_transaction() as session:
            h = {"X-Admin-CSRF": session["admin_csrf"]}
        self.assertEqual(self.client.post("/api/admin/rtp/save", headers=h, json={"upgrade": 92}).status_code, 200)
        self.assertEqual(backend.global_rtp("upgrade"), 92)
        self.assertEqual(self.client.post("/api/admin/rtp/save", headers=h, json={"upgrade": 999}).status_code, 400)
        r = self.client.post("/api/admin/user/rtp", headers=h, json={"key": self.user["key"], "chests": -3})
        self.assertEqual(r.json["user"]["rtp"]["chests"]["effective"], backend.RTP_NOMINAL["chests"] - 3)
        # Players never see it.
        self.assertNotIn("rtp", self.client.post("/api/state", json={"initData": signed_user(202)}).get_data(as_text=True))


if __name__ == "__main__":
    unittest.main()
