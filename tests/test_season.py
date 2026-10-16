import time
import unittest
from unittest import mock

from test_admin_dashboard import backend, signed_user
import season

PAGE = ('<meta property="og:title" content="Plush Pepe #1234 – Telegram">'
        '<meta property="og:description" content="Model: Cozy 1.5%\nBackdrop: Black 2%\nSymbol: Star 3%">')


class SeasonLibTests(unittest.TestCase):
    def test_link_and_page_parsing(self):
        self.assertEqual(season.nft_slug("https://t.me/nft/PlushPepe-1234"), "PlushPepe-1234")
        for bad in ("https://example.com/nft/PlushPepe-1", "https://t.me/nft/PlushPepe", "x"):
            with self.assertRaises(ValueError):
                season.nft_slug(bad)
        info = season.parse_nft_page(PAGE)
        self.assertEqual((info["title"], info["model"], info["backdrop"]), ("Plush Pepe #1234", "Cozy", "Black"))
        self.assertEqual(season.collection_title("PlushPepe-1234"), "Plush Pepe")
        self.assertEqual(season.duration_seconds({"days": 3}), 3 * 86400)
        with self.assertRaises(ValueError):
            season.duration_seconds({"days": 0})


class SeasonTests(unittest.TestCase):
    def setUp(self):
        backend.db = {"users": {}, "prices": {}, "settings": {}, "withdrawals": {}, "promocodes": {}, "quests": {}}
        backend.app.config.update(TESTING=True, SESSION_COOKIE_SECURE=False)
        self.c = backend.app.test_client()
        for uid in (101, 202, 303):
            self.c.post("/api/state", json={"initData": signed_user(uid)})
        catalog = {"plushpepe": {"name": "Plush Pepe", "floor": 100.0, "models": [{"model": "Cozy", "floor": 200.0}]}}
        self.sent = []
        for p in (mock.patch.object(backend, "CATALOG", catalog), mock.patch.object(backend, "season_fetch_nft_page", lambda slug: PAGE),
                  mock.patch.object(backend, "_send_tg_async", lambda *a, **k: self.sent.append(a))):
            p.start()
            self.addCleanup(p.stop)
        ticket = self.c.post("/api/admin/session", json={"initData": signed_user(101)}).json["ticket"]
        self.c.post("/admin/login", json={"ticket": ticket})
        with self.c.session_transaction() as s:
            self.h = {"X-Admin-CSRF": s["admin_csrf"]}

    def admin(self, path, **body):
        return self.c.post(path, headers=self.h, json=body)

    def test_resolve_nft_uses_model_price_minus_15_and_gift_uses_catalog(self):
        r = self.admin("/api/admin/season/resolve", kind="nft", url="https://t.me/nft/PlushPepe-1234").json["prize"]
        self.assertEqual((r["value"], r["portal_ton"], r["basis"], r["model"]), (170.0, 200.0, "model", "Cozy"))
        self.assertTrue(r["image"].startswith("/nft-img/plushpepe-1234"))
        g = self.admin("/api/admin/season/resolve", kind="gift", gift="plushpepe", model="").json["prize"]
        self.assertEqual(g["value"], 100.0)
        self.assertEqual(self.admin("/api/admin/season/resolve", kind="nft", url="nope").status_code, 400)

    def test_season_flow_ranking_prizes_and_awards(self):
        r = self.admin("/api/admin/season/start", name="Сезон 1", days=3, prizes={
            "1": {"kind": "nft", "url": "https://t.me/nft/PlushPepe-1234"}, "2": {"kind": "gift", "gift": "plushpepe"}})
        self.assertEqual(r.status_code, 200, r.json)
        self.assertEqual(self.admin("/api/admin/season/start", days=1).status_code, 409)  # already running
        u2, u3 = backend.db["users"]["tg202"], backend.db["users"]["tg303"]
        for u, cost in ((u2, 5.0), (u3, 9.0)):
            u["games"] = 1
            backend.record_game(u, "upgrade", cost, False, "t", "", 0)
        lb = self.c.post("/api/leaderboard", json={"initData": signed_user(202)}).json
        self.assertFalse(lb["alltime"])
        self.assertEqual([x["rank"] for x in lb["rows"]], [1, 2])
        self.assertEqual(lb["rows"][0]["total_ton"], 9.0)
        self.assertEqual(lb["rows"][0]["prize"]["kind"], "nft")
        self.assertEqual(lb["rows"][1]["prize"]["kind"], "gift")
        self.assertEqual(lb["me"]["rank"], 2)
        r = self.admin("/api/admin/season/finish")
        self.assertEqual(len(r.json["current"]["winners"]), 2)
        nft = next(p for p in u3["prizes"] if str(p["tier"]).startswith("nft:"))
        self.assertEqual((nft["value"], nft["nft_slug"], nft["sell_rate"]), (170.0, "PlushPepe-1234", 1.0))
        self.assertTrue(any(str(p["tier"]).startswith("gift:plushpepe") for p in u2["prizes"]))
        self.assertTrue(any("успешно" not in str(m[1]) and "1 место" in str(m[1]) for m in self.sent))
        lb = self.c.post("/api/leaderboard", json={"initData": signed_user(202)}).json
        self.assertTrue(lb["finished"])
        self.assertEqual(self.admin("/api/admin/season/finish").status_code, 409)
        self.assertEqual(self.admin("/api/admin/season/clear").json["current"], None)
        self.assertTrue(self.c.post("/api/leaderboard", json={"initData": signed_user(202)}).json["alltime"])

    def test_expiry_awards_automatically_and_places_without_players_skipped(self):
        self.admin("/api/admin/season/start", name="S", hours=1, prizes={"1": {"kind": "gift", "gift": "plushpepe"}, "5": {"kind": "gift", "gift": "plushpepe"}})
        u = backend.db["users"]["tg202"]
        u["games"] = 1
        backend.record_game(u, "upgrade", 2.0, False, "t", "", 0)
        backend.db["season"]["current"]["end"] = int(time.time()) - 1
        self.assertTrue(backend.season_tick())
        self.assertEqual(len(backend.db["season"]["current"]["winners"]), 1)
        self.assertEqual(len(u["prizes"]), 1)
        self.assertFalse(backend.season_tick())  # not awarded twice

    def test_games_outside_season_do_not_count(self):
        u = backend.db["users"]["tg202"]
        u["games"] = 1
        backend.record_game(u, "upgrade", 3.0, False, "t", "", 0)
        self.assertEqual(u.get("season_turnover"), None)
