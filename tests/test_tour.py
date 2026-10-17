from unittest.mock import patch
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
        self.assertEqual(st["weapons"], ["axe", "skeleton", "spin_plain", "spin_wild", "staff", "theme_meadow"])
        self.assertFalse(st["tour_done"])

    def test_no_free_offer_and_shop_hidden_by_default(self):
        self.post("/api/state")
        self.assertEqual(self.post("/api/shop").json["offers"], [])
        st = self.post("/api/state").json
        self.assertTrue(st["lavka_hidden"]["shop"])
        self.assertFalse(st["lavka_hidden"]["quests"])
        self.assertEqual(sorted(set(st["weapon_hidden"]) & {"axe", "staff", "skeleton", "spin_plain", "spin_wild"}), [])
        self.assertIn("sword", st["weapon_hidden"])
        self.assertIn("spin_turbo", st["weapon_hidden"])

    def test_tour_flag_and_weapon_stats(self):
        self.post("/api/state")
        self.assertEqual(self.post("/api/tour/complete").status_code, 200)
        self.assertTrue(self.post("/api/state").json["tour_done"])
        st = self.post("/api/weapons/stats").json["weapons"]
        self.assertEqual(st["axe"]["percent"], 100.0)
        self.assertEqual(st["skeleton"]["percent"], 100.0)
        self.assertEqual(st["sword"]["percent"], 0.0)


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
        self.assertEqual(cat["have"], 3)
        # админ: коллекция из трёх обычных вещей, награда 2 TON, оружие не может быть в двух коллекциях
        cfg = {"collections": [
            {"id": "a", "name": "Поле", "need": 3, "reward": 2, "weapons": ["axe", "staff", "shovel"]},
            {"id": "b", "name": "Дубль", "need": 1, "reward": 1, "weapons": ["axe", "mace"]}],
            "levels": [{"id": "x", "need": 1, "reward": 0.5}]}
        saved = self.c.post("/api/admin/weapons/save", headers=self.h, json={"cfg": cfg}).json["cfg"]
        self.assertEqual(saved["collections"][1]["weapons"], ["mace"])
        cat = post("/api/weapons/catalog").json
        self.assertEqual(post("/api/weapons/claim", {"type": "collection", "id": "a"}).status_code, 400)  # собрано 2 из 3
        self.assertEqual(post("/api/weapons/claim", {"type": "level", "id": "x"}).status_code, 200)
        self.assertEqual(post("/api/weapons/claim", {"type": "level", "id": "x"}).status_code, 400)
        self.assertEqual(post("/api/state").json["balance_ton"], 0.5)
        backend.weapons_lib.grant(backend.db["users"]["tg303"], "shovel")
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

    def test_level_table_claim_by_tap(self):
        self.post("/api/state")
        rows = [{"level": i, "need": 0 if i == 1 else i * 10, "reward": None} for i in range(1, 6)]
        rows[0]["reward"] = {"kind": "weapon", "weapon": "theme_halloween"}
        rows[1]["reward"] = {"kind": "ton", "amount": 3}
        r = self.c.post("/api/admin/levels", headers=self.h, json={"count": 5, "levels": rows})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json["levels"][2]["need"], 30)
        st = self.post("/api/state").json
        self.assertNotIn("theme_halloween", st["weapons"])  # автоматически не выдаётся
        self.assertTrue(st["level_table"][0]["reward"] and not st["level_table"][0]["claimed"])
        self.assertNotIn("view", st["level_table"][0])
        c = self.post("/api/level/claim", {"level": 1})
        self.assertEqual(c.status_code, 200)
        self.assertIn("theme_halloween", c.json["weapons"])
        self.assertEqual(self.post("/api/level/claim", {"level": 1}).status_code, 400)
        self.assertEqual(self.post("/api/level/claim", {"level": 2}).status_code, 400)  # уровень не достигнут
        backend.db["users"]["tg303"]["turnover"] = 25
        self.assertEqual(self.post("/api/state").json["level"]["level"], 2)
        self.assertEqual(self.post("/api/level/claim", {"level": 2}).json["balance_ton"], 3)
        bad = self.c.post("/api/admin/levels", headers=self.h, json={"count": 3, "levels": [
            {"level": 1, "need": 0}, {"level": 2, "need": 50}, {"level": 3, "need": 40}]})
        self.assertEqual(bad.status_code, 400)
        bad = self.c.post("/api/admin/levels", headers=self.h, json={"count": 1, "levels": [{"level": 1, "need": 0, "reward": {"kind": "weapon", "weapon": "nope"}}]})
        self.assertEqual(bad.status_code, 400)


