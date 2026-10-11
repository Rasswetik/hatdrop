"""Editable Telegram messages and their inline keyboards."""
import re
from copy import deepcopy
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode

PLAY = {'text': '🎮 Играть', 'action': 'app', 'target': 'menu', 'style': 'primary'}
DEFAULT_MESSAGES = {
    'welcome': {'label': 'Приветствие /start', 'text': '👋 Привет, {name}! Добро пожаловать в HatDrop.\n\nВыбирайте режим, открывайте сундуки и собирайте подарки. Нажмите «Играть», чтобы открыть меню.', 'buttons': [PLAY]},
    'help': {'label': 'Помощь /help', 'text': '🎩 HatDrop\n\nНажмите «Играть», чтобы выбрать режим. Ваши подарки и заявки на вывод доступны в профиле.', 'buttons': [PLAY]},
    'withdraw_pending': {'label': 'Заявка на вывод получена', 'text': '🎁 Заявка на вывод подарка «{gift}» получена. Мы сообщим о решении.', 'buttons': []},
    'withdraw_approved': {'label': 'Вывод одобрен', 'text': '✅ Ваш подарок «{gift}» найден. Заявка одобрена, ожидайте отправки.', 'buttons': []},
    'withdraw_rejected': {'label': 'Вывод отклонён', 'text': '❌ Заявка на подарок «{gift}» отклонена. Подарок возвращён в инвентарь.', 'buttons': []},
    'withdraw_completed': {'label': 'Вывод выполнен', 'text': '🎉 Вывод подарка «{gift}» отмечен как выполненный администратором.', 'buttons': []},
}
APP_VIEWS = ('menu', 'upgrade', 'chests', 'profile')
BUTTON_STYLES = ('default', 'primary', 'success', 'danger')


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
        clean.append({'text': label.strip(), 'action': action, 'target': target, 'style': style})
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


def message_payload(config, key, app_url, name='друг', gift='подарок'):
    item = config[key]
    replacements = {'name': str(name or 'друг')[:120], 'gift': str(gift or 'подарок')[:200]}
    # Single pass prevents placeholders in player-provided names from being expanded.
    text = re.sub(r'\{(name|gift)\}', lambda m: replacements[m.group(1)], item['text'])
    text = text.encode('utf-16-le')[:8192].decode('utf-16-le', errors='ignore')
    rows = []
    for b in item['buttons']:
        button = {'text': b['text']}
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
    result = {'text': text}
    if rows:
        result['reply_markup'] = {'inline_keyboard': rows}
    return result
