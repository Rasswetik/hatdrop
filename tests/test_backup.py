import unittest

from test_admin_dashboard import backend, signed_user


class BackupTests(unittest.TestCase):
    def setUp(self):
        backend.db = {"users": {}, "prices": {}, "settings": {}, "withdrawals": {}, "promocodes": {}, "quests": {}}
        backend.app.config.update(TESTING=True, SESSION_COOKIE_SECURE=False)
        self.c = backend.app.test_client()
        self.c.post("/api/state", json={"initData": signed_user(202)})

    def test_roundtrip_restore(self):
        raw = backend.backup_bytes()
        backend.db["users"]["tg202"]["balance"] = 999
        backend.db["users"]["tgX"] = {"id": "tgX"}
        self.assertEqual(backend.restore_backup(raw), 1)
        self.assertNotIn("tgX", backend.db["users"])
        self.assertNotEqual(backend.db["users"]["tg202"]["balance"], 999)

    def test_bad_file_rejected(self):
        with self.assertRaises(backend.ApiError):
            backend.restore_backup(b"not a backup")
        self.assertIn("tg202", backend.db["users"])


if __name__ == "__main__":
    unittest.main()
