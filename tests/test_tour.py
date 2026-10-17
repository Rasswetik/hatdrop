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
