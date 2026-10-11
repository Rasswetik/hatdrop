import base64
import json
from pathlib import Path
import tempfile
import unittest
from decimal import Decimal
from unittest.mock import patch

from test_admin_dashboard import backend, signed_user


class HatcoinTests(unittest.TestCase):
    def setUp(self):
        backend.db = {"users": {}, "prices": {}, "settings": {}, "withdrawals": {}, "promocodes": {}}
        backend.app.config.update(TESTING=True)
        self.client = backend.app.test_client()
        self.post("/api/state")
        self.user = backend.db["users"]["tg202"]
        self.user["balance"] = 100

    def post(self, path, body=None):
        return self.client.post(path, json={"initData": signed_user(202), **(body or {})})

    def start(self, bet=5):
        response = self.post("/api/chests/start", {"bet": bet, "empties": 3})
        self.assertEqual(response.status_code, 200)
        return response.json

    def lose(self):
        return self.post("/api/chests/open", {"cell": self.user["chest"]["bad"][0]})

    def test_coin_immediately_earned_and_kept_after_loss(self):
        result = self.start()
        self.assertEqual(result["hatcoin_balance"], .5)
        self.assertEqual(result["balance_ton"], 95)
        self.assertEqual(self.user["games"], 0)
        result = self.lose().json
        self.assertFalse(result["win"])
        self.assertEqual(result["hatcoin_balance"], .5)
        self.assertEqual(self.post("/api/state").json["hatcoin"], {"balance": .5, "rate_per_ton": .1})
        self.assertEqual(self.lose_finished().status_code, 400)
        self.assertEqual(backend.hatcoin_balance(self.user), .5)

    def lose_finished(self):
        return self.post("/api/chests/open", {"cell": 0})

    def test_cashout_and_invalid_requests_do_not_duplicate_coin(self):
        self.start()
        self.assertEqual(self.post("/api/chests/start", {"bet": 5, "empties": 3}).json["error"], "round_active")
        self.assertEqual(self.post("/api/chests/open", {"cell": -1}).status_code, 400)
        safe = next(i for i in range(backend.CHEST_CELLS) if i not in self.user["chest"]["bad"])
        self.post("/api/chests/open", {"cell": safe})
        with patch.object(backend, "pick_gift_for", return_value=None):
            result = self.post("/api/chests/cashout").json
        self.assertTrue(result["win"])
        self.assertEqual(result["hatcoin_balance"], .5)
        self.assertEqual(self.post("/api/chests/cashout").status_code, 400)
        self.user["balance"] = 0
        for body in ({"bet": 5, "empties": 3}, {"bet": -5, "empties": 3}, {"bet": 1, "empties": 30}, {"prize_id": 999, "empties": 3}):
            self.assertEqual(self.post("/api/chests/start", body).status_code, 400)
        self.assertEqual(backend.hatcoin_balance(self.user), .5)

    def test_upgrade_uses_actual_price_for_win_and_loss(self):
        earned = Decimal(0)
        for outcome in (0, 999999):
            before = self.user["balance"]
            with patch.object(backend.secrets, "randbelow", return_value=outcome):
                response = self.post("/api/spin", {"tier": "random", "chance": .5})
            self.assertEqual(response.status_code, 200)
            cost = self.user["history"][0]["cost_ton"]
            earned += Decimal(str(cost)) * Decimal(".1")
            self.assertEqual(response.json["hatcoin_balance"], float(earned))
            self.assertEqual(response.json["balance_ton"], backend.ton(before - cost))
            self.assertEqual(response.json["win"], outcome == 0)
        for body in ({"chance": 2}, {"chance": .505}, {"tier": "gift", "gift": "missing", "chance": .5}):
            self.assertEqual(self.post("/api/spin", body).status_code, 400)
        self.user["balance"] = 0
        self.assertEqual(self.post("/api/spin", {"tier": "random", "chance": .5}).json["error"], "insufficient_funds")
        self.assertEqual(backend.hatcoin_balance(self.user), float(earned))

    def test_precise_accumulation_persistence_and_identity_isolation(self):
        for _ in range(31):
            self.start(.1)
            self.lose()
        self.assertEqual(self.user["hatcoin_units"], 310000)
        self.assertEqual(backend.hatcoin_balance(self.user), .31)
        backend.db = json.loads(json.dumps(backend.db))
        self.assertEqual(self.post("/api/state").json["hatcoin"]["balance"], .31)
        demo = self.client.post("/api/state", json={"demoId": "coin-demo", "hatcoin_units": 999999999}).json
        self.assertEqual(demo["hatcoin"]["balance"], 0)
        self.client.post("/api/chests/start", json={"demoId": "coin-demo", "bet": 1, "empties": 3})
        self.assertEqual(self.post("/api/state").json["hatcoin"]["balance"], .31)
        old_user = backend.db["users"]["tg202"]
        del old_user["hatcoin_units"]
        old_user["turnover"] = 500
        self.assertEqual(self.post("/api/state").json["hatcoin"]["balance"], 0)

    def test_sales_promos_and_refresh_do_not_earn_coin(self):
        prize = backend.add_prize(self.user, "random", "Gift", 3)
        self.assertEqual(self.post("/api/sell", {"prize_id": prize["id"]}).status_code, 200)
        backend.db["promocodes"]["COINTEST"] = {"kind": "balance", "amount": 5}
        self.assertEqual(self.post("/api/promo", {"code": "COINTEST"}).status_code, 200)
        self.assertEqual(self.post("/api/state", {"hatcoin": {"balance": 999}}).json["hatcoin"]["balance"], 0)

    def test_png_preferred_with_real_svg_fallback(self):
        fallback = self.client.get("/images/hatcoin.png")
        self.assertEqual(fallback.mimetype, "image/svg+xml")
        self.assertIn("Шляпа Coin", fallback.get_data(as_text=True))
        self.assertEqual(fallback.headers["Cache-Control"], "no-cache")
        png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6N8AAAAASUVORK5CYII=")
        with tempfile.TemporaryDirectory() as folder:
            Path(folder, "images").mkdir()
            Path(folder, "images", "hatcoin.png").write_bytes(png)
            with patch.object(backend, "BASE_DIR", folder):
                response = self.client.get("/images/hatcoin.png")
                self.assertEqual(response.mimetype, "image/png")
                self.assertEqual(response.data, png)
                response.close()


if __name__ == "__main__":
    unittest.main()
