"""Editable Telegram messages and their inline keyboards."""
import re
from html import escape
from copy import deepcopy
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode

PLAY = {'text': '🎮 Играть', 'action': 'app', 'target': 'menu', 'style': 'primary'}
DEFAULT_MESSAGES = {
    'welcome': {'label': 'Приветствие /start', 'text': '👋 Привет, {name}! Добро пожаловать в HatDrop.\n\nВыбирайте режим, открывайте сундуки и собирайте подарки. Нажмите «Играть», чтобы открыть меню.', 'buttons': [PLAY]},
    'help': {'label': 'Помощь /help', 'text': '🎩 HatDrop\n\nНажмите «Играть», чтобы выбрать режим. Ваши подарки и заявки на вывод доступны в профиле.', 'buttons': [PLAY]},
    'withdraw_pending': {'label': 'Заявка на вывод создана', 'text': '📨 Заявка на вывод {gift_emoji} {gift} принята. Подарок передаётся автоматически — пришлём уведомление.', 'buttons': [{'text': 'Открыть', 'action': 'app', 'target': 'profile', 'style': 'danger'}]},
    'withdraw_completed': {'label': 'Вывод выполнен (подарок отправлен)', 'text': '✅ Заявка на вывод: {gift_emoji} {gift} успешно отправлен! Проверьте свои подарки в Telegram.', 'buttons': [{'text': 'Открыть', 'action': 'app', 'target': 'profile', 'style': 'danger'}]},
    'withdraw_not_found': {'label': 'Подарок не найден на релейере', 'text': '⚠️ {gift_emoji} {gift} не найден на релейере. Ожидайте ручной выдачи — администратор отправит подарок вручную.', 'buttons': [{'text': 'Открыть', 'action': 'app', 'target': 'profile', 'style': 'danger'}]},
    'withdraw_approved': {'label': 'Вывод одобрен (ручной)', 'text': '✅ {gift_emoji} {gift} найден. Заявка одобрена, ожидайте отправки.', 'buttons': [{'text': 'Открыть', 'action': 'app', 'target': 'profile', 'style': 'danger'}]},
    'withdraw_rejected': {'label': 'Вывод отклонён', 'text': '❌ Ваша заявка на вывод {gift_emoji} {gift} отклонена. Подарок вернулся в инвентарь.', 'buttons': [{'text': 'Открыть', 'action': 'app', 'target': 'profile', 'style': 'danger'}]},
}
EMOJI_ID_RE = re.compile(r'[0-9]{5,30}')
TOKEN_RE = re.compile(r'\{(name|gift|gift_emoji)\}|\[emoji:([0-9]{5,30}):([^\]\r\n]{1,16})\]')
APP_VIEWS = ('menu', 'upgrade', 'chests', 'profile')
BUTTON_STYLES = ('default', 'primary', 'success', 'danger')
MAX_CUSTOM_COMMANDS = 98  # Telegram supports 100, including /start and /help.


def command_name(value):
    if not isinstance(value, str):
        raise ValueError('command_name_invalid')
    name = value.strip().removeprefix('/').lower()
    if not re.fullmatch(r'[a-z0-9_]{1,32}', name):
        raise ValueError('command_name_invalid')
    if name in ('start', 'help'):
        raise ValueError('command_reserved')
    return name


def validate_command(value):
    description = value.get('description') if isinstance(value, dict) else None
    if not isinstance(description, str) or not description.strip() or len(description.encode('utf-16-le')) // 2 > 256:
        raise ValueError('command_description_invalid')
    return {**validate_message(value), 'description': description.strip()}


def commands_config(saved):
    result = {}
    if isinstance(saved, dict):
        for name, value in list(saved.items())[:MAX_CUSTOM_COMMANDS]:
            try:
                result[command_name(name)] = validate_command(value)
            except ValueError:
                pass
    return result


