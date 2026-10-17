import unittest

from test_admin_dashboard import backend, signed_user
import weapons


class ShopTests(unittest.TestCase):
    def setUp(self):
        backend.db = {"users": {}, "prices": {}, "settings": {}, "withdrawals": {}, "promocodes": {}, "quests": {}}
        backend.app.config.update(TESTING=True, SESSION_COOKIE_SECURE=False)
        self.c = backend.app.test_client()
        self.post("/api/state", uid=202)
        self.user = backend.db["users"]["tg202"]
        self.user["balance"] = 10
        ticket = self.post("/api/admin/session", uid=101).json["ticket"]
        self.c.post("/admin/login", json={"ticket": ticket})
        with self.c.session_transaction() as s:
            self.h = {"X-Admin-CSRF": s["admin_csrf"]}

    def post(self, path, body=None, uid=202):
        return self.c.post(path, json={"initData": signed_user(uid), **(body or {})})

    def admin(self, path, body):
        return self.c.post(path, headers=self.h, json=body)

    def offer(self, **extra):
        body = {"action": "create", "title": "Меч", "currency": "ton", "price": 2, "reward": {"kind": "weapon", "weapon": "sword"}, **extra}
        r = self.admin("/api/admin/shop/save", body)
        self.assertEqual(r.status_code, 200, r.json)
        return r.json["id"]

    def test_buy_weapon_with_ton_and_stock(self):
        oid = self.offer(limit_total=1)
        r = self.post("/api/shop/buy", {"id": oid})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.user["balance"], 8)
        self.assertIn("sword", r.json["weapons"])
        self.assertEqual(self.post("/api/shop/buy", {"id": oid}).status_code, 400)
        row = self.post("/api/shop").json["offers"][0]
        self.assertEqual(row["total_left"], 0)

    def test_hatcoin_price_user_limit_and_funds(self):
        oid = self.offer(currency="hatcoin", price=5, reward={"kind": "ton", "amount": 1}, limit_user=2)
        self.assertEqual(self.post("/api/shop/buy", {"id": oid}).json["error"], "insufficient_funds")
        self.user["hatcoin_units"] = 12 * backend.HATCOIN_UNITS
        for _ in range(2):
            self.assertEqual(self.post("/api/shop/buy", {"id": oid}).status_code, 200)
        self.assertEqual(self.user["hatcoin_units"], 2 * backend.HATCOIN_UNITS)
        self.assertEqual(self.user["balance"], 12)
        self.assertEqual(self.post("/api/shop/buy", {"id": oid}).status_code, 400)

    def test_personal_offer_visible_only_to_owner_and_admin_tools(self):
        oid = self.admin("/api/admin/shop/save", {"action": "create", "key": self.user["key"], "price": 1, "currency": "ton",
                                                   "reward": {"kind": "hatcoin", "amount": 3}}).json["id"]
        self.assertEqual(len(self.post("/api/shop").json["offers"]), 1)
        self.post("/api/state", uid=303)
        self.assertEqual(self.post("/api/shop", uid=303).json["offers"], [])
        self.assertEqual(self.post("/api/shop/buy", {"id": oid}, uid=303).status_code, 404)
        r = self.admin("/api/admin/user/weapons", {"key": self.user["key"], "weapon": "trident"})
        self.assertIn("trident", r.json["user"]["weapons"])
        r = self.admin("/api/admin/user/weapons", {"key": self.user["key"], "weapon": "trident", "action": "revoke"})
        self.assertNotIn("trident", r.json["user"]["weapons"])
        r = self.admin("/api/admin/user/hatcoin", {"key": self.user["key"], "mode": "add", "amount": 2.5})
        self.assertEqual(r.json["user"]["hatcoin"], 2.5)

    def test_rarity_catalog(self):
        self.assertEqual(weapons.WEAPONS["scythe"]["rarity"], "legendary")
        self.assertEqual(weapons.WEAPONS["axe"]["rarity"], "common")
        self.assertEqual(weapons.WEAPONS["skeleton"]["rarity"], "epic")
        self.assertEqual(weapons.WEAPONS["pumpkin"]["rarity"], "epic")


if __name__ == "__main__":
    unittest.main()
