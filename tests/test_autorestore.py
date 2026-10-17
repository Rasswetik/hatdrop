import io
import unittest
from unittest.mock import patch

from test_admin_dashboard import backend


class AutoRestoreTests(unittest.TestCase):
    def test_restores_from_pinned_backup_when_empty(self):
        backend.db = {"users": {"tg1": {"id": "tg1", "balance": 5, "key": "k"}}, "prices": {}, "settings": {}, "withdrawals": {}, "promocodes": {}, "quests": {}}
        raw = backend.backup_bytes()
        backend.db = {"users": {}, "prices": {}, "settings": {}, "withdrawals": {}, "promocodes": {}, "quests": {}}

        def fake_api(method, **kw):
            if method == "getChat":
                return {"pinned_message": {"document": {"file_name": "hatdrop-backup-1.json.gz", "file_id": "f"}}}
            if method == "getFile":
                return {"file_path": "x/y"}
            raise AssertionError(method)

        class Resp(io.BytesIO):
            def __enter__(self): return self
            def __exit__(self, *a): return False

        with patch.dict(backend.os.environ, {"AUTO_RESTORE": "1"}), patch.object(backend, "BOT_TOKEN", "test-token"), patch.object(backend, "tg_api", fake_api), \
                patch.object(backend.urllib.request, "urlopen", lambda *a, **k: Resp(raw)), \
                patch.object(backend, "flush_db"), patch.object(backend, "flush_quests"), patch.object(backend, "store_put"):
            self.assertEqual(backend.auto_restore_if_empty(), 1)
        self.assertEqual(backend.db["users"]["tg1"]["balance"], 5)

    def test_does_nothing_when_db_has_users(self):
        backend.db = {"users": {"tg1": {}}}
        with patch.object(backend, "BOT_TOKEN", "test-token"):
            self.assertEqual(backend.auto_restore_if_empty(), 0)