def valid_url(value):
    if not isinstance(value, str) or len(value) > 512 or any(c.isspace() for c in value):
        return False
    try:
        p = urlsplit(value)
        return p.scheme == 'https' and bool(p.hostname) and not p.username and not p.password
    except ValueError:
        return False


def validate_message(value):
    if not isinstance(value, dict):
        raise ValueError('message_invalid')
    text = value.get('text')
    # Leave room for substituted names and gift titles within Telegram's 4096 limit.
    if not isinstance(text, str) or not text.strip() or len(text.encode('utf-16-le')) // 2 > 3500:
        raise ValueError('message_text_invalid')
    buttons = value.get('buttons', [])
    if not isinstance(buttons, list) or len(buttons) > 8:
        raise ValueError('message_buttons_invalid')
    clean = []
    for b in buttons:
        if not isinstance(b, dict):
            raise ValueError('message_button_invalid')
        label, action, target, style = b.get('text'), b.get('action'), b.get('target'), b.get('style', 'default')
        if not isinstance(label, str) or not label.strip() or len(label) > 64 or style not in BUTTON_STYLES:
            raise ValueError('message_button_invalid')
        if action == 'app':
            if target not in APP_VIEWS:
                raise ValueError('message_button_target_invalid')
        elif action == 'url':
            if not valid_url(target):
                raise ValueError('message_button_url_invalid')
        else:
            raise ValueError('message_button_action_invalid')
        item = {'text': label.strip(), 'action': action, 'target': target, 'style': style}
        icon = str(b.get('icon') or '').strip()
        if icon:
            if not EMOJI_ID_RE.fullmatch(icon):
                raise ValueError('message_button_invalid')
            item['icon'] = icon
        clean.append(item)
    return {'text': text.strip(), 'buttons': clean}


def messages_config(saved):
    result = deepcopy(DEFAULT_MESSAGES)
    if isinstance(saved, dict):
        for key, value in saved.items():
            if key in result:
                try:
                    result[key].update(validate_message(value))
                except ValueError:
                    pass
    return result


def message_payload(config, key, app_url, name='друг', gift='подарок', gift_emoji=''):
    item = config[key]
    replacements = {'name': str(name or 'друг')[:120], 'gift': str(gift or 'подарок')[:200]}
    # Single pass prevents placeholders in player-provided names from being expanded.
    # Текст уходит с parse_mode=HTML: всё экранируется, токены [emoji:ID:символ] становятся <tg-emoji>.
    def repl(m):
        if m.group(1) == 'gift_emoji':
            return gift_emoji or '🎁'  # готовый HTML (<tg-emoji>) из приложения
        if m.group(1):
            return escape(replacements[m.group(1)], quote=False)
        return f'<tg-emoji emoji-id="{m.group(2)}">{escape(m.group(3), quote=False)}</tg-emoji>'
    out, pos = [], 0
    for m in TOKEN_RE.finditer(item['text']):
        out.append(escape(item['text'][pos:m.start()], quote=False))
        out.append(repl(m))
        pos = m.end()
    out.append(escape(item['text'][pos:], quote=False))
    text = ''.join(out)
    rows = []
    for b in item['buttons']:
        button = {'text': b['text']}
        if b.get('icon'):
            button['icon_custom_emoji_id'] = b['icon']
        if b['style'] != 'default':
            button['style'] = b['style']
        if b['action'] == 'app':
            if not valid_url(app_url):
                continue
            p = urlsplit(app_url)
            query = [(k, v) for k, v in parse_qsl(p.query, keep_blank_values=True) if k != 'view']
            query.append(('view', b['target']))
            button['web_app'] = {'url': urlunsplit((p.scheme, p.netloc, p.path or '/', urlencode(query), p.fragment))}
        else:
            button['url'] = b['target']
        rows.append([button])
    result = {'text': text, 'html': True}
    if rows:
        result['reply_markup'] = {'inline_keyboard': rows}
    return result