class PromoItemTests(AdminUsersTests):
    def test_item_promo_grants_theme(self):
        r = self.c.post("/api/admin/promos/create", headers=self.h, json={"kind": "item", "code": "THEME1", "weapon": "theme_halloween", "limit": 5})
        self.assertEqual(r.status_code, 200)
        bad = self.c.post("/api/admin/promos/create", headers=self.h, json={"kind": "item", "code": "BADONE", "weapon": "axe"})
        self.assertEqual(bad.status_code, 400)
        out = self.c.post("/api/promo", json={"initData": signed_user(303), "code": "THEME1"}).json
        self.assertIn("theme_halloween", out["weapons"])
        d = self.c.post("/api/admin/user", headers=self.h, json={"key": backend.db["users"]["tg303"]["key"]}).json


class WithdrawalFlowTests(AdminUsersTests):
    def adm(self, path, body):
        return self.c.post(path, headers=self.h, json=body)

    def _request(self):
        user = backend.db['users']['tg303']
        prize = backend.add_prize(user, 'random', 'Big Gift', 50)
        with patch.object(backend, '_send_tg_async') as sent:
            r = self.c.post('/api/withdraw', json={'initData': signed_user(303), 'prize_id': prize['id']})
            self.assertEqual(r.status_code, 200)
        return f"tg303:{prize['id']}", prize, sent

    def test_large_request_notifies_admins(self):
        key, prize, sent = self._request()
        self.assertTrue(sent.called)
        self.assertEqual(backend.db['withdrawals'][key]['auto'], 'manual')

    def test_approve_without_relayer_fails_then_manual_completion_notifies_player(self):
        key, prize, _ = self._request()
        with patch.object(backend, '_send_tg_async') as sent:
            self.assertEqual(self.adm('/api/admin/withdrawals/resolve', {'id': key, 'action': 'approve'}).status_code, 200)
            req = backend.db['withdrawals'][key]
            self.assertEqual((req['status'], req['transfer']), ('approved', 'failed'))
            self.assertTrue(req['transfer_error'])
            d = self.adm('/api/admin/withdrawals/detail', {'id': key}).json
            self.assertEqual(d['request']['transfer'], 'failed')
            self.assertEqual(d['player']['telegram_id'], '303')
            self.assertEqual(self.adm('/api/admin/withdrawals/resolve', {'id': key, 'action': 'retry'}).status_code, 200)
            self.assertEqual(backend.db['withdrawals'][key]['transfer'], 'failed')
            sent.reset_mock()
            self.assertEqual(self.adm('/api/admin/withdrawals/resolve', {'id': key, 'action': 'complete'}).status_code, 200)
            self.assertEqual(backend.db['withdrawals'][key]['status'], 'completed')
            self.assertEqual(prize['status'], 'withdrawn')
            self.assertTrue(any(c.args[0] == 'tg303' for c in sent.call_args_list))


class VisibilityAdminTests(AdminUsersTests):
    def adm(self, path, body):
        return self.c.post(path, headers=self.h, json=body)

    def test_toggle_weapon_spin_and_lavka_visibility(self):
        post = lambda path, body=None: self.c.post(path, json={"initData": signed_user(303), **(body or {})})
        self.assertIn("sword", post("/api/state").json["weapon_hidden"])
        self.assertEqual(self.adm("/api/admin/weapons/visibility", {"id": "sword", "hidden": False}).status_code, 200)
        self.assertEqual(self.adm("/api/admin/weapons/visibility", {"id": "spin_turbo", "hidden": False}).status_code, 200)
        hidden = post("/api/state").json["weapon_hidden"]
        self.assertNotIn("sword", hidden)
        self.assertNotIn("spin_turbo", hidden)
        self.assertIn("mace", hidden)
        self.assertEqual(self.adm("/api/admin/weapons/visibility", {"id": "theme_meadow", "hidden": True}).status_code, 400)
        rows = self.adm("/api/admin/weapons", {}).json
        self.assertTrue(any(w["id"] == "sword" and not w["hidden"] for w in rows["weapons"]))
        self.assertTrue(any(w["id"] == "spin_wild" and not w["hidden"] for w in rows["spins"]))
        self.assertEqual(self.adm("/api/admin/lavka", {"section": "shop", "hidden": False}).json["hidden"]["shop"], False)
        self.assertEqual(self.adm("/api/admin/lavka", {"section": "quests", "hidden": True}).json["hidden"]["quests"], True)
        self.assertEqual(post("/api/state").json["lavka_hidden"], {"shop": False, "achievements": False, "quests": True})
        self.assertEqual(self.adm("/api/admin/lavka", {"section": "x", "hidden": True}).status_code, 400)


