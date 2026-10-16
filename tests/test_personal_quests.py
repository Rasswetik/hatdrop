import unittest
from unittest import mock

from test_admin_dashboard import backend, signed_user


class PersonalQuestTests(unittest.TestCase):
    def setUp(self):
        backend.db = {"users": {}, "prices": {}, "settings": {"quests_enabled": False}, "withdrawals": {}, "promocodes": {}, "quests": {}}
        backend.app.config.update(TESTING=True, SESSION_COOKIE_SECURE=False)
        self.c = backend.app.test_client()
        for uid in (101, 202, 303):
            self.c.post("/api/state", json={"initData": signed_user(uid)})
        self.u2, self.u3 = backend.db["users"]["tg202"], backend.db["users"]["tg303"]
        self.sent = []
        patcher = mock.patch.object(backend, "_send_tg_async", lambda *a, **k: self.sent.append(a))
        patcher.start()
        self.addCleanup(patcher.stop)
        ticket = self.c.post("/api/admin/session", json={"initData": signed_user(101)}).json["ticket"]
        self.c.post("/admin/login", json={"ticket": ticket})
        with self.c.session_transaction() as s:
            self.h = {"X-Admin-CSRF": s["admin_csrf"]}

    def admin(self, path, **body):
        return self.c.post(path, headers=self.h, json=body)

    def player(self, path, uid=202, **body):
        return self.c.post(path, json={"initData": signed_user(uid), **body})

    def test_personal_quest_visible_only_to_owner_progress_and_claim_without_global_launch(self):
        r = self.admin("/api/admin/user/quests/save", key=self.u2["key"], action="create", kind="wheel_spins", goal=2, reward_type="ton", reward_amount=1.5)
        self.assertEqual(r.status_code, 200, r.json)
        qid = r.json["rows"][0]["id"]
        self.assertTrue(self.sent and "личный квест" in self.sent[0][1])
        mine = self.player("/api/quests").json
        self.assertTrue(mine["enabled"])  # global launch is off, personal quests still show
        self.assertEqual([x["id"] for x in mine["rows"]], [qid])
        self.assertEqual(self.player("/api/quests", uid=303).json["rows"], [])
        for _ in range(2):
            backend.quest_event(backend.db, self.u2, "wheel_spin")
            backend.quest_event(backend.db, self.u3, "wheel_spin")
        self.assertNotIn(qid, self.u3.get("quest_progress", {}))
        before = self.u2["balance"]
        self.assertEqual(self.player("/api/quests/claim", id=qid).status_code, 200)
        self.assertEqual(self.u2["balance"], before + 1.5)
        self.assertEqual(self.player("/api/quests/claim", id=qid, uid=303).status_code, 400)
        rows = self.admin("/api/admin/user/quests", key=self.u2["key"]).json["rows"]
        self.assertTrue(rows[0]["progress"]["claimed"])
        # global admin list does not include personal quests
        self.assertEqual(self.admin("/api/admin/quests").json["rows"], [])

    def test_validation_delete_and_ownership(self):
        bad = self.admin("/api/admin/user/quests/save", key=self.u2["key"], action="create", kind="wheel_spins", goal=0, reward_amount=1)
        self.assertEqual(bad.status_code, 400)
        qid = self.admin("/api/admin/user/quests/save", key=self.u2["key"], action="create", kind="turnover", goal=5, reward_amount=1).json["rows"][0]["id"]
        self.assertEqual(self.admin("/api/admin/user/quests/save", key=self.u3["key"], action="delete", id=qid).status_code, 404)
        self.assertEqual(self.admin("/api/admin/user/quests/save", key=self.u2["key"], action="delete", id=qid).json["rows"], [])
