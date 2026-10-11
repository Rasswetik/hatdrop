import json
import os
import unittest
from unittest.mock import patch

from test_admin_dashboard import backend, signed_user


class BotCommandsAdminsTests(unittest.TestCase):
    def setUp(self):
        backend.db = {'users': {}, 'prices': {}, 'settings': {}, 'withdrawals': {}, 'promocodes': {}}
        backend.app.config.update(TESTING=True, SESSION_COOKIE_SECURE=False)
        self.client = backend.app.test_client()
        self.env = patch.dict(os.environ, {'PUBLIC_APP_URL': 'https://hatdrop.example/?source=bot'})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.telegram = patch.object(backend, 'tg_api', return_value=True)
        self.telegram_call = self.telegram.start()
        self.addCleanup(self.telegram.stop)

    def post(self, path, body=None, uid=101):
        return self.client.post(path, json={'initData': signed_user(uid), **(body or {})})

    def command(self, name='menu', text='Привет, {name}!', **extra):
        return self.post('/api/admin/bot/commands/save', {'command': name, 'description': 'Открыть меню',
            'message': {'text': text, 'buttons': [
                {'text': 'Играть', 'action': 'app', 'target': 'menu', 'style': 'primary'},
                {'text': 'Поддержка', 'action': 'url', 'target': 'https://t.me/support', 'style': 'success'}]}, **extra})

    def webhook(self, text):
        return self.client.post('/telegram/webhook', json={'message': {'from': {'id': 202, 'first_name': 'Иван'},
            'chat': {'type': 'private'}, 'text': text}}, headers={'X-Telegram-Bot-Api-Secret-Token': backend._webhook_secret()})

    def login(self, uid):
        ticket = self.post('/api/admin/session', uid=uid).json['ticket']
        client = backend.app.test_client()
        self.assertEqual(client.post('/admin/login', json={'ticket': ticket}).status_code, 200)
        with client.session_transaction() as session:
            csrf = session['admin_csrf']
        return client, {'X-Admin-CSRF': csrf}

    def test_custom_command_reply_buttons_menu_and_delete(self):
        created = self.command('/MENU', create=True)
        self.assertEqual(created.status_code, 200)
        self.assertTrue(created.json['menu_synced'])
        self.assertIn('command:menu', created.json['messages'])
        call = self.telegram_call.call_args
        self.assertEqual(call.args, ('setMyCommands',))
        self.assertEqual(call.kwargs['scope'], {'type': 'all_private_chats'})
        self.assertEqual([c['command'] for c in call.kwargs['commands']], ['start', 'help', 'menu'])
        self.assertEqual(self.command(create=True).json['error'], 'command_exists')
        with patch.object(backend, '_send_tg_async') as send:
            for text in ('/menu', '/menu@hatdrop_bot args', '/MENU'):
                self.assertEqual(self.webhook(text).status_code, 200)
                self.assertEqual(send.call_args.args[:2], ('tg202', 'Привет, Иван!'))
                buttons = send.call_args.args[2]['inline_keyboard']
                self.assertEqual(buttons[0][0]['web_app']['url'], 'https://hatdrop.example/?source=bot&view=menu')
                self.assertEqual(buttons[1][0]['url'], 'https://t.me/support')
                self.assertEqual(buttons[1][0]['style'], 'success')
            send.reset_mock()
            for text in ('menu', '/menux', '/unknown'):
                self.webhook(text)
            send.assert_not_called()
            self.assertEqual(self.command(text='Обновлённый ответ').status_code, 200)
            self.webhook('/menu')
            self.assertEqual(send.call_args.args[1], 'Обновлённый ответ')
            self.assertEqual(self.post('/api/admin/bot/commands/delete', {'command': 'menu'}).status_code, 200)
            send.reset_mock()
            self.webhook('/menu')
            send.assert_not_called()
            self.webhook('/start')
            self.assertIn('Добро пожаловать', send.call_args.args[1])
        self.assertEqual(len(self.telegram_call.call_args.kwargs['commands']), 2)

    def test_command_validation_auth_limit_and_telegram_failure(self):
        for name in ('start', '/help', 'a'*33, 'русский', 'space name', 'menu@bot', '', 123):
            self.assertEqual(self.command(name).status_code, 400)
        self.assertEqual(self.command(description='').json['error'], 'command_description_invalid')
        self.assertEqual(self.command(message={'text': 'Hi', 'buttons': [{'text': 'X', 'action': 'url', 'target': 'javascript:bad'}]}).status_code, 400)
        self.assertEqual(self.post('/api/admin/bot/commands/save', {'command': 'menu'}, uid=202).status_code, 403)
        self.assertEqual(self.post('/api/admin/bot/commands/delete', {'command': 'menu'}, uid=202).status_code, 403)
        self.assertEqual(self.post('/api/admin/bot/commands/sync', uid=202).status_code, 403)
        with patch.object(backend, 'tg_api', side_effect=ValueError('sensitive-token')):
            saved = self.command()
            self.assertEqual(saved.status_code, 200)
            self.assertFalse(saved.json['menu_synced'])
            self.assertNotIn('sensitive-token', json.dumps(saved.json))
        backend.db = json.loads(json.dumps(backend.db))
        self.assertIn('menu', self.post('/api/admin/bot/messages').json['commands'])
        self.assertTrue(self.post('/api/admin/bot/commands/sync').json['menu_synced'])
        backend.db['settings']['bot_commands'] = {f'cmd{i}': {'description': 'Command', 'text': 'Reply', 'buttons': []} for i in range(98)}
        self.assertEqual(self.command().json['error'], 'command_limit')
        self.assertEqual(self.command('cmd0').status_code, 200)

    def test_admin_add_before_first_login_seed_and_persistence(self):
        self.assertTrue(self.post('/api/state', uid=6718371539).json['is_admin'])
        self.assertFalse(self.post('/api/state', uid=909090).json['is_admin'])
        result = self.post('/api/admin/admins/save', {'telegram_id': '909090', 'action': 'add'})
        self.assertEqual(result.status_code, 200)
        self.assertTrue(self.post('/api/state', uid=909090).json['is_admin'])
        self.assertEqual(self.post('/api/admin/overview', uid=909090).status_code, 200)
        backend.db = json.loads(json.dumps(backend.db))
        self.assertTrue(self.post('/api/state', uid=909090).json['is_admin'])
        self.assertEqual(backend.db['settings']['admin_access_log'][-1]['by'], 'tg101')
        self.assertEqual(self.post('/api/admin/admins/save', {'telegram_id': '909090', 'action': 'remove'}).status_code, 200)
        self.assertFalse(self.post('/api/state', uid=909090).json['is_admin'])
        self.assertEqual(self.post('/api/admin/overview', uid=909090).status_code, 403)

    def test_admin_removal_revokes_cookies_and_unused_tickets(self):
        self.post('/api/admin/admins/save', {'telegram_id': '909090', 'action': 'add'})
        client, headers = self.login(909090)
        ticket = self.post('/api/admin/session', uid=909090).json['ticket']
        self.assertEqual(client.post('/api/admin/admins', json={}, headers=headers).status_code, 200)
        self.post('/api/admin/admins/save', {'telegram_id': '909090', 'action': 'remove'})
        self.assertEqual(client.post('/api/admin/admins', json={}, headers=headers).status_code, 403)
        self.assertEqual(client.post('/admin/login', json={'ticket': ticket}).status_code, 403)
        self.assertEqual(self.post('/api/admin/session', uid=909090).status_code, 403)
        self.post('/api/admin/admins/save', {'telegram_id': '6718371539', 'action': 'remove'})
        self.assertFalse(self.post('/api/state', uid=6718371539).json['is_admin'])
        self.post('/api/admin/admins/save', {'telegram_id': '6718371539', 'action': 'add'})
        self.assertTrue(self.post('/api/state', uid=6718371539).json['is_admin'])

    def test_admin_owner_validation_csrf_and_self_removal(self):
        self.assertEqual(self.post('/api/admin/admins/save', {'telegram_id': backend.OWNER_ADMIN_ID, 'action': 'remove'}).json['error'], 'admin_owner_protected')
        for value in ('tg202', '0', '-5', '1.1', 'x', '9'*21):
            self.assertEqual(self.post('/api/admin/admins/save', {'telegram_id': value, 'action': 'add'}).status_code, 400)
        self.assertEqual(self.post('/api/admin/admins/save', {'telegram_id': '202', 'action': 'add', 'is_admin': True}, uid=202).status_code, 403)
        client, headers = self.login(101)
        self.assertEqual(client.post('/api/admin/admins/save', json={'telegram_id': '202', 'action': 'add'}).status_code, 403)
        response = client.post('/api/admin/admins/save', json={'telegram_id': '101', 'action': 'remove'}, headers=headers)
        self.assertTrue(response.json['self_removed'])
        self.assertEqual(client.post('/api/admin/overview', json={}, headers=headers).status_code, 403)
        self.assertTrue(self.post('/api/state', uid=int(backend.OWNER_ADMIN_ID)).json['is_admin'])


if __name__ == '__main__':
    unittest.main()
