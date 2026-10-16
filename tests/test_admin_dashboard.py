import hashlib
import hmac
import json
import os
import tempfile
import time
from datetime import datetime, timezone
import unittest
from urllib.parse import urlencode
from unittest.mock import patch

_tmp = tempfile.TemporaryDirectory()
for name in ('DATABASE_URL','POSTGRES_URL','POSTGRESQL_URL','POSTSQL_URL','POSTSQL','POSTGRES','POSTGRESQL','PG_URL','POSTGRES_URI','KEEPALIVE_URL','RENDER_EXTERNAL_URL','TELEGRAM_BOT_TOKEN','TG_BOT_TOKEN'):
    os.environ[name] = ''
os.environ.update(DB_PATH=os.path.join(_tmp.name, 'db.json'), SQLITE_PATH=os.path.join(_tmp.name, 'db.sqlite3'), BOT_TOKEN='test-token', ADMIN_IDS='101')
import app as backend
from admin_dashboard import overview, finance_entry, day_key


def signed_user(uid):
    pairs = {'auth_date': str(int(time.time())), 'user': json.dumps({'id': uid, 'first_name': 'Tester'})}
    secret = hmac.new(b'WebAppData', b'test-token', hashlib.sha256).digest()
    pairs['hash'] = hmac.new(secret, '\n'.join(f'{k}={v}' for k,v in sorted(pairs.items())).encode(), hashlib.sha256).hexdigest()
    return urlencode(pairs)


