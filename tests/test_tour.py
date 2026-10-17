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
        self.assertEqual(st["weapons"], ["axe", "spin_plain", "theme_meadow"])
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


class WeaponCollectionTests(AdminUsersTests):
    def test_collections_claim_and_admin_edit(self):
        post = lambda path, body=None: self.c.post(path, json={"initData": signed_user(303), **(body or {})})
        cat = post("/api/weapons/catalog").json
        self.assertEqual([c["id"] for c in cat["collections"]], ["halloween"])
        self.assertEqual(cat["have"], 1)
        # админ: коллекция из трёх обычных вещей, награда 2 TON, оружие не может быть в двух коллекциях
        cfg = {"collections": [
            {"id": "a", "name": "Поле", "need": 2, "reward": 2, "weapons": ["axe", "staff", "shovel"]},
            {"id": "b", "name": "Дубль", "need": 1, "reward": 1, "weapons": ["axe", "mace"]}],
            "levels": [{"id": "x", "need": 1, "reward": 0.5}]}
        saved = self.c.post("/api/admin/weapons/save", headers=self.h, json={"cfg": cfg}).json["cfg"]
        self.assertEqual(saved["collections"][1]["weapons"], ["mace"])
        cat = post("/api/weapons/catalog").json
        self.assertEqual(post("/api/weapons/claim", {"type": "collection", "id": "a"}).status_code, 400)  # собрано 1 из 2
        self.assertEqual(post("/api/weapons/claim", {"type": "level", "id": "x"}).status_code, 200)
        self.assertEqual(post("/api/weapons/claim", {"type": "level", "id": "x"}).status_code, 400)
        self.assertEqual(post("/api/state").json["balance_ton"], 0.5)
        backend.weapons_lib.grant(backend.db["users"]["tg303"], "staff")
        r = post("/api/weapons/claim", {"type": "collection", "id": "a"})
        self.assertEqual(r.json["balance_ton"], 2.5)
        bad = self.c.post("/api/admin/weapons/save", headers=self.h, json={"cfg": {"collections": [{"name": ""}]}})
        self.assertEqual(bad.status_code, 400)
        self.assertEqual(self.c.post("/api/admin/weapons", headers=self.h, json={}).json["claims"], 2)


class ThemeMaintenanceTests(AdminUsersTests):
    def post(self, path, body=None, uid=303):
        return self.c.post(path, json={"initData": signed_user(uid), **(body or {})})

    def test_theme_event_and_ownership(self):
        st = self.post("/api/state").json
        self.assertEqual(st["theme"], "meadow")
        self.assertEqual(self.post("/api/theme/set", {"id": "halloween"}).status_code, 400)
        self.c.post("/api/admin/theme", headers=self.h, json={"enabled": True})
        st = self.post("/api/state").json
        self.assertEqual(st["theme"], "halloween")                      # включилось автоматически
        self.assertEqual(self.post("/api/theme/set", {"id": "meadow"}).json["theme"], "meadow")
        self.assertEqual(self.post("/api/state").json["theme"], "meadow")  # выбор игрока не перебивается
        self.post("/api/theme/set", {"id": "halloween"})
        self.c.post("/api/admin/theme", headers=self.h, json={"enabled": False})
        self.assertEqual(self.post("/api/state").json["theme"], "meadow")  # не куплена - пропала
        backend.weapons_lib.grant(backend.db["users"]["tg303"], "theme_halloween")
        self.post("/api/theme/set", {"id": "halloween"})
        self.assertEqual(self.post("/api/state").json["theme"], "halloween")  # куплена - осталась

    def test_maintenance_blocks_players_not_admins(self):
        r = self.c.post("/api/admin/maintenance", headers=self.h, json={"enabled": True, "text": "Скоро вернёмся"})
        self.assertTrue(r.json["enabled"])
        r = self.post("/api/state")
        self.assertEqual((r.status_code, r.json["error"], r.json["message"]), (503, "maintenance", "Скоро вернёмся"))
        self.assertEqual(self.post("/api/state", uid=101).status_code, 200)
        self.c.post("/api/admin/maintenance", headers=self.h, json={"enabled": False})
        self.assertEqual(self.post("/api/state").status_code, 200)

    def test_level_rewards(self):
        self.post("/api/state")
        r = self.c.post("/api/admin/levels", headers=self.h, json={"rewards": {"1": {"kind": "weapon", "weapon": "theme_halloween"}, "2": {"kind": "ton", "amount": 3}}})
        self.assertEqual(r.status_code, 200)
        st = self.post("/api/state").json
        self.assertIn("theme_halloween", st["weapons"])
        self.assertEqual(st["level_rewards"]["1"]["kind"], "weapon")
        self.assertEqual(st["balance_ton"], 0)  # уровень 2 ещё не достигнут
        bad = self.c.post("/api/admin/levels", headers=self.h, json={"rewards": {"1": {"kind": "weapon", "weapon": "nope"}}})
        self.assertEqual(bad.status_code, 400)
