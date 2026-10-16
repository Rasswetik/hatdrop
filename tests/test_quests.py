import json
import time
import unittest

from test_admin_dashboard import backend, signed_user
import quest_engine


def fresh_db():
    return {"users": {}, "prices": {}, "settings": {"quests_enabled": True}, "withdrawals": {}, "promocodes": {}, "quests": {}}


class QuestTests(unittest.TestCase):
    def setUp(self):
        backend.db = fresh_db()
        backend.app.config.update(TESTING=True, SESSION_COOKIE_SECURE=False)
        self.client = backend.app.test_client()
        self.post("/api/state", uid=202)
        self.user = backend.db["users"]["tg202"]
        self.user["balance"] = 10

    def post(self, path, body=None, uid=202):
        return self.client.post(path, json={"initData": signed_user(uid), **(body or {})})

    def add_quest(self, **extra):
        quest = quest_engine.validate({"kind": "wheel_spins", "goal": 2, "reward_amount": 1.5, "active": True, **extra})
        qid = "q" + str(len(backend.db["quests"]) + 1)
        backend.db["quests"][qid] = {**quest, "id": qid, "created": int(time.time()), "version": 1}
        return qid

    def test_expired_quest_stays_listed_and_finished_one_is_claimable(self):
        past = int(time.time()) - 3600
        qid = self.add_quest(start_at=past - 7200, end_at=past)
        # Finished before the deadline, claimed after it.
        self.user["quest_progress"] = {qid: {"version": 1, "value": 2, "started_at": past - 600}}
        rows = self.post("/api/quests").json["rows"]
        self.assertEqual([r["id"] for r in rows], [qid])
        self.assertTrue(rows[0]["progress"]["expired"])
        self.assertTrue(rows[0]["progress"]["completed"])
        self.assertEqual(self.post("/api/quests/claim", {"id": qid}).status_code, 200)
        self.assertEqual(self.user["balance"], 11.5)
        self.assertEqual(self.post("/api/quests/claim", {"id": qid}).status_code, 400)
        self.assertTrue(self.post("/api/quests").json["rows"][0]["progress"]["claimed"])

    def test_unfinished_expired_quest_cannot_be_claimed_but_is_not_removed(self):
        past = int(time.time()) - 60
        qid = self.add_quest(start_at=past - 600, end_at=past)
        self.assertEqual(self.post("/api/quests/claim", {"id": qid}).status_code, 400)
        self.assertEqual(len(self.post("/api/quests").json["rows"]), 1)

    def test_progress_is_not_counted_after_deadline(self):
        past = int(time.time()) - 60
        qid = self.add_quest(start_at=past - 600, end_at=past)
        quest_engine.record_event(backend.db, self.user, "wheel_spin")
        self.assertEqual(self.user.get("quest_progress", {}).get(qid, {}).get("value", 0), 0)

    def test_record_event_reports_completion_once(self):
        qid = self.add_quest()
        self.assertEqual(quest_engine.record_event(backend.db, self.user, "wheel_spin"), [])
        self.assertEqual(quest_engine.record_event(backend.db, self.user, "wheel_spin"), [qid])
        self.assertEqual(quest_engine.record_event(backend.db, self.user, "wheel_spin"), [])

    def test_quest_definitions_have_their_own_durable_record(self):
        qid = self.add_quest()
        backend.db["settings"]["quests_enabled"] = False
        backend.flush_quests()
        stored = json.loads(backend.store_get(backend.QUESTS_KEY, backend.QUESTS_PATH))
        self.assertIn(qid, stored["quests"])
        self.assertFalse(stored["enabled"])
        # A reload from the dedicated record restores quests even if the main document lost them.
        backend.db["quests"] = {}
        backend.db["settings"]["quests_enabled"] = True
        backend.load_quests()
        self.assertIn(qid, backend.db["quests"])
        self.assertFalse(backend.db["settings"]["quests_enabled"])
        backend.db["settings"]["quests_enabled"] = True
        backend.flush_quests()

    def test_claim_and_milestone_are_flushed_to_the_database(self):
        qid = self.add_quest()
        self.user["quest_progress"] = {qid: {"version": 1, "value": 2, "started_at": int(time.time())}}
        self.assertEqual(self.post("/api/quests/claim", {"id": qid}).status_code, 200)
        saved = json.loads(backend.store_get("db", backend.DB_PATH))
        self.assertTrue(saved["users"]["tg202"]["quest_progress"][qid]["claimed"])
        self.assertEqual(saved["users"]["tg202"]["balance"], 11.5)

    def test_admin_save_persists_definition_immediately(self):
        ticket = self.post("/api/admin/session", uid=101).json["ticket"]
        self.assertEqual(self.client.post("/admin/login", json={"ticket": ticket}).status_code, 200)
        with self.client.session_transaction() as session:
            headers = {"X-Admin-CSRF": session["admin_csrf"]}
        response = self.client.post("/api/admin/quests/save", headers=headers, json={
            "action": "create", "kind": "wheel_spins", "goal": 3, "reward_amount": 2, "active": True})
        self.assertEqual(response.status_code, 200)
        stored = json.loads(backend.store_get(backend.QUESTS_KEY, backend.QUESTS_PATH))
        self.assertEqual(len(stored["quests"]), 1)
        self.assertEqual(next(iter(stored["quests"].values()))["goal"], 3)


if __name__ == "__main__":
    unittest.main()
