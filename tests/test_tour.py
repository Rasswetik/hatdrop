import unittest

from test_admin_dashboard import backend, signed_user


class TourTests(unittest.TestCase):
    def setUp(self):
        backend.db = {"users": {}, "prices": {}, "settings": {}, "withdrawals": {}, "promocodes": {}, "quests": {}}
        backend.app.config.update(TESTING=True)
        self.c = backend.app.test_client()
        backend.seed_free_hand_offer()

    def post(self, path, body=None):
        return self.c.post(path, json={"initData": signed_user(303), **(body or {})})

    def test_new_player_has_zero_balance_and_no_skeleton(self):
        st = self.post("/api/state").json
        self.assertEqual(st["balance_ton"], 0)
        self.assertEqual(st["weapons"], ["axe", "spin_plain"])
        self.assertFalse(st["tour_done"])

    def test_free_hand_offer_for_everyone(self):
        self.post("/api/state")
        offer = self.post("/api/shop").json["offers"][0]
        self.assertEqual(offer["price"], 0)
        r = self.post("/api/shop/buy", {"id": offer["id"]})
        self.assertEqual(r.status_code, 200)
        self.assertIn("staff", r.json["weapons"])
        self.assertEqual(self.post("/api/shop/buy", {"id": offer["id"]}).status_code, 400)

    def test_tour_flag_and_weapon_stats(self):
        self.post("/api/state")
        self.assertEqual(self.post("/api/tour/complete").status_code, 200)
        self.assertTrue(self.post("/api/state").json["tour_done"])
        st = self.post("/api/weapons/stats").json["weapons"]
        self.assertEqual(st["axe"]["percent"], 100.0)
        self.assertEqual(st["skeleton"]["percent"], 0.0)
        backend.weapons_lib.ACTIVE_EVENT = "halloween"
        try:
            self.assertIn("skeleton", self.post("/api/state").json["weapons"])
        finally:
            backend.weapons_lib.ACTIVE_EVENT = ""


class AdminUsersTests(unittest.TestCase):
    def setUp(self):
        backend.db = {"users": {}, "prices": {}, "settings": {}, "withdrawals": {}, "promocodes": {}, "quests": {}}
        backend.app.config.update(TESTING=True, SESSION_COOKIE_SECURE=False)
        self.c = backend.app.test_client()
        for uid in (301, 302, 303):
            self.c.post("/api/state", json={"initData": signed_user(uid)})
        backend.db["users"]["tg302"]["balance"] = 5
        ticket = self.c.post("/api/admin/session", json={"initData": signed_user(101)}).json["ticket"]
        self.c.post("/admin/login", json={"ticket": ticket})
        with self.c.session_transaction() as s:
            self.h = {"X-Admin-CSRF": s["admin_csrf"]}

    def test_filters_sort_and_ban(self):
        r = self.c.post("/api/admin/users", headers=self.h, json={"filter": "balance"}).json
        self.assertEqual([u["id"] for u in r["rows"]], ["tg302"])
        self.assertEqual(r["total"], 4)
        r = self.c.post("/api/admin/users", headers=self.h, json={"sort": "balance"}).json
        self.assertEqual(r["rows"][0]["id"], "tg302")
        key = backend.db["users"]["tg303"]["key"]
        d = self.c.post("/api/admin/user/flags", headers=self.h, json={"key": key, "banned": True, "note": "спамер"}).json["user"]
        self.assertTrue(d["banned"])
        self.assertEqual(self.c.post("/api/state", json={"initData": signed_user(303)}).status_code, 403)
        self.c.post("/api/admin/user/flags", headers=self.h, json={"key": key, "banned": False})
        self.assertEqual(self.c.post("/api/state", json={"initData": signed_user(303)}).status_code, 200)
