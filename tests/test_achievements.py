import time
import unittest

from test_admin_dashboard import backend, signed_user
import quest_engine
import weapons


class AchievementTests(unittest.TestCase):
    def setUp(self):
        backend.db = {"users": {}, "prices": {}, "settings": {"quests_enabled": False}, "withdrawals": {}, "promocodes": {}, "quests": {}}
        backend.app.config.update(TESTING=True, SESSION_COOKIE_SECURE=False)
        self.c = backend.app.test_client()
        self.post("/api/state")
        self.user = backend.db["users"]["tg202"]

    def post(self, path, body=None):
        return self.c.post(path, json={"initData": signed_user(202), **(body or {})})

    def add(self, **extra):
        q = quest_engine.validate({"kind": "wheel_spins", "goal": 1, "reward_amount": 0.5, "active": True, **extra})
        qid = "q" + str(len(backend.db["quests"]) + 1)
        backend.db["quests"][qid] = {**q, "id": qid, "created": int(time.time()), "version": 1}
        return qid

    def test_seed_creates_20_permanent_achievements(self):
        backend.db["settings"].pop("achievements_seeded", None)
        backend.seed_achievements()
        rows = [q for q in backend.db["quests"].values() if q["achievement"]]
        self.assertEqual(len(rows), 20)
        self.assertTrue(all(q["end_at"] == 0 and q["start_at"] == 0 and q["duration_hours"] == 0 for q in rows))
        backend.seed_achievements()
        self.assertEqual(len([q for q in backend.db["quests"].values() if q["achievement"]]), 20)

    def test_achievement_ignores_dates_and_works_without_global_launch(self):
        qid = self.add(achievement=True, start_at=1, end_at=2, duration_hours=5)
        self.assertEqual((backend.db["quests"][qid]["end_at"], backend.db["quests"][qid]["duration_hours"]), (0, 0))
        rows = self.post("/api/quests").json["rows"]
        self.assertEqual([r["id"] for r in rows], [qid])
        quest_engine.record_event(backend.db, self.user, "wheel_spin")
        r = self.post("/api/quests/claim", {"id": qid})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.post("/api/quests/claim", {"id": qid}).status_code, 400)

    def test_weapon_reward_unlocks_weapon(self):
        self.assertNotIn("sword", weapons.owned(self.user))
        qid = self.add(achievement=True, reward_type="weapon", reward_weapon="sword")
        quest_engine.record_event(backend.db, self.user, "wheel_spin")
        r = self.post("/api/quests/claim", {"id": qid})
        self.assertIn("sword", r.json["weapons"])
        self.assertIn("sword", self.post("/api/state").json["weapons"])
        with self.assertRaises(ValueError):
            quest_engine.validate({"kind": "wheel_spins", "goal": 1, "reward_type": "weapon", "reward_weapon": "axe"})


if __name__ == "__main__":
    unittest.main()