class DatabaseAdminTests(VisibilityAdminTests):
    def test_database_section(self):
        st = self.adm("/api/admin/database", {"action": "status"}).json
        self.assertEqual(st["kind"], "sqlite")
        self.assertFalse(st["mirror"]["active"])
        self.assertTrue(self.adm("/api/admin/database", {"action": "test", "backend": "sqlite"}).json["test"]["ok"])
        self.assertEqual(self.adm("/api/admin/database", {"action": "test", "backend": "postgres", "url": "mysql://x"}).status_code, 400)
        self.assertEqual(self.adm("/api/admin/database", {"action": "switch", "backend": "sqlite", "mode": "copy_current"}).status_code, 400)
        self.assertEqual(self.adm("/api/admin/database", {"action": "mirror"}).status_code, 400)
        self.assertEqual(self.adm("/api/admin/database", {"action": "bad"}).status_code, 400)

    def test_config_file_roundtrip_and_masking(self):
        import tempfile, os
        with patch.object(backend, "DBCFG_PATH", os.path.join(tempfile.mkdtemp(), "dbconfig.json")):
            self.assertIsNone(backend._read_dbcfg())
            backend._write_dbcfg("postgres", "postgresql://u:p@h/d")
            self.assertEqual(backend._read_dbcfg()["backend"], "postgres")
        self.assertEqual(backend._mask_url("postgresql://u:secret@h:5432/d"), "postgresql://u:***@h:5432/d")
        self.assertEqual(backend._normalize_pg_url("postgres://a@b/c"), "postgresql://a@b/c")


class HiddenRewardTests(VisibilityAdminTests):
    def test_hidden_reward_visible_only_for_receiver(self):
        post = lambda uid, path, body=None: self.c.post(path, json={"initData": signed_user(uid), **(body or {})})
        post(404, "/api/state"); post(405, "/api/state")
        backend.db["settings"]["level_rewards"] = {"1": {"kind": "weapon", "weapon": "mace"}}
        self.assertIn("mace", post(404, "/api/state").json["weapon_hidden"])
        self.assertEqual(post(404, "/api/level/claim", {"level": 1}).status_code, 200)
        self.assertNotIn("mace", post(404, "/api/state").json["weapon_hidden"])
        self.assertIn("mace", post(405, "/api/state").json["weapon_hidden"])


class ImportTests(VisibilityAdminTests):
    def make_file(self, users):
        import base64, json, sqlite3, tempfile, os
        path = os.path.join(tempfile.mkdtemp(), "x.sqlite3")
        conn = sqlite3.connect(path)
        conn.execute("CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)")
        doc = {"users": users, "settings": {"x": 1}, "promocodes": {"A": {}}}
        conn.execute("INSERT INTO kv VALUES ('db', ?)", (json.dumps(doc),))
        conn.commit(); conn.close()
        return base64.b64encode(open(path, "rb").read()).decode()

    def test_import_selected_sections(self):
        with patch.object(backend, "OWNER_ADMIN_ID", "101"):
            backend.db["users"]["tg777"] = {"balance": 1}
            data = self.make_file({"tg777": {"balance": 99}, "tg888": {"balance": 5}})
            r = self.adm("/api/admin/import", {"action": "analyze", "data": data}).json
            users = next(x for x in r["sections"] if x["id"] == "users")
            self.assertEqual((users["count"], users["existing"]), (2, 1))
            self.assertEqual(self.adm("/api/admin/import", {"action": "apply", "token": r["token"], "sections": ["bogus"]}).status_code, 400)
            done = self.adm("/api/admin/import", {"action": "apply", "token": r["token"], "sections": ["users"]}).json["done"]
            self.assertEqual(done, {"users": 2})
            self.assertEqual(backend.db["users"]["tg777"]["balance"], 99)
            self.assertNotIn("x", backend.db["settings"])
            self.assertEqual(self.adm("/api/admin/import", {"action": "analyze", "data": "AAAA"}).status_code, 400)
