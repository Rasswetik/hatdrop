import os, hmac, hashlib, json, logging, secrets, sqlite3, tempfile, threading, time, urllib.request, urllib.error, re
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qsl, quote
from flask import Flask, render_template, jsonify, request, Response, has_request_context

app = Flask(__name__)
logging.basicConfig(level=logging.INFO)
POSTSQL = (os.environ.get('POSTSQL') or '').strip()
DB_PATH = os.environ.get('DB_PATH', os.path.join(app.root_path, 'data.sqlite3'))
DB_KIND = 'postgres' if POSTSQL else 'sqlite'
if DB_KIND == 'postgres':
    try:
        import psycopg
        from psycopg.rows import dict_row
    except ImportError:
        raise RuntimeError('POSTSQL задан, но psycopg не установлен. Добавьте psycopg[binary] в requirements.txt.')

class PGConnection:
    def __init__(self, url):
        self.raw = psycopg.connect(url, row_factory=dict_row, autocommit=False)
    def execute(self, sql, params=()):
        return self.raw.execute(sql.replace('?', '%s'), params or ())
    def executescript(self, script):
        for stmt in re.split(r';\\s*(?=CREATE|ALTER|INSERT|UPDATE|DELETE)', script.strip(), flags=re.I):
            stmt = stmt.strip()
            if stmt:
                self.raw.execute(stmt)
    def commit(self): self.raw.commit()
    def rollback(self): self.raw.rollback()
    def close(self): self.raw.close()

# ┌─────────────────────────────────────────────────────────────────────┐
# │  ВСТАВЬ ТОКЕН БОТА СЮДА (из @BotFather), между кавычками:           │
# │  (или задай переменную окружения BOT_TOKEN — она главнее)           │
# └─────────────────────────────────────────────────────────────────────┘
BOT_TOKEN = os.environ.get('BOT_TOKEN') or ''

# https-адрес мини-аппа для кнопки «Открыть апгрейд». На Render (и Railway)
# определяется сам; на другом хостинге впиши сюда или в переменную WEBAPP_URL.
WEBAPP_URL = os.environ.get('WEBAPP_URL') or ''

# Имя бота нужно только для реф-ссылок; при запущенном боте берётся само (getMe).
BOT_USERNAME = os.environ.get('BOT_USERNAME', '').strip()
_BOT_USERNAME_RESOLVED = ''

REFERRAL_PERCENT = 2.0
HAT_PRICE = 7.0
CONNECT_BONUS = 10.0
MIN_DEPOSIT = 0.1
MIN_REF_WITHDRAW = 1.0
PRIZE_NAME = 'Шляпа волшебника'
TOPUP_AMOUNT = 10.0          # сколько TON даёт одно нажатие «Пополнить баланс»
# Ползунок ставки: любой шанс от CHANCE_MIN до CHANCE_MAX процентов, цена ставки
# = шанс × цена шляпы (10% → 0.7, 25% → 1.75, 50% → 3.5, 75% → 5.25 TON).
CHANCE_MIN, CHANCE_MAX, CHANCE_DEFAULT = 1, 80, 50
CHANCE_MARKS = (1, 50, 80)  # подписанные метки под ползунком
DEPOSIT_ADDRESS = os.environ.get('DEPOSIT_ADDRESS', '')
DEPOSIT_MEMO = os.environ.get('DEPOSIT_MEMO', '')

os.makedirs(os.path.dirname(DB_PATH) or '.', exist_ok=True)

# Простой анти-спам для /api/spin: id пользователя -> время последнего спина.
# Раньше это сравнивалось строкой с CURRENT_TIMESTAMP из SQLite (UTC) против
# time.strftime (локальное время сервера) — сравнение почти никогда не
# совпадало правильно. In-memory словарь с time.time() работает предсказуемо.
_last_spin_at = {}


def db():
    """Контекстный менеджер для соединения с БД.

    Раньше это была обычная функция, возвращавшая sqlite3.Connection: код
    везде использовал `with db() as conn:`, и это действительно вызывало
    conn.commit()/rollback() (родное поведение sqlite3.Connection как
    контекстного менеджера) — НО НЕ ЗАКРЫВАЛО соединение. Каждый запрос
    (а фронтенд опрашивает /api/state каждые 20 секунд для каждого игрока)
    открывал новое соединение с файлом БД и никогда его не освобождал.
    Со временем процесс упирался в лимит открытых файловых дескрипторов —
    и вот тогда как раз начинали сыпаться случайные "ошибка сервера" на
    ровном месте, без видимой закономерности. Теперь соединение всегда
    закрывается через finally, независимо от результата.
    """
    return _db_ctx()