class DashboardTests(unittest.TestCase):
    def setUp(self):
        backend.db = {'users': {}, 'prices': {}, 'settings': {}, 'withdrawals': {}, 'promocodes': {}}
        backend.app.config.update(TESTING=True, SESSION_COOKIE_SECURE=False)
        self.client = backend.app.test_client()

    def post(self, path, body=None, uid=101):
        return self.client.post(path, json={'initData': signed_user(uid), **(body or {})})

    def login(self):
        ticket = self.post('/api/admin/session').json['ticket']
        response = self.client.post('/admin/login', json={'ticket': ticket})
        self.assertEqual(response.status_code, 200)
        with self.client.session_transaction() as session:
            csrf = session['admin_csrf']
        return ticket, {'X-Admin-CSRF': csrf}

    def test_access_ticket_replay_csrf_and_logout(self):
        self.assertEqual(self.client.post('/api/admin/overview', json={}).status_code, 403)
        self.assertEqual(self.post('/api/admin/session', uid=202).status_code, 403)
        ticket, headers = self.login()
        self.assertEqual(self.client.post('/admin/login', json={'ticket': ticket}).status_code, 403)
        self.assertEqual(self.client.post('/api/admin/overview', json={}).status_code, 403)
        self.assertEqual(self.client.post('/api/admin/overview', json={}, headers=headers).status_code, 200)
        self.assertEqual(self.client.get('/admin').headers['Cache-Control'], 'private, no-store')
        self.assertEqual(self.client.post('/admin/logout', headers=headers).status_code, 200)
        self.assertEqual(self.client.post('/api/admin/overview', json={}, headers=headers).status_code, 403)

    def test_expired_ticket_and_session(self):
        ticket = self.post('/api/admin/session').json['ticket']
        backend.db['admin_tickets'][hashlib.sha256(ticket.encode()).hexdigest()]['expires']=0
        self.assertEqual(self.client.post('/admin/login', json={'ticket': ticket}).status_code, 403)
        _, headers=self.login()
        with self.client.session_transaction() as session:
            session['admin_exp']=0
        self.assertEqual(self.client.post('/api/admin/overview', json={}, headers=headers).status_code, 403)

    def test_real_demo_finance_and_retry(self):
        self.post('/api/state')
        self.client.post('/api/state', json={'demoId':'demo-test'})
        user=backend.db['users']['tg101']
        demo=next(u for u in backend.db['users'].values() if u['id'].startswith('demo'))
        backend.record_game(user,'upgrade',10,True,'Gift','',False,15)
        backend.record_game(user,'chests',4,False,'Loss','',False)
        backend.record_game(demo,'chests',300,True,'Demo','',False,600)
        entry={'kind':'expense','amount':2,'note':'Hosting','request_id':'retry-id'}
        a=finance_entry(backend.db,user,entry);b=finance_entry(backend.db,user,entry)
        self.assertEqual(a['id'],b['id'])
        with self.assertRaises(ValueError):
            finance_entry(backend.db,user,{**entry,'amount':4})
        finance_entry(backend.db,user,{'kind':'income','amount':1,'note':'Other income','request_id':'income-id'})
        real=overview(backend.db,7,'real');sim=overview(backend.db,7,'demo')
        self.assertEqual(real['totals']['games'],2)
        self.assertEqual(real['totals']['stakes'],14)
        self.assertEqual(real['totals']['payouts'],15)
        self.assertEqual(real['totals']['gross'],-1)
        self.assertEqual(real['totals']['net'],-2)
        self.assertEqual(sim['totals']['net'],-300)
        self.assertEqual(sim['totals']['expense'],0)
        self.assertEqual(len(real['entries']),2)
        self.assertEqual(len(real['series']),7)
        self.assertEqual(overview(json.loads(json.dumps(backend.db)),7)['totals'],real['totals'])
        self.assertEqual(real['totals']['games'],sum(r['games'] for r in real['series']))

    def test_real_spins_and_chest_cash_are_recorded(self):
        self.post('/api/state')
        with patch.object(backend.secrets,'randbelow',return_value=0):
            self.assertEqual(self.post('/api/spin',{'tier':'random','chance':.5}).status_code,200)
        user=backend.db['users']['tg101']
        user['chest']={'bet':1,'empties':3,'opened':[0],'source':'ton','bad':[1,2,3]}
        with patch.object(backend,'pick_gift_for',return_value=None):
            payout=backend.chest_cash(user)['payout_ton']
        data=overview(backend.db,1)
        self.assertEqual(data['totals']['games'],2)
        self.assertEqual(data['totals']['payouts'],round(3+payout,4))
        # A running game is not revenue until the outcome is known.
        before=overview(backend.db,1)['totals']['games']
        response=self.post('/api/chests/start',{'bet':.1,'empties':3})
        self.assertEqual(response.status_code,200)
        self.assertEqual(overview(backend.db,1)['totals']['games'],before)
        bad=user['chest']['bad'][0]
        self.assertFalse(self.post('/api/chests/open',{'cell':bad}).json['win'])
        self.assertEqual(overview(backend.db,1)['totals']['games'],before+1)
        # History truncation no longer discards financial accounting.
        user['history']=[]
        self.assertEqual(overview(backend.db,1)['totals']['payouts'],round(3+payout,4))

    def test_no_invented_history_and_validation(self):
        self.post('/api/state')
        user=backend.db['users']['tg101']
        user['history']=[{'ts':int(time.time()),'win':True,'cost_ton':10}]
        self.assertEqual(overview(backend.db)['totals']['games'],0)
        for amount in ('NaN', 'inf', -1, 0, .00001):
            response=self.post('/api/admin/finance/entry',{'kind':'expense','amount':amount,'note':'Bad','request_id':'bad'})
            self.assertEqual(response.status_code,400)
        self.assertEqual(self.post('/api/admin/overview',{'days':200}).status_code,400)
        before=datetime(2026,10,11,20,59,59,tzinfo=timezone.utc).timestamp()
        self.assertEqual(day_key(before), '2026-10-11')
        self.assertEqual(day_key(before+1), '2026-10-12')

    def test_withdrawal_queue_does_not_double_count_payout(self):
        self.post('/api/state', uid=202)
        user=backend.db['users']['tg202']
        prize=backend.add_prize(user,'random','Gift',3)
        backend.record_game(user,'upgrade',2,True,'Gift','',False,3)
        with patch.object(backend,'_send_tg_async'):
            response=self.post('/api/withdraw',{'prize_id':prize['id']},uid=202)
            self.assertEqual(response.status_code,200)
            key=f"tg202:{prize['id']}"
            self.assertIn(key,backend.db['withdrawals'])
            self.assertEqual(overview(backend.db,1)['withdrawals']['pending'],1)
            self.post('/api/admin/withdrawals/resolve',{'id':key,'action':'approve'})
            self.post('/api/admin/withdrawals/resolve',{'id':key,'action':'complete'})
        data=overview(backend.db,1)
        self.assertEqual(data['totals']['net'],-1)
        self.assertEqual(data['withdrawals']['completed_value'],3)
        self.assertEqual(data['withdrawals']['pending'],0)

    def test_management_keeps_working_with_cookie(self):
        _, headers=self.login()
        self.post('/api/state', uid=202)
        key=backend.db['users']['tg202']['key']
        response=self.client.post('/api/admin/balance',json={'key':key,'mode':'set','amount':7},headers=headers)
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.json['user']['balance_ton'],7)
        self.assertEqual(self.client.post('/api/admin/users',json={},headers=headers).json['total'],2)
        # Cookie auth is not accepted as a player's game identity.
        response=self.client.post('/api/state',json={'demoId':'separate'})
        self.assertFalse(response.json['is_admin'])

    def test_bot_message_defaults_edit_reset_and_auth(self):
        os.environ['PUBLIC_APP_URL']='https://hatdrop.example/app?source=bot'
        self.addCleanup(lambda: os.environ.pop('PUBLIC_APP_URL',None))
        self.assertEqual(self.post('/api/admin/bot/messages',uid=202).status_code,403)
        defaults=self.post('/api/admin/bot/messages').json
        self.assertEqual(defaults['messages']['welcome']['buttons'][0]['target'],'menu')
        message={'text':'Здравствуйте, {name}!','buttons':[{'text':'Открыть меню','action':'app','target':'menu','style':'success'},{'text':'Поддержка','action':'url','target':'https://t.me/support','style':'default'}]}
        _,headers=self.login()
        self.assertEqual(self.client.post('/api/admin/bot/messages/save',json={'key':'welcome','message':message}).status_code,403)
        result=self.client.post('/api/admin/bot/messages/save',json={'key':'welcome','message':message},headers=headers)
        self.assertEqual(result.status_code,200)
        with patch.dict(os.environ,{'TELEGRAM_WEBHOOK_SECRET':'secret'}), patch.object(backend,'_send_tg_async') as send:
            response=self.client.post('/telegram/webhook',json={'message':{'from':{'id':202,'first_name':'Иван'},'chat':{'id':202,'type':'private'},'text':'/start referral'}},headers={'X-Telegram-Bot-Api-Secret-Token':'secret'})
            self.assertEqual(response.status_code,200)
            args=send.call_args.args
            self.assertEqual(args[:2],('tg202','Здравствуйте, Иван!'))
            buttons=args[2]['inline_keyboard']
            self.assertEqual(buttons[0][0]['style'],'success')
            self.assertEqual(buttons[0][0]['web_app']['url'],'https://hatdrop.example/app?source=bot&view=menu')
            self.assertEqual(buttons[1][0]['url'],'https://t.me/support')
            send.reset_mock()
            self.client.post('/telegram/webhook',json={'message':{'from':{'id':202},'chat':{'type':'private'},'text':'/starter'}},headers={'X-Telegram-Bot-Api-Secret-Token':'secret'})
            send.assert_not_called()
        self.assertEqual(self.post('/api/admin/bot/messages/save',{'key':'welcome','reset':True}).json['message'],defaults['defaults']['welcome'])
        self.assertEqual(self.client.post('/telegram/webhook',json={}).status_code,403)

    def test_bot_message_validation_and_telegram_json(self):
        from bot_messages import validate_message, message_payload, messages_config
        for value in ({'text':''},{'text':'😀'*1800},{'text':'Hi','buttons':[{'text':'X','action':'url','target':'javascript:alert(1)','style':'primary'}]},{'text':'Hi','buttons':[{'text':'X','action':'app','target':'admin','style':'primary'}]}):
            with self.assertRaises(ValueError):validate_message(value)
        config=messages_config({'welcome':{'text':'{name} {gift}','buttons':[]}})
        self.assertEqual(message_payload(config,'welcome','https://example.com',name='{gift}',gift='Coin')['text'],'{gift} Coin')
        with patch.object(backend.urllib.request,'urlopen') as fetch:
            fetch.return_value.__enter__.return_value.read.return_value=b'{"ok":true,"result":true}'
            backend.tg_api('sendMessage',chat_id=202,text='Привет',reply_markup={'inline_keyboard':[[{'text':'Play','style':'primary','web_app':{'url':'https://example.com'}}]]})
            req=fetch.call_args.args[0]
            self.assertEqual(req.get_method(),'POST')
            self.assertEqual(json.loads(req.data)['reply_markup']['inline_keyboard'][0][0]['style'],'primary')

    def test_generated_webhook_secret_accepts_start_and_survives_restart(self):
        with patch.dict(os.environ,{'TELEGRAM_WEBHOOK_SECRET':''}):
            secret=backend._webhook_secret()
            self.assertRegex(secret,r'^[a-f0-9]{64}$')
            self.assertEqual(secret,backend._webhook_secret())
            self.assertNotEqual(secret,backend.app.secret_key)
            with patch.object(backend,'BOT_TOKEN','different-token'):
                self.assertNotEqual(secret,backend._webhook_secret())
            with patch.object(backend,'_send_tg_async') as send:
                message={'message':{'from':{'id':202,'first_name':'Иван'},'chat':{'type':'private'},'text':'/start'}}
                self.assertEqual(self.client.post('/telegram/webhook',json=message).status_code,403)
                self.assertEqual(self.client.post('/telegram/webhook',json=message,headers={'X-Telegram-Bot-Api-Secret-Token':'wrong'}).status_code,403)
                response=self.client.post('/telegram/webhook',json=message,headers={'X-Telegram-Bot-Api-Secret-Token':secret})
                self.assertEqual(response.status_code,200)
                self.assertIn('Добро пожаловать',send.call_args.args[1])
            status=self.post('/api/admin/bot/status').json
            self.assertTrue(status['webhook_secret_configured'])
            self.assertNotIn(secret,json.dumps(status))
        with patch.dict(os.environ,{'TELEGRAM_WEBHOOK_SECRET':'existing-secret'}):
            self.assertEqual(backend._webhook_secret(),'existing-secret')

    def test_connect_bot_without_secret_verify_and_idempotent_restart(self):
        state={'url':'','allowed_updates':['message']}
        def telegram(method,**params):
            if method=='getMe':return {'username':'hatdrop_test_bot'}
            if method=='getWebhookInfo':return dict(state)
            if method=='setWebhook':
                self.assertRegex(params['secret_token'],r'^[a-f0-9]{64}$')
                self.assertEqual(params['allowed_updates'],['message','pre_checkout_query'])
                self.assertNotIn('drop_pending_updates',params)
                state['url']=params['url'];state['allowed_updates']=params['allowed_updates'];return True
            raise AssertionError(method)
        env={'TELEGRAM_WEBHOOK_SECRET':'','RENDER_EXTERNAL_URL':'https://hatdrop.onrender.com','PUBLIC_APP_URL':'https://app.example.com/path?x=1'}
        with patch.dict(os.environ,env),patch.object(backend,'tg_api',side_effect=telegram) as call:
            self.assertEqual(self.post('/api/admin/bot/setup',uid=202).status_code,403)
            result=self.post('/api/admin/bot/setup')
            self.assertEqual(result.status_code,200)
            self.assertEqual(result.json['webhook_url'],'https://hatdrop.onrender.com/telegram/webhook')
            self.assertEqual(backend.db['settings']['bot_username'],'hatdrop_test_bot')
            self.assertTrue(self.post('/api/admin/bot/status').json['connected'])
            self.assertNotIn(backend._webhook_secret(),json.dumps(backend.db['settings']))
            call.reset_mock();backend.bot_connect_on_start()
            self.assertNotIn('setWebhook',[c.args[0] for c in call.call_args_list])
            state['url']='https://old.example.com/webhook'
            self.assertFalse(self.post('/api/admin/bot/status').json['connected'])
            backend.bot_connect_on_start()
            self.assertIn('setWebhook',[c.args[0] for c in call.call_args_list])
        with patch.dict(os.environ,{'RENDER_EXTERNAL_URL':'','PUBLIC_APP_URL':'https://app.example.com/path?x=1'}):
            self.assertEqual(backend._webhook_url(),'https://app.example.com/telegram/webhook')

    def test_webhook_setup_errors_do_not_report_success_or_leak_tokens(self):
        with patch.dict(os.environ,{'RENDER_EXTERNAL_URL':'https://hatdrop.onrender.com','TELEGRAM_WEBHOOK_SECRET':'bad secret'}):
            self.assertEqual(self.post('/api/admin/bot/setup').json['error'],'webhook_secret_invalid')
        with patch.dict(os.environ,{'RENDER_EXTERNAL_URL':'https://hatdrop.onrender.com','TELEGRAM_WEBHOOK_SECRET':''}),patch.object(backend,'tg_api',side_effect=ValueError('sensitive-token')):
            result=self.post('/api/admin/bot/setup')
            self.assertEqual(result.status_code,400)
            self.assertEqual(result.json['error'],'telegram_webhook_failed')
            self.assertNotIn('sensitive-token',result.get_data(as_text=True))
            self.assertNotIn('bot_webhook',backend.db['settings'])
        with patch.object(backend,'BOT_TOKEN',''):
            self.assertEqual(self.post('/api/admin/bot/setup').status_code,403)
            with self.assertRaises(backend.ApiError) as error:backend._configure_bot_webhook('https://example.com')
            self.assertEqual(error.exception.code,'bot_token_missing')
        with patch.dict(os.environ,{'RENDER_EXTERNAL_URL':'','PUBLIC_APP_URL':'','APP_URL':'','SITE_URL':''}):
            with self.assertRaises(backend.ApiError) as error:backend._configure_bot_webhook('http://localhost')
            self.assertEqual(error.exception.code,'https_required')

    def test_automatic_webhook_connection_retries_transient_failure(self):
        with patch.object(backend,'_configure_bot_webhook',side_effect=[backend.ApiError('telegram_webhook_failed'),{'ok':True}]) as connect,patch.object(backend.time,'sleep') as sleep:
            backend.bot_connect_on_start()
            self.assertEqual(connect.call_count,2)
            sleep.assert_called_once_with(10)


if __name__ == '__main__':
    unittest.main()
