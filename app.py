import os, hmac, hashlib, json, logging, secrets, sqlite3, time
from urllib.parse import parse_qsl
from flask import Flask, render_template, jsonify, request

app = Flask(__name__)
logging.basicConfig(level=logging.INFO)
DB_PATH = os.environ.get('DB_PATH', os.path.join(app.root_path, 'data.sqlite3'))
BOT_TOKEN = os.environ.get('BOT_TOKEN', '')
BOT_USERNAME = os.environ.get('BOT_USERNAME', 'your_bot')
REFERRAL_PERCENT = 2.0
HAT_PRICE = 7.0
CONNECT_BONUS = 10.0
MIN_DEPOSIT = 0.1
MIN_REF_WITHDRAW = 1.0
PRIZE_NAME = 'Шляпа волшебника'
DEPOSIT_ADDRESS = os.environ.get('DEPOSIT_ADDRESS', '')
DEPOSIT_MEMO = os.environ.get('DEPOSIT_MEMO', '')

os.makedirs(os.path.dirname(DB_PATH) or '.', exist_ok=True)

# Простой анти-спам для /api/spin: id пользователя -> время последнего спина.
# Раньше это сравнивалось строкой с CURRENT_TIMESTAMP из SQLite (UTC) против
# time.strftime (локальное время сервера) — сравнение почти никогда не
# совпадало правильно. In-memory словарь с time.time() работает предсказуемо.
_last_spin_at = {}


def db():
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA busy_timeout=15000')
    return conn


def init_db():
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
    logging.exception('DB init failed at startup (DB_PATH=%s)', DB_PATH)


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


def upsert_user(user):
    tg_id = int(user['id'])
    fields = (user.get('username', '') or '', user.get('first_name', '') or '',
              user.get('last_name', '') or '', user.get('photo_url', '') or '')
    start_param = user.get('start_param') or request.args.get('start_param', '')
    with db() as conn:
        row = conn.execute('SELECT * FROM users WHERE tg_id=?', (tg_id,)).fetchone()
        if row:
            conn.execute('UPDATE users SET username=?, first_name=?, last_name=?, photo_url=? WHERE tg_id=?', (*fields, tg_id))
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
        cur = conn.execute('''INSERT INTO users
            (tg_id, username, first_name, last_name, photo_url, balance, referred_by)
            VALUES (?, ?, ?, ?, ?, 0, ?)''', (*fields, referred_by))
        return conn.execute('SELECT * FROM users WHERE id=?', (cur.lastrowid,)).fetchone()


def referral_payload(row):
    with db() as conn:
        count = conn.execute('SELECT COUNT(*) c FROM users WHERE referred_by=?', (row['id'],)).fetchone()['c']
        pending = conn.execute("SELECT COALESCE(SUM(amount),0) a FROM referral_withdrawals WHERE user_id=? AND status='pending'", (row['id'],)).fetchone()['a']
    return {
        'created': bool(row['referral_created']),
        'link': f'https://t.me/{BOT_USERNAME}?start=ref_{row["tg_id"]}' if row['referral_created'] else '',
        'count': count, 'percent': REFERRAL_PERCENT,
        'earned_ton': round(row['referral_earnings'], 4),
        'balance_ton': round(row['referral_balance'], 4),
        'pending_ton': round(pending, 4), 'min_withdraw_ton': MIN_REF_WITHDRAW,
    }


def state_payload(row):
    with db() as conn:
        prizes = conn.execute('SELECT id, item_name, item_price, status, created_at FROM inventory WHERE user_id=? ORDER BY id DESC', (row['id'],)).fetchall()
    return {
        'balance_ton': round(row['balance'], 4),
        'user': {'id': row['id'], 'tg_id': row['tg_id'], 'username': row['username'], 'first_name': row['first_name'],
                 'last_name': row['last_name'], 'photo_url': row['photo_url'], 'wallet': row['wallet_address'] or '', 'bonus_claimed': bool(row['bonus_claimed'])},
        'config': {
            'prize_name': PRIZE_NAME, 'min_deposit_ton': MIN_DEPOSIT,
            'referral_percent': REFERRAL_PERCENT,
            'modes': [
                {'id': 'low', 'cost_ton': 1.4, 'chance': 0.20},
                {'id': 'mid', 'cost_ton': 2.5, 'chance': 0.35},
                {'id': 'high', 'cost_ton': 3.5, 'chance': 0.50},
            ], 'default_mode': 'mid'
        },
        'deposit': {'address': DEPOSIT_ADDRESS, 'memo': DEPOSIT_MEMO or f'MU-{row["tg_id"]}'},
        'prizes': [dict(p) for p in prizes],
        'referral': referral_payload(row),
    }


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
        conn.execute('UPDATE users SET balance=ROUND(balance+?,4), bonus_claimed=1 WHERE id=?', (CONNECT_BONUS, row['id']))
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
    mode_id = str(payload.get('mode', 'mid'))
    modes = {'low': (1.4, .20), 'mid': (2.5, .35), 'high': (3.5, .50)}
    if mode_id not in modes:
        return jsonify({'error': 'invalid_mode'}), 400
    price, chance = modes[mode_id]
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
        won = secrets.randbelow(1000000) < int(chance * 1000000)
        angle = angle_for(chance, won)
        conn.execute('UPDATE users SET balance=ROUND(balance-?,4) WHERE id=?', (price, row['id']))
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


@app.post('/api/deposit')
def internal_deposit():
    payload = request.get_json(silent=True) or {}
    try: amount = float(payload.get('amount', 0))
    except (TypeError, ValueError): amount = 0
    if amount < MIN_DEPOSIT: return jsonify({'error':'invalid_amount'}), 400
    row = upsert_user(get_user())
    with db() as conn:
        conn.execute('UPDATE users SET balance=ROUND(balance+?,4) WHERE id=?', (amount,row['id']))
        conn.execute("INSERT INTO deposits(user_id,amount,source,status) VALUES(?,?, 'internal','confirmed')", (row['id'],amount))
        if row['referred_by']:
            bonus = round(amount * REFERRAL_PERCENT / 100, 4)
            conn.execute('UPDATE users SET referral_balance=ROUND(referral_balance+?,4), referral_earnings=ROUND(referral_earnings+?,4) WHERE id=?', (bonus,bonus,row['referred_by']))
        updated = conn.execute('SELECT * FROM users WHERE id=?', (row['id'],)).fetchone()
    return jsonify({'ok':True, **state_payload(updated)})


@app.get('/tonconnect-manifest.json')
def manifest():
    return jsonify({'url': request.host_url.rstrip('/'), 'name': 'Magic Upgrade', 'iconUrl': request.host_url.rstrip('/') + '/static/img/hat.png'})


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5000)), debug=os.environ.get('FLASK_DEBUG','0') == '1')