@contextmanager
def _db_ctx():
    if DB_KIND == 'postgres':
        conn = PGConnection(POSTSQL)
    else:
        conn = sqlite3.connect(DB_PATH, timeout=15)
        conn.row_factory = sqlite3.Row
        conn.execute('PRAGMA busy_timeout=15000')
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    if DB_KIND == 'postgres':
        schema = """
        CREATE TABLE IF NOT EXISTS users (
            id BIGSERIAL PRIMARY KEY, tg_id BIGINT UNIQUE NOT NULL,
            username TEXT DEFAULT '', first_name TEXT DEFAULT '', last_name TEXT DEFAULT '',
            photo_url TEXT DEFAULT '', wallet_address TEXT DEFAULT '',
            balance DOUBLE PRECISION NOT NULL DEFAULT 0,
            referral_earnings DOUBLE PRECISION NOT NULL DEFAULT 0,
            referral_balance DOUBLE PRECISION NOT NULL DEFAULT 0,
            referral_created INTEGER NOT NULL DEFAULT 0, referred_by BIGINT,
            bonus_claimed INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS inventory (
            id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL,
            item_type TEXT NOT NULL, item_name TEXT NOT NULL, item_price DOUBLE PRECISION NOT NULL,
            status TEXT NOT NULL DEFAULT 'owned', created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS upgrades (
            id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL,
            price DOUBLE PRECISION NOT NULL, probability DOUBLE PRECISION NOT NULL, won INTEGER NOT NULL,
            angle DOUBLE PRECISION NOT NULL DEFAULT 0, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS deposits (
            id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL,
            amount DOUBLE PRECISION NOT NULL, source TEXT NOT NULL DEFAULT 'internal', tx_hash TEXT DEFAULT '',
            status TEXT NOT NULL DEFAULT 'confirmed', created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS referral_withdrawals (
            id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL,
            amount DOUBLE PRECISION NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_inventory_user ON inventory(user_id);
        CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users(referred_by);
        CREATE INDEX IF NOT EXISTS idx_deposits_user ON deposits(user_id);
        CREATE INDEX IF NOT EXISTS idx_refwd_user ON referral_withdrawals(user_id);
        """
        with db() as conn:
            conn.executescript(schema)
            cols = {r['column_name'] for r in conn.execute("SELECT column_name FROM information_schema.columns WHERE table_name='users'").fetchall()}
            migrations = {
                'wallet_address': "ALTER TABLE users ADD COLUMN wallet_address TEXT DEFAULT ''",
                'referral_balance': "ALTER TABLE users ADD COLUMN referral_balance DOUBLE PRECISION NOT NULL DEFAULT 0",
                'referral_created': "ALTER TABLE users ADD COLUMN referral_created INTEGER NOT NULL DEFAULT 0",
                'bonus_claimed': "ALTER TABLE users ADD COLUMN bonus_claimed INTEGER NOT NULL DEFAULT 0",
            }
            for col, sql in migrations.items():
                if col not in cols: conn.execute(sql)
            icols = {r['column_name'] for r in conn.execute("SELECT column_name FROM information_schema.columns WHERE table_name='inventory'").fetchall()}
            if 'status' not in icols: conn.execute("ALTER TABLE inventory ADD COLUMN status TEXT NOT NULL DEFAULT 'owned'")
            ucols = {r['column_name'] for r in conn.execute("SELECT column_name FROM information_schema.columns WHERE table_name='upgrades'").fetchall()}
            if 'angle' not in ucols: conn.execute("ALTER TABLE upgrades ADD COLUMN angle DOUBLE PRECISION NOT NULL DEFAULT 0")
        return

    with db() as conn:
        conn.executescript('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tg_id INTEGER UNIQUE NOT NULL,
            username TEXT DEFAULT '', first_name TEXT DEFAULT '', last_name TEXT DEFAULT '',
            photo_url TEXT DEFAULT '', wallet_address TEXT DEFAULT '',
            balance REAL NOT NULL DEFAULT 0,
            referral_earnings REAL NOT NULL DEFAULT 0,
            referral_balance REAL NOT NULL DEFAULT 0,
            referral_created INTEGER NOT NULL DEFAULT 0,
            referred_by INTEGER,
            bonus_claimed INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS inventory (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
            item_type TEXT NOT NULL, item_name TEXT NOT NULL, item_price REAL NOT NULL,
            status TEXT NOT NULL DEFAULT 'owned', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS upgrades (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
            price REAL NOT NULL, probability REAL NOT NULL, won INTEGER NOT NULL,
            angle REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS deposits (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
            amount REAL NOT NULL, source TEXT NOT NULL DEFAULT 'internal', tx_hash TEXT DEFAULT '',
            status TEXT NOT NULL DEFAULT 'confirmed', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS referral_withdrawals (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
            amount REAL NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_inventory_user ON inventory(user_id);
        CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users(referred_by);
        CREATE INDEX IF NOT EXISTS idx_deposits_user ON deposits(user_id);
        CREATE INDEX IF NOT EXISTS idx_refwd_user ON referral_withdrawals(user_id);
        ''')
        cols = {r['name'] for r in conn.execute('PRAGMA table_info(users)').fetchall()}
        migrations = {
            'wallet_address': "ALTER TABLE users ADD COLUMN wallet_address TEXT DEFAULT ''",
            'referral_balance': "ALTER TABLE users ADD COLUMN referral_balance REAL NOT NULL DEFAULT 0",
            'referral_created': "ALTER TABLE users ADD COLUMN referral_created INTEGER NOT NULL DEFAULT 0",
            'bonus_claimed': "ALTER TABLE users ADD COLUMN bonus_claimed INTEGER NOT NULL DEFAULT 0",
        }
        for col, sql in migrations.items():
            if col not in cols:
                conn.execute(sql)
        icols = {r['name'] for r in conn.execute('PRAGMA table_info(inventory)').fetchall()}
        if 'status' not in icols:
            conn.execute("ALTER TABLE inventory ADD COLUMN status TEXT NOT NULL DEFAULT 'owned'")
        ucols = {r['name'] for r in conn.execute('PRAGMA table_info(upgrades)').fetchall()}
        if 'angle' not in ucols:
            conn.execute("ALTER TABLE upgrades ADD COLUMN angle REAL NOT NULL DEFAULT 0")


# Если инициализация БД падает (например, нет прав на запись в директорию),
# раньше это роняло импорт всего модуля -> gunicorn не мог поднять воркер,
# и приложение целиком отвечало ошибкой на любой запрос ("нет связи с
# сервером" для всего сразу). Теперь ошибка логируется, а не убивает процесс.
try:
    init_db()
except Exception:
    logging.exception('DB init failed at startup (DB=%s)', POSTSQL or DB_PATH)


def validate_init_data(init_data):
    """Разбирает Telegram initData.

    Возвращает (user, verified):
      verified=True  — подпись проверена по BOT_TOKEN, данным можно доверять полностью;
      verified=False — данные из Telegram распарсены, но подпись не проверена
                        (не настроен BOT_TOKEN или она не совпала).

    Раньше при verified=False функция просто отдавала None, и get_user()
    откатывался на общий фейковый аккаунт {'id': 1, ...} для АБСОЛЮТНО ВСЕХ
    пользователей сразу — отсюда пропадал username/аватарка в профиле и все
    игроки на самом деле делили один и тот же аккаунт. Теперь настоящие данные
    пользователя используются в любом случае, а verified влияет только на то,
    можно ли доверять этому tg_id для чувствительных операций.
    """
    if not init_data:
        return None, False
    try:
        pairs = dict(parse_qsl(init_data, keep_blank_values=True))
        received = pairs.pop('hash', None)
        user = json.loads(pairs.get('user', '{}'))
        if not user.get('id'):
            return None, False
        user['start_param'] = pairs.get('start_param', '')

        if not received or not BOT_TOKEN:
            return user, False

        check = '\n'.join(f'{k}={pairs[k]}' for k in sorted(pairs))
        secret = hmac.new(b'WebAppData', BOT_TOKEN.encode(), hashlib.sha256).digest()
        expected = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, received):
            return user, False
        return user, True
    except Exception:
        logging.exception('validate_init_data failed')
        return None, False


def get_user():
    payload = request.get_json(silent=True) or {}
    user, _verified = validate_init_data(payload.get('initData', ''))
    if not user:
        user = payload.get('user')
    if not user or not user.get('id'):
        user = {'id': 1, 'username': '', 'first_name': 'Игрок', 'start_param': ''}
    return user


# ---------------------------------------------------------------- аватарки
# Telegram Mini Apps почти никогда не кладёт photo_url прямо в initData
# (это поле реально приходит только при запуске из attachment menu). Чтобы
# у игроков были настоящие аватарки, ходим за фото в Bot API сами и отдаём
# картинку через собственный прокси-роут — так токен бота не светится в
# ссылке на клиенте, а сама ссылка живёт долго, что позволяет браузеру
# закэшировать её и не дёргать Telegram на каждый /api/state.
_avatar_path_cache = {}  # tg_id -> (file_path | None, expires_at)
AVATAR_CACHE_TTL = 3600


def _tg_api(method, **params):
    if not BOT_TOKEN:
        return None
    url = f'https://api.telegram.org/bot{BOT_TOKEN}/{method}?' + '&'.join(f'{k}={v}' for k, v in params.items())
    try:
        with urllib.request.urlopen(url, timeout=6) as r:
            return json.loads(r.read().decode('utf-8'))
    except Exception:
        logging.exception('Telegram API call failed: %s', method)
        return None


def resolve_avatar_file_path(tg_id):
    cached = _avatar_path_cache.get(tg_id)
    if cached and cached[1] > time.time():
        return cached[0]
    file_path = None
    photos = _tg_api('getUserProfilePhotos', user_id=tg_id, limit=1)
    if photos and photos.get('ok') and photos['result']['photos']:
        file_id = photos['result']['photos'][0][-1]['file_id']
        info = _tg_api('getFile', file_id=file_id)
        if info and info.get('ok'):
            file_path = info['result'].get('file_path')
    _avatar_path_cache[tg_id] = (file_path, time.time() + AVATAR_CACHE_TTL)
    return file_path


def avatar_url_for(tg_id):
    return f'/api/avatar/{tg_id}' if BOT_TOKEN else ''


@app.get('/api/avatar/<int:tg_id>')
def avatar(tg_id):
    with db() as conn:
        known = conn.execute('SELECT 1 FROM users WHERE tg_id=?', (tg_id,)).fetchone()
    if not known:  # не даём вытаскивать фото произвольных аккаунтов через нашего бота
        return '', 404
    file_path = resolve_avatar_file_path(tg_id)
    if not file_path:
        return '', 404
    try:
        url = f'https://api.telegram.org/file/bot{BOT_TOKEN}/{file_path}'
        with urllib.request.urlopen(url, timeout=6) as r:
            content = r.read()
            ctype = r.headers.get('Content-Type', 'image/jpeg')
        return Response(content, mimetype=ctype, headers={'Cache-Control': 'public, max-age=3600'})
    except Exception:
        logging.exception('avatar proxy failed for tg_id=%s', tg_id)
        return '', 404


# -------------------------------------------------------------- лидерборд
# "Оборот" — сумма ставок (upgrades.price) за текущий период. Период — это
# неделя (понедельник 00:00 UTC — следующий понедельник 00:00 UTC); данные
# для расчёта уже пишутся при каждом спине, отдельная таблица не нужна.
def leaderboard_period():
    now = datetime.now(timezone.utc)
    start = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + timedelta(days=7)
    return start, end


def leaders_payload():
    start, end = leaderboard_period()
    start_s = start.strftime('%Y-%m-%d %H:%M:%S')
    with db() as conn:
        rows = conn.execute('''
            SELECT u.tg_id, u.username, u.first_name, u.photo_url, SUM(up.price) turnover
            FROM upgrades up JOIN users u ON u.id = up.user_id
            WHERE up.created_at >= ?
            GROUP BY u.id
            ORDER BY turnover DESC
            LIMIT 30
        ''', (start_s,)).fetchall()
    entries = [{
        'tg_id': r['tg_id'], 'username': r['username'] or '', 'first_name': r['first_name'] or 'Игрок',
        'avatar_url': r['photo_url'] or avatar_url_for(r['tg_id']), 'turnover_ton': round(r['turnover'], 2),
    } for r in rows]
    return {'period_ends_at': int(end.timestamp()), 'entries': entries}


def upsert_user(user, start_param=None):
    tg_id = int(user['id'])
    fields = (user.get('username', '') or '', user.get('first_name', '') or '',
              user.get('last_name', '') or '', user.get('photo_url', '') or '')
    if start_param is None:
        start_param = user.get('start_param') or (request.args.get('start_param', '') if has_request_context() else '')
    with db() as conn:
        row = conn.execute('SELECT * FROM users WHERE tg_id=?', (tg_id,)).fetchone()
        if row:
            # Пустой photo_url (Telegram почти никогда его не присылает) не должен
            # затирать уже сохранённую аватарку — иначе в лидерах она пропадала.
            conn.execute("UPDATE users SET username=?, first_name=?, last_name=?, "
                         "photo_url=COALESCE(NULLIF(?, ''), photo_url) WHERE tg_id=?", (*fields, tg_id))
            return conn.execute('SELECT * FROM users WHERE tg_id=?', (tg_id,)).fetchone()
        referred_by = None
        if str(start_param).startswith('ref_'):
            try:
                ref_tg = int(str(start_param)[4:])
                ref = conn.execute('SELECT id FROM users WHERE tg_id=?', (ref_tg,)).fetchone()
                if ref and ref_tg != tg_id:
                    referred_by = ref['id']
            except ValueError:
                pass
        conn.execute('''INSERT INTO users
            (tg_id, username, first_name, last_name, photo_url, balance, referred_by)
            VALUES (?, ?, ?, ?, ?, 0, ?)''', (tg_id, *fields, referred_by))
        # Не используем sqlite-only lastrowid: это одинаково работает для SQLite и PostgreSQL.
        return conn.execute('SELECT * FROM users WHERE tg_id=?', (tg_id,)).fetchone()


def resolved_bot_username():
    global BOT_USERNAME, _BOT_USERNAME_RESOLVED
    if _BOT_USERNAME_RESOLVED:
        return _BOT_USERNAME_RESOLVED
    if BOT_USERNAME:
        _BOT_USERNAME_RESOLVED = BOT_USERNAME.lstrip('@')
        return _BOT_USERNAME_RESOLVED
    me = tg_call('getMe')
    if me and me.get('ok'):
        _BOT_USERNAME_RESOLVED = (me['result'].get('username') or '').lstrip('@')
        if _BOT_USERNAME_RESOLVED:
            BOT_USERNAME = _BOT_USERNAME_RESOLVED
    return _BOT_USERNAME_RESOLVED

def referral_payload(row):
    with db() as conn:
        count = conn.execute('SELECT COUNT(*) c FROM users WHERE referred_by=?', (row['id'],)).fetchone()['c']
        pending = conn.execute("SELECT COALESCE(SUM(amount),0) a FROM referral_withdrawals WHERE user_id=? AND status='pending'", (row['id'],)).fetchone()['a']
    return {
        'created': bool(row['referral_created']),
        'link': f'https://t.me/{resolved_bot_username()}?start=ref_{row["tg_id"]}' if row['referral_created'] and resolved_bot_username() else '',
        'count': count, 'percent': REFERRAL_PERCENT,
        'earned_ton': round(row['referral_earnings'], 4),
        'balance_ton': round(row['referral_balance'], 4),
        'pending_ton': round(pending, 4), 'min_withdraw_ton': MIN_REF_WITHDRAW,
    }


def state_payload(row):
    with db() as conn:
        prizes = conn.execute('SELECT id, item_name, item_price, status, created_at FROM inventory WHERE user_id=? AND status<>? ORDER BY id DESC', (row['id'], 'sold')).fetchall()
    # Фото берём из initData, если Telegram его прислал, иначе — через наш
    # прокси к Bot API (см. avatar_url_for). Пустая строка = у пользователя
    # нет ни одной фотографии профиля, фронт в этом случае показывает иконку.
    photo = row['photo_url'] or avatar_url_for(row['tg_id'])
    return {
        'balance_ton': round(row['balance'], 4),
        'user': {'id': row['id'], 'tg_id': row['tg_id'], 'username': row['username'], 'first_name': row['first_name'],
                 'last_name': row['last_name'], 'photo_url': photo, 'wallet': row['wallet_address'] or '', 'bonus_claimed': bool(row['bonus_claimed'])},
        'config': {
            'prize_name': PRIZE_NAME, 'prize_price': HAT_PRICE, 'min_deposit_ton': MIN_DEPOSIT,
            'topup_ton': TOPUP_AMOUNT, 'referral_percent': REFERRAL_PERCENT,
            'chance': {'min': CHANCE_MIN, 'max': CHANCE_MAX, 'default': CHANCE_DEFAULT, 'marks': list(CHANCE_MARKS)},
        },
        'deposit': {'address': DEPOSIT_ADDRESS, 'memo': f'{DEPOSIT_MEMO}-' + str(row["tg_id"]) if DEPOSIT_MEMO else f'MU-{row["tg_id"]}'},
        'prizes': [dict(p) for p in prizes],
        'referral': referral_payload(row),
        'leaders': leaders_payload(),
    }


def bet_cost(pct):
    # Округление «половина вверх» — то же, что Math.round на клиенте (см. app.js).
    return int(HAT_PRICE * pct + 0.5) / 100


def angle_for(chance, won):
    # Green segment starts at -90deg. Choose a deterministic random point inside
    # the server-decided segment so the client only animates the returned result.
    if won:
        frac = secrets.randbelow(1000000) / 1000000
        return 360 * frac * chance
    frac = secrets.randbelow(1000000) / 1000000
    return 360 * (chance + frac * (1 - chance))


@app.errorhandler(Exception)
def handle_error(e):
    # Раньше необработанное исключение возвращало HTML-страницу ошибки Flask.
    # Фронтенд ждёт JSON, парсинг падал, и пользователь везде видел один и
    # тот же неинформативный тост "нет связи с сервером". Теперь сервер
    # всегда отвечает валидным JSON и пишет причину в лог (смотрите логи
    # Render, чтобы увидеть настоящую причину сбоя).
    from werkzeug.exceptions import HTTPException
    if isinstance(e, HTTPException):
        return jsonify({'error': 'http_error', 'detail': e.description}), e.code
    logging.exception('Unhandled error on %s %s', request.method, request.path)
    return jsonify({'error': 'server_error'}), 500


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/state', methods=['GET', 'POST'])
def state():
    row = upsert_user(get_user())
    return jsonify(state_payload(row))


@app.post('/api/connect')
def connect():
    row = upsert_user(get_user())
    with db() as conn:
        row = conn.execute('SELECT * FROM users WHERE id=?', (row['id'],)).fetchone()
        if row['bonus_claimed']:
            return jsonify({'ok': False, 'error': 'bonus_already_claimed', 'user': state_payload(row)['user']}), 409
        conn.execute('UPDATE users SET balance=balance+?, bonus_claimed=1 WHERE id=?', (CONNECT_BONUS, row['id']))
        row = conn.execute('SELECT * FROM users WHERE id=?', (row['id'],)).fetchone()
    return jsonify({'ok': True, 'bonus': CONNECT_BONUS, **state_payload(row)})


@app.post('/api/wallet')
def wallet():
    payload = request.get_json(silent=True) or {}
    address = str(payload.get('address', '') or '').strip()
    row = upsert_user(get_user())
    with db() as conn:
        conn.execute('UPDATE users SET wallet_address=? WHERE id=?', (address[:128], row['id']))
        row = conn.execute('SELECT * FROM users WHERE id=?', (row['id'],)).fetchone()
    return jsonify({'ok': True, **state_payload(row)})


@app.post('/api/spin')
def spin():
    payload = request.get_json(silent=True) or {}
    try:
        pct = int(payload.get('chance'))
    except (TypeError, ValueError):
        return jsonify({'error': 'invalid_chance'}), 400
    if not CHANCE_MIN <= pct <= CHANCE_MAX:
        return jsonify({'error': 'invalid_chance'}), 400
    price = bet_cost(pct)
    chance = pct / 100
    row = upsert_user(get_user())
    with db() as conn:
        row = conn.execute('SELECT * FROM users WHERE id=?', (row['id'],)).fetchone()
        if row['balance'] + 1e-9 < price:
            return jsonify({'error': 'insufficient_funds'}), 400
        now = time.time()
        last_spin = _last_spin_at.get(row['id'], 0)
        if now - last_spin < 1:
            return jsonify({'error': 'too_fast'}), 429
        _last_spin_at[row['id']] = now
        won = secrets.randbelow(100) < pct
        angle = angle_for(chance, won)
        conn.execute('UPDATE users SET balance=balance-? WHERE id=?', (price, row['id']))
        conn.execute('INSERT INTO upgrades(user_id,price,probability,won,angle) VALUES(?,?,?,?,?)', (row['id'],price,chance,1 if won else 0,angle))
        if won:
            conn.execute("INSERT INTO inventory(user_id,item_type,item_name,item_price,status) VALUES(?,?,?,?, 'owned')", (row['id'],'gift',PRIZE_NAME,HAT_PRICE))
        updated = conn.execute('SELECT * FROM users WHERE id=?', (row['id'],)).fetchone()
    return jsonify({'ok': True, 'win': won, 'won': won, 'angle': angle, 'price': price, **state_payload(updated)})


@app.post('/api/referral/create')
def referral_create():
    row = upsert_user(get_user())
    with db() as conn:
        conn.execute('UPDATE users SET referral_created=1 WHERE id=?', (row['id'],))
        row = conn.execute('SELECT * FROM users WHERE id=?', (row['id'],)).fetchone()
    return jsonify({'ok': True, 'referral': referral_payload(row)})


@app.post('/api/referral/withdraw')
def referral_withdraw():
    row = upsert_user(get_user())
    with db() as conn:
        row = conn.execute('SELECT * FROM users WHERE id=?', (row['id'],)).fetchone()
        if row['referral_balance'] + 1e-9 < MIN_REF_WITHDRAW:
            return jsonify({'error': 'below_minimum'}), 400
        amount = round(row['referral_balance'], 4)
        conn.execute("INSERT INTO referral_withdrawals(user_id,amount,status) VALUES(?,?, 'pending')", (row['id'], amount))
        conn.execute('UPDATE users SET referral_balance=0 WHERE id=?', (row['id'],))
        row = conn.execute('SELECT * FROM users WHERE id=?', (row['id'],)).fetchone()
    return jsonify({'ok': True, 'referral': referral_payload(row)})


@app.post('/api/withdraw')
def withdraw():
    payload = request.get_json(silent=True) or {}
    try: pid = int(payload.get('prize_id'))
    except (TypeError, ValueError): return jsonify({'error':'invalid_prize'}), 400
    row = upsert_user(get_user())
    with db() as conn:
        item = conn.execute("SELECT * FROM inventory WHERE id=? AND user_id=?", (pid,row['id'])).fetchone()
        if not item: return jsonify({'error':'prize_not_found'}), 404
        if item['status'] != 'owned': return jsonify({'error':'already_requested'}), 409
        conn.execute("UPDATE inventory SET status='pending' WHERE id=?", (pid,))
        updated = conn.execute('SELECT * FROM users WHERE id=?', (row['id'],)).fetchone()
    return jsonify({'ok':True, 'prizes': state_payload(updated)['prizes']})


@app.post('/api/topup')
def topup():
    # Безопасность: нажатие кнопки больше НИКОГДА не создаёт TON из воздуха.
    # Реальное пополнение идёт только через TON Connect/подтверждённую транзакцию.
    return jsonify({'error': 'topup_requires_payment'}), 409


@app.post('/api/sell')
def sell():
    payload = request.get_json(silent=True) or {}
    try: pid = int(payload.get('prize_id'))
    except (TypeError, ValueError): return jsonify({'error': 'invalid_prize'}), 400
    row = upsert_user(get_user())
    with db() as conn:
        item = conn.execute('SELECT * FROM inventory WHERE id=? AND user_id=?', (pid, row['id'])).fetchone()
        if not item: return jsonify({'error': 'prize_not_found'}), 404
        # Условный UPDATE — защита от двойного нажатия: продать можно ровно один раз.
        cur = conn.execute("UPDATE inventory SET status='sold' WHERE id=? AND user_id=? AND status='owned'", (pid, row['id']))
        if cur.rowcount != 1: return jsonify({'error': 'not_sellable'}), 409
        conn.execute('UPDATE users SET balance=balance+? WHERE id=?', (item['item_price'], row['id']))
        updated = conn.execute('SELECT * FROM users WHERE id=?', (row['id'],)).fetchone()
    return jsonify({'ok': True, 'sold_ton': item['item_price'], **state_payload(updated)})


@app.post('/api/deposit')
def internal_deposit():
    # Старый endpoint позволял клиенту просто отправить amount и получить баланс.
    # Теперь прямое зачисление с клиента запрещено.
    return jsonify({'error': 'deposit_is_confirmed_server_side'}), 409


@app.get('/tonconnect-manifest.json')
def manifest():
    return jsonify({'url': request.host_url.rstrip('/'), 'name': 'Magic Upgrade', 'iconUrl': request.host_url.rstrip('/') + '/static/img/hat.png'})



# ==================================================================== АВТОЗАЧИСЛЕНИЕ TON
# Баланс не меняется от клика по кнопке. После реального входящего TON-платежа
# сканер ищет подтверждённый TonTransfer с персональным memo MU-<telegram_id>.
# TonAPI не требует ключа для базового чтения событий, но имеет rate limits.
_DEPOSIT_SCANNER_STOP = False

def _extract_ton_comment(action):
    if not isinstance(action, dict):
        return ''
    transfer = action.get('TonTransfer') or action.get('tonTransfer') or {}
    return str(transfer.get('comment') or action.get('comment') or '').strip()

def _deposit_scanner_once():
    if not DEPOSIT_ADDRESS:
        return
    url = f"https://tonapi.io/v2/accounts/{quote(DEPOSIT_ADDRESS, safe='')}/events?limit=50"
    try:
        req = urllib.request.Request(url, headers={'Accept': 'application/json'})
        with urllib.request.urlopen(req, timeout=10) as r:
            data = json.loads(r.read().decode('utf-8'))
    except Exception:
        return

    for event in data.get('events', []):
        event_id = str(event.get('event_id') or event.get('id') or '')
        if not event_id:
            continue
        for action in event.get('actions', []):
            if action.get('type') not in ('TonTransfer', 'tonTransfer'):
                continue
            transfer = action.get('TonTransfer') or action.get('tonTransfer') or {}
            if str(action.get('status', 'ok')).lower() not in ('ok', 'success'):
                continue
            recipient = ((transfer.get('recipient') or {}).get('address') or '')
            if recipient and recipient != DEPOSIT_ADDRESS:
                continue
            comment = _extract_ton_comment(action)
            prefix = (DEPOSIT_MEMO.strip() + '-') if DEPOSIT_MEMO.strip() else 'MU-'
            match = re.fullmatch(re.escape(prefix) + r'(\d+)', comment)
            if not match:
                continue
            tg_id = int(match.group(1))
            try:
                amount = float(transfer.get('amount', 0)) / 1_000_000_000
            except (TypeError, ValueError):
                continue
            if amount < MIN_DEPOSIT:
                continue

            with db() as conn:
                already = conn.execute("SELECT id FROM deposits WHERE tx_hash=?", (event_id,)).fetchone()
                if already:
                    continue
                user = conn.execute("SELECT * FROM users WHERE tg_id=?", (tg_id,)).fetchone()
                if not user:
                    continue
                conn.execute("UPDATE users SET balance=balance+? WHERE id=?", (amount, user['id']))
                conn.execute(
                    "INSERT INTO deposits(user_id,amount,source,tx_hash,status) VALUES(?,?, 'tonapi','confirmed')",
                    (user['id'], amount, event_id))
                if user['referred_by']:
                    bonus = round(amount * REFERRAL_PERCENT / 100, 4)
                    conn.execute(
                        "UPDATE users SET referral_balance=referral_balance+?, referral_earnings=referral_earnings+? WHERE id=?",
                        (bonus, bonus, user['referred_by']))

def _deposit_scanner_loop():
    while True:
        try:
            _deposit_scanner_once()
        except Exception:
            logging.exception('deposit scanner error')
        time.sleep(20)

def start_deposit_scanner():
    if DEPOSIT_ADDRESS:
        threading.Thread(target=_deposit_scanner_loop, name='ton-deposit-scanner', daemon=True).start()

# ==================================================================== БОТ
# Telegram-бот встроен в приложение: работает в фоновом потоке (long polling),
# отдельный процесс и пакеты не нужны — достаточно BOT_TOKEN выше.
WELCOME_TEXT = (
    '✨ Привет, {name}!\n'
    '\n'
    'Подключай кошелёк, пополняй баланс в TON и крути апгрейд.\n'
    'Приз — Шляпа волшебника (7 TON).\n'
    '\n'
    'Режимы ставки:\n'
    '• 0.7 TON → шанс 10%\n'
    '• 1.75 TON → шанс 25%\n'
    '• 3.5 TON → шанс 50%'
)
OPEN_BUTTON_TEXT = '🎩 Открыть апгрейд'
BOT_LOCK_PATH = os.path.join(tempfile.gettempdir(), 'magic_upgrade_bot.lock')
_bot_lock_fh = None


def webapp_url():
    url = WEBAPP_URL or os.environ.get('RENDER_EXTERNAL_URL', '')
    if not url and os.environ.get('RAILWAY_PUBLIC_DOMAIN'):
        url = 'https://' + os.environ['RAILWAY_PUBLIC_DOMAIN']
    url = url.strip().rstrip('/')
    return url if url.startswith('https://') else ''  # Telegram принимает для web_app только https


def tg_call(method, payload=None, timeout=15):
    """POST в Bot API. Возвращает dict ответа Telegram (в т.ч. {'ok': False, ...}) или None при сбое сети."""
    if not BOT_TOKEN:
        return None
    req = urllib.request.Request(
        f'https://api.telegram.org/bot{BOT_TOKEN}/{method}',
        data=json.dumps(payload or {}).encode('utf-8'),
        headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read().decode('utf-8'))
        except Exception:
            return {'ok': False, 'error_code': e.code}
    except Exception as e:
        # Сообщение исключения не логируем целиком — в нём может оказаться URL с токеном.
        logging.warning('Telegram %s: сбой сети (%s)', method, type(e).__name__)
        return None


def bot_handle_update(upd):
    msg = upd.get('message')
    if not msg:
        return
    chat, frm = msg.get('chat') or {}, msg.get('from') or {}
    if chat.get('type') != 'private' or not frm.get('id') or frm.get('is_bot'):
        return

    text = (msg.get('text') or '').strip()
    start_param = ''
    if text.startswith('/start'):
        parts = text.split(maxsplit=1)
        start_param = parts[1] if len(parts) > 1 else ''

    # Регистрируем игрока сразу: так реферальная ссылка (?start=ref_ID) засчитывается,
    # даже если мини-апп открыт кнопкой и start_param в него не приходит.
    try:
        upsert_user({'id': frm['id'], 'username': frm.get('username', ''),
                     'first_name': frm.get('first_name', ''), 'last_name': frm.get('last_name', '')},
                    start_param=start_param)
    except Exception:
        logging.exception('bot: не удалось сохранить пользователя')

    name = frm.get('first_name') or frm.get('username') or 'друг'
    body = {'chat_id': chat['id'], 'text': WELCOME_TEXT.format(name=name)}
    url = webapp_url()
    if url:
        body['reply_markup'] = {'inline_keyboard': [[{'text': OPEN_BUTTON_TEXT, 'web_app': {'url': url}}]]}
    else:
        logging.warning('bot: не задан WEBAPP_URL — приветствие отправлено без кнопки')
    res = tg_call('sendMessage', body)
    if not res or not res.get('ok'):
        logging.warning('bot: sendMessage не удался: %s', (res or {}).get('description', 'нет ответа'))


def bot_poll_loop():
    global BOT_USERNAME
    me = tg_call('getMe')
    if me and me.get('ok'):
        if not os.environ.get('BOT_USERNAME'):
            BOT_USERNAME = me['result'].get('username') or BOT_USERNAME
        logging.info('Бот запущен: @%s', me['result'].get('username'))
    elif me and me.get('error_code') == 401:
        logging.error('BOT_TOKEN неверный (Telegram ответил 401) — бот не запущен')
        return
    tg_call('deleteWebhook')  # иначе getUpdates отвечает 409, если раньше был вебхук

    offset, backoff = None, 1
    while True:
        params = {'timeout': 30, 'allowed_updates': ['message']}
        if offset:
            params['offset'] = offset
        res = tg_call('getUpdates', params, timeout=45)
        if not res or not res.get('ok'):
            if res and res.get('error_code') == 401:
                logging.error('BOT_TOKEN неверный (401) — останавливаю бота')
                return
            time.sleep(backoff)
            backoff = min(30, backoff * 2)
            continue
        backoff = 1
        for upd in res.get('result', []):
            offset = upd['update_id'] + 1
            try:
                bot_handle_update(upd)
            except Exception:
                logging.exception('bot: ошибка обработки апдейта')


def _acquire_bot_lock():
    # Несколько воркеров gunicorn → только один опрашивает Telegram (иначе 409).
    # Блокировка снимается сама, когда процесс-владелец завершается.
    global _bot_lock_fh
    try:
        import fcntl
    except ImportError:  # Windows: локальный запуск, воркер один
        return True
    fh = open(BOT_LOCK_PATH, 'w')
    try:
        fcntl.flock(fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        fh.close()
        return False
    _bot_lock_fh = fh
    return True


def _bot_supervisor():
    while True:
        if _acquire_bot_lock():
            bot_poll_loop()
            return
        time.sleep(20)


def start_bot():
    if not BOT_TOKEN:
        logging.warning('BOT_TOKEN не задан — бот не запущен (вставь токен в app.py или в переменную BOT_TOKEN)')
        return
    threading.Thread(target=_bot_supervisor, name='tg-bot', daemon=True).start()


start_bot()
start_deposit_scanner()


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5000)), debug=os.environ.get('FLASK_DEBUG','0') == '1')
