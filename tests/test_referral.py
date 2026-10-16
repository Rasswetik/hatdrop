import hashlib
import hmac
import json
import time
import unittest
from urllib.parse import urlencode

from test_admin_dashboard import backend


def signed(uid, start_param=None):
    pairs = {"auth_date": str(int(time.time())), "user": json.dumps({"id": uid, "first_name": "T"})}
    if start_param:
        pairs["start_param"] = start_param
    secret = hmac.new(b"WebAppData", b"test-token", hashlib.sha256).digest()
    pairs["hash"] = hmac.new(secret, "\n".join(f"{k}={v}" for k, v in sorted(pairs.items())).encode(), hashlib.sha256).hexdigest()
    return urlencode(pairs)


class ReferralTests(unittest.TestCase):
    def setUp(self):
        backend.db = {"users": {}, "prices": {}, "settings": {"bot_username": "hatbot"}, "withdrawals": {}, "promocodes": {}, "quests": {}}
        backend.app.config.update(TESTING=True, SESSION_COOKIE_SECURE=False)
        self.c = backend.app.test_client()

    def post(self, path, uid, **extra):
        return self.c.post(path, json={"initData": signed(uid, extra.pop("start_param", None)), **extra})

    def test_create_link_bind_and_bonus_and_withdraw(self):
        self.assertFalse(self.post("/api/state", 1).json["referral"]["created"])
        ref = self.post("/api/referral/create", 1).json["referral"]
        key = backend.db["users"]["tg1"]["key"]
        self.assertEqual(ref["link"], f"https://t.me/hatbot?startapp=ref_{key}")
        self.post("/api/state", 2, start_param=f"ref_{key}")
        self.assertEqual(backend.db["users"]["tg2"]["ref_by"], "tg1")
        # Self-referral and later re-binding are ignored.
        self.post("/api/state", 1, start_param=f"ref_{key}")
        self.assertNotIn("ref_by", backend.db["users"]["tg1"])
        self.assertEqual(self.post("/api/state", 1).json["referral"]["count"], 1)
        self.assertEqual(backend.credit_referral_bonus(backend.db["users"]["tg2"], 20), 2.0)
        before = backend.db["users"]["tg1"]["balance"]
        self.assertEqual(self.post("/api/referral/withdraw", 1).status_code, 200)
        self.assertEqual(backend.db["users"]["tg1"]["balance"], before + 2.0)
        self.assertEqual(self.post("/api/referral/withdraw", 1).status_code, 400)

    def test_unknown_or_uncreated_link_is_ignored(self):
        self.post("/api/state", 1)
        key = backend.db["users"]["tg1"]["key"]
        self.post("/api/state", 3, start_param=f"ref_{key}")
        self.assertNotIn("ref_by", backend.db["users"]["tg3"])


if __name__ == "__main__":
    unittest.main()
