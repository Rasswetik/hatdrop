/* Перевод интерфейса: русский, английский, китайский.

   Ключ словаря — русский текст (как он написан в index.html и app.js),
   значение — { en, zh }. Если перевода нет, остаётся русский текст, так что
   забытая строка ничего не ломает.

   Язык берётся так: что игрок выбрал в профиле (localStorage) → язык его
   Telegram → язык браузера. Смена языка — I18N.setLang('en'): страница не
   перезагружается, тексты в разметке меняются на месте, а приложению
   уходит событие langchange, по которому оно перерисовывает своё.

   Файл подключается в index.html ПЕРЕД app.js. */
(function () {
  'use strict';

  const LANGS = [
    { code: 'ru', label: 'Русский', locale: 'ru-RU' },
    { code: 'en', label: 'English', locale: 'en-US' },
    { code: 'zh', label: '中文', locale: 'zh-CN' },
  ];
  const STORE_KEY = 'lang';

  function normalize(code) {
    const c = String(code || '').toLowerCase();
    if (!c) return '';
    if (c.startsWith('zh')) return 'zh';
    if (c.startsWith('ru') || c.startsWith('uk') || c.startsWith('be') || c.startsWith('kk')) return 'ru';
    return 'en';
  }

  function detect() {
    try {
      const saved = localStorage.getItem(STORE_KEY);
      if (saved && LANGS.some((l) => l.code === saved)) return saved;
    } catch (e) { /* хранилище недоступно — определим по Telegram */ }
    let tgLang = '';
    try { tgLang = window.Telegram.WebApp.initDataUnsafe.user.language_code || ''; } catch (e) { /* не в Telegram */ }
    return normalize(tgLang) || normalize(navigator.language) || 'ru';
  }

  let lang = detect();

  const DICT = {
    // ---------- шапка, вкладки
    'ШляпоКоины — кешбэк за игры': { en: 'HatCoins — cashback for playing', zh: '帽子币——游戏返现' },
    'ШляпоКоины': { en: 'HatCoins', zh: '帽子币' },
    'Баланс, пополнить': { en: 'Balance, top up', zh: '余额，充值' },
    'Пополнить баланс': { en: 'Top up balance', zh: '充值余额' },
    'Три шляпы': { en: 'Three Hats', zh: '三顶帽子' },
    'Апгрейд': { en: 'Upgrade', zh: '升级' },
    'Топ': { en: 'Top', zh: '排行' },
    'Профиль': { en: 'Profile', zh: '个人' },

    // ---------- три шляпы
    'ТРИ ШЛЯПЫ': { en: 'THREE HATS', zh: '三顶帽子' },
    'Играть': { en: 'Play', zh: '开始' },
    'Угадать': { en: 'Guess', zh: '猜一猜' },
    'шанс 1 из 3': { en: '1 in 3 chance', zh: '3 选 1' },
    'сменить': { en: 'change', zh: '更换' },
    'под одной спрятан подарок — найди его': { en: 'a gift is hidden under one — find it', zh: '其中一顶下面藏着礼物——找到它' },
    'Жми «Угадать» — подарок покажется и спрячется': { en: 'Tap “Guess” — the gift will show up and hide', zh: '点击“猜一猜”——礼物会出现然后藏起来' },
    'Подарок сейчас спрячется': { en: 'The gift is about to hide', zh: '礼物马上藏起来' },
    'Где подарок? Жми на шляпу': { en: 'Where is the gift? Tap a hat', zh: '礼物在哪？点一顶帽子' },
    'Подарок твой! Он уже в профиле': { en: 'The gift is yours! It’s in your profile', zh: '礼物归你了！已放入个人页' },
    'Подарок был не там. Ещё разок?': { en: 'The gift wasn’t there. One more try?', zh: '礼物不在那里。再来一次？' },
    'под одной сидит кот — найди его': { en: 'a cat sits under one — find it', zh: '其中一顶下面有只猫——找到它' },
    'Жми «Угадать» — кот покажется и спрячется': { en: 'Tap “Guess” — the cat will show up and hide', zh: '点击“猜一猜”——猫会出现然后藏起来' },
    'Кот сейчас спрячется': { en: 'The cat is about to hide', zh: '猫马上藏起来' },
    'Где кот? Жми на шляпу': { en: 'Where is the cat? Tap a hat', zh: '猫在哪？点一顶帽子' },
    'Кот твой! Приз в профиле': { en: 'The cat is yours! The prize is in your profile', zh: '猫归你了！奖品已放入个人页' },
    'Кот был не там. Ещё разок?': { en: 'The cat wasn’t there. One more try?', zh: '猫不在那里。再来一次？' },
    '{price} TON · шанс 1 из {cups}': { en: '{price} TON · 1 in {cups} chance', zh: '{price} TON · {cups} 选 1' },
    'шанс 1 из {cups}': { en: '1 in {cups} chance', zh: '{cups} 选 1' },
    'Идёт игра…': { en: 'Playing…', zh: '游戏中…' },
    'Угадать за {sum} TON': { en: 'Guess for {sum} TON', zh: '猜一猜 · {sum} TON' },
    'Не хватает на игру': { en: 'Not enough to play', zh: '余额不足' },
    'Режим сейчас выключен': { en: 'This mode is off right now', zh: '该模式暂时关闭' },
    'Партия устарела, ставка вернулась — жми «Угадать»': { en: 'The round expired, your stake is back — tap “Guess”', zh: '本局已过期，押注已退回——请点击“猜一猜”' },
    'Странный выбор, попробуй ещё раз': { en: 'Odd choice, try again', zh: '选择无效，请再试一次' },

    // ---------- апгрейд
    'Приз:': { en: 'Prize:', zh: '奖品：' },
    'Приз': { en: 'Prize', zh: '奖品' },
    'Выбор приза': { en: 'Prize selection', zh: '选择奖品' },
    'Рандом': { en: 'Random', zh: '随机' },
    'Подарки': { en: 'Gifts', zh: '礼物' },
    'Оникс': { en: 'Onyx', zh: '缟玛瑙' },
    'Блэк': { en: 'Black', zh: '黑色' },
    'Выбрать подарок': { en: 'Choose a gift', zh: '选择礼物' },
    'Нажми, чтобы выбрать любой подарок': { en: 'Tap to choose any gift', zh: '点击选择任意礼物' },
    'Шанс выигрыша': { en: 'Win chance', zh: '中奖概率' },
    'Быстрая прокрутка': { en: 'Fast spin', zh: '快速旋转' },
    'не выбран': { en: 'not chosen', zh: '未选择' },
    'Шляпа волшебника': { en: 'Wizard Hat', zh: '巫师帽' },
    'Шляпа на ониксе': { en: 'Hat on Onyx', zh: '缟玛瑙底帽子' },
    'Шляпа на блэке': { en: 'Hat on Black', zh: '黑底帽子' },
    'Волшебный мишка': { en: 'Magic Bear', zh: '魔法小熊' },
    'по умолчанию': { en: 'default', zh: '默认' },
    'фон оникс': { en: 'onyx backdrop', zh: '缟玛瑙背景' },
    'фон блэк': { en: 'black backdrop', zh: '黑色背景' },
    'любая модель': { en: 'any model', zh: '任意款式' },
    'Хоть тебе и не повезло, но держи волшебного мишку, пускай он принесёт тебе удачу! 🧸':
      { en: 'No luck this time, but here’s a magic bear — may it bring you luck! 🧸', zh: '这次运气不好，送你一只魔法小熊，愿它带来好运！🧸' },
    'Цена подарка обновилась — проверь и крути снова': { en: 'The gift price has changed — check it and try again', zh: '礼物价格已更新——请确认后重试' },
    'Этот подарок сейчас недоступен': { en: 'This gift is unavailable right now', zh: '该礼物暂时不可用' },

    // ---------- выбор подарка
    'Загружаю…': { en: 'Loading…', zh: '加载中…' },
    'Выбери подарок': { en: 'Choose a gift', zh: '选择礼物' },
    'Поиск модели': { en: 'Search model', zh: '搜索款式' },
    'Поиск коллекции': { en: 'Search collection', zh: '搜索系列' },
    'Поиск': { en: 'Search', zh: '搜索' },
    'Любая модель': { en: 'Any model', zh: '任意款式' },
    'Загружаю модели…': { en: 'Loading models…', zh: '正在加载款式…' },
    'Ничего не нашлось': { en: 'Nothing found', zh: '未找到' },
    'Загружаю подарки…': { en: 'Loading gifts…', zh: '正在加载礼物…' },
    'Подарки пока недоступны': { en: 'Gifts are unavailable for now', zh: '礼物暂不可用' },
    'Шляпы': { en: 'Hats', zh: '帽子' },
    'Назад': { en: 'Back', zh: '返回' },
    'Шляпа — приз по умолчанию. Или выбери коллекцию, потом модель — или «Любая модель».':
      { en: 'The hat is the default prize. Or pick a collection, then a model — or “Any model”.', zh: '帽子是默认奖品。也可以先选系列，再选款式——或“任意款式”。' },
    'Сортировка': { en: 'Sorting', zh: '排序' },
    'Популярные': { en: 'Popular', zh: '热门' },
    'Дорогие': { en: 'Expensive', zh: '高价' },
    'Дешёвые': { en: 'Cheap', zh: '低价' },

    // ---------- профиль
    'ПРОФИЛЬ': { en: 'PROFILE', zh: '个人资料' },
    'Игрок': { en: 'Player', zh: '玩家' },
    'Кошелёк не подключён': { en: 'Wallet not connected', zh: '未连接钱包' },
    'не настроен': { en: 'not set up', zh: '未设置' },
    'До уровня {level}: ещё {left} TON оборота': { en: 'To level {level}: {left} TON more turnover', zh: '距离 {level} 级：还需 {left} TON 流水' },
    'Выведено': { en: 'Withdrawn', zh: '已提取' },
    'Лучший дроп': { en: 'Best drop', zh: '最佳掉落' },
    'Оборот': { en: 'Turnover', zh: '流水' },
    'пока нет': { en: 'none yet', zh: '暂无' },
    'Язык': { en: 'Language', zh: '语言' },
    'Дизайн': { en: 'Design', zh: '主题' },
    'Меню': { en: 'Menu', zh: '菜单' },
    'Настройки': { en: 'Settings', zh: '设置' },
    'МЕНЮ': { en: 'MENU', zh: '菜单' },
    'Лидеры': { en: 'Leaders', zh: '排行榜' },
    'по обороту за всё время': { en: 'by all-time turnover', zh: '按历史总流水' },
    'Аноним': { en: 'Anonymous', zh: '匿名' },
    'Вкл': { en: 'On', zh: '开' },
    'Выкл': { en: 'Off', zh: '关' },
    'Оружие': { en: 'Weapon', zh: '武器' },
    'Тип крутки': { en: 'Spin style', zh: '旋转方式' },
    'День / ночь': { en: 'Day / night', zh: '白天 / 夜晚' },
    'Обычная': { en: 'Classic', zh: '普通' },
    'Азартная': { en: 'Wild', zh: '刺激' },
    'Топор': { en: 'Axe', zh: '斧头' },
    'Посох': { en: 'Staff', zh: '法杖' },
    'Топ уровней': { en: 'Level top', zh: '等级排行' },
    'История': { en: 'History', zh: '记录' },
    'История игр': { en: 'Game history', zh: '游戏记录' },
    'Награды за места в топе скоро появятся — какие именно, пока секрет.':
      { en: 'Rewards for top places are coming soon — which ones is still a secret.', zh: '排行榜名次奖励即将上线——具体内容暂时保密。' },
    'Пока никто не играл': { en: 'Nobody has played yet', zh: '还没有人玩过' },
    'Твоё место: #{rank} · LVL {level}': { en: 'Your place: #{rank} · LVL {level}', zh: '你的名次：#{rank} · LVL {level}' },
    'Сыграй, чтобы попасть в топ': { en: 'Play to get into the top', zh: '开始游戏即可上榜' },
    'Не удалось загрузить игрока': { en: 'Couldn’t load the player', zh: '玩家信息加载失败' },
    'Не удалось загрузить историю': { en: 'Couldn’t load the history', zh: '记录加载失败' },
    'Игр пока не было': { en: 'No games yet', zh: '还没有游戏记录' },
    'Выигрыш': { en: 'Win', zh: '中奖' },
    'Мимо': { en: 'Miss', zh: '未中' },
    'Новый': { en: 'New', zh: '新版' },
    'Старый': { en: 'Classic', zh: '经典' },
    'Рефералы': { en: 'Referrals', zh: '邀请好友' },
    'Получай': { en: 'Get', zh: '获得好友' },
    'с каждого депозита друзей': { en: 'of every deposit your friends make', zh: '每笔充值的返利' },
    'Создать реферальную ссылку': { en: 'Create referral link', zh: '生成邀请链接' },
    'заработано TON': { en: 'TON earned', zh: '已赚取 TON' },
    'Доступно': { en: 'Available', zh: '可提取' },
    'В обработке: {sum} TON': { en: 'Processing: {sum} TON', zh: '处理中：{sum} TON' },
    'Вывод от {sum} TON': { en: 'Withdraw from {sum} TON', zh: '{sum} TON 起提' },
    'Ссылки временно недоступны': { en: 'Links are temporarily unavailable', zh: '链接暂时不可用' },
    'Не удалось создать ссылку': { en: 'Couldn’t create the link', zh: '生成链接失败' },
    'Скопировано': { en: 'Copied', zh: '已复制' },
    'Копировать': { en: 'Copy', zh: '复制' },
    'Копир.': { en: 'Copy', zh: '复制' },
    'Не удалось скопировать': { en: 'Couldn’t copy', zh: '复制失败' },
    'Минимум для вывода — {sum} TON': { en: 'Minimum withdrawal is {sum} TON', zh: '最低提取 {sum} TON' },
    'Не удалось создать заявку': { en: 'Couldn’t create the request', zh: '创建申请失败' },
    'Промокод': { en: 'Promo code', zh: '兑换码' },
    'Активировать': { en: 'Redeem', zh: '兑换' },
    'Промокод активирован: +{sum} TON': { en: 'Promo code redeemed: +{sum} TON', zh: '兑换成功：+{sum} TON' },
    'Такого промокода нет': { en: 'No such promo code', zh: '兑换码不存在' },
    'Этот промокод больше не действует': { en: 'This promo code is no longer valid', zh: '该兑换码已失效' },
    'Этот промокод уже разобрали': { en: 'This promo code is used up', zh: '该兑换码已被领完' },
    'Ты уже активировал этот промокод': { en: 'You’ve already redeemed this promo code', zh: '你已使用过该兑换码' },
    'Слишком много попыток, подожди минуту': { en: 'Too many attempts, wait a minute', zh: '尝试次数过多，请稍等一分钟' },
    'Не получилось активировать': { en: 'Couldn’t redeem', zh: '兑换失败' },
    'Мои призы': { en: 'My prizes', zh: '我的奖品' },
    'Продать всё': { en: 'Sell all', zh: '全部出售' },
    'Пока пусто. Крути апгрейд — выбитые призы появятся здесь.':
      { en: 'Empty for now. Prizes you win will show up here.', zh: '暂时为空。赢得的奖品会显示在这里。' },
    'Продать {prizes} за {sum} TON? Призы, по которым подана заявка на вывод, останутся.':
      { en: 'Sell {prizes} for {sum} TON? Prizes with a withdrawal request will stay.', zh: '以 {sum} TON 出售 {prizes}？已申请提取的奖品会保留。' },
    'Продано {n} шт. на {sum} TON': { en: 'Sold {n} for {sum} TON', zh: '已出售 {n} 件，共 {sum} TON' },
    'Продано за {sum} TON': { en: 'Sold for {sum} TON', zh: '已以 {sum} TON 出售' },
    'Продать {sum}': { en: 'Sell {sum}', zh: '出售 {sum}' },
    'Продавать нечего': { en: 'Nothing to sell', zh: '没有可出售的奖品' },
    'Не удалось продать': { en: 'Couldn’t sell', zh: '出售失败' },
    'Продажа сейчас отключена': { en: 'Selling is disabled right now', zh: '出售功能暂时关闭' },
    'Приз уже продан или ушёл на вывод': { en: 'The prize is already sold or being withdrawn', zh: '奖品已出售或正在提取' },
    'Слишком быстро, попробуй ещё раз': { en: 'Too fast, try again', zh: '操作太快，请重试' },
    'Слишком много запросов, подожди немного': { en: 'Too many requests, wait a bit', zh: '请求过多，请稍候' },
    'Слишком часто, подожди секунду': { en: 'Too often, wait a second', zh: '操作太频繁，请稍等' },
    'д': { en: 'd', zh: '天' },
    'ч': { en: 'h', zh: '时' },
    'м': { en: 'm', zh: '分' },
    'Вывод через {time}': { en: 'Withdraw in {time}', zh: '{time} 后可提取' },
    'После пополнения подарком вывод открывается через срок возврата платежа':
      { en: 'After a gift top-up, withdrawals open once the payment refund period has passed', zh: '使用礼物充值后，需等退款期结束才能提取' },
    'Вывод откроется через срок после пополнения подарком':
      { en: 'Withdrawals open some time after a gift top-up', zh: '礼物充值后需等待一段时间才能提取' },
    'Вывести': { en: 'Withdraw', zh: '提取' },
    'Выдаётся': { en: 'Sending', zh: '发放中' },
    'В обработке': { en: 'Processing', zh: '处理中' },
    'Мишка отправлен тебе подарком в Telegram 🧸': { en: 'The bear has been sent to you as a Telegram gift 🧸', zh: '小熊已作为 Telegram 礼物发送给你 🧸' },
    'Вывод этого подарка стоит {sum} TON — спишется с баланса. Вывести?':
      { en: 'Withdrawing this gift costs {sum} TON — it will be charged from your balance. Withdraw?', zh: '提取该礼物需支付 {sum} TON——将从余额扣除。确认提取？' },
    'Вывод этого подарка стоит {sum} TON — не хватает на балансе':
      { en: 'Withdrawing this gift costs {sum} TON — not enough on your balance', zh: '提取该礼物需支付 {sum} TON——余额不足' },
    'Плата за вывод изменилась — попробуй ещё раз': { en: 'The withdrawal fee has changed — try again', zh: '提取费用已变更——请重试' },
    'Заявка на вывод создана': { en: 'Withdrawal request created', zh: '提取申请已创建' },
    'Заявка уже создана': { en: 'The request already exists', zh: '申请已存在' },

    // ---------- топ
    'ТОП ИГРОКОВ': { en: 'TOP PLAYERS', zh: '玩家排行' },
    'по объёму игры · сезон с': { en: 'by play volume · season since', zh: '按游戏流水 · 赛季开始于' },
    'Рейтинг': { en: 'Ranking', zh: '排名' },
    'Пока никто не играл. Крути — и займёшь первое место!':
      { en: 'Nobody has played yet. Spin and take first place!', zh: '还没有人参与。快来争第一！' },
    'Сезон завершён — подводим итоги': { en: 'The season is over — counting results', zh: '赛季已结束——正在结算' },
    'Итоги через': { en: 'Results in', zh: '距离结算' },
    'место свободно': { en: 'spot is free', zh: '虚位以待' },
    'Админы в рейтинге не участвуют': { en: 'Admins don’t take part in the ranking', zh: '管理员不参与排名' },
    'Твоё место': { en: 'Your place', zh: '你的名次' },
    'Тебя пока нет в топе — крути апгрейд или играй в «Три шляпы», чтобы попасть в рейтинг':
      { en: 'You’re not in the top yet — play Upgrade or “Three Hats” to get ranked', zh: '你还未上榜——玩“升级”或“三顶帽子”即可进入排名' },
    '{name} (ты)': { en: '{name} (you)', zh: '{name}（你）' },

    // ---------- окно выигрыша
    'Поздравляем!': { en: 'Congratulations!', zh: '恭喜！' },
    'Приз уже в профиле': { en: 'The prize is in your profile', zh: '奖品已放入个人页' },
    'Перейти в апгрейд': { en: 'Go to Upgrade', zh: '前往升级' },
    'Перейти в профиль': { en: 'Go to Profile', zh: '前往个人页' },

    // ---------- пополнение
    'Пополнение': { en: 'Top up', zh: '充值' },
    'Перевод в TON зачислится автоматически в течение минуты.':
      { en: 'A TON transfer is credited automatically within a minute.', zh: 'TON 转账将在一分钟内自动到账。' },
    'Сменить': { en: 'Change', zh: '更换' },
    'Отправить': { en: 'Send', zh: '发送' },
    'Подключить': { en: 'Connect', zh: '连接' },
    'Отвязать': { en: 'Disconnect', zh: '断开' },
    'Нет кошелька': { en: 'No wallet', zh: '无钱包' },
    'Кошелёк недоступен': { en: 'Wallet unavailable', zh: '钱包不可用' },
    'Минимум {sum} TON': { en: 'Minimum {sum} TON', zh: '最低 {sum} TON' },
    'Недостаточно средств': { en: 'Insufficient funds', zh: '余额不足' },
    '🎁 Пополнить подарком': { en: '🎁 Top up with a gift', zh: '🎁 用礼物充值' },
    'Пополнить подарком': { en: 'Top up with a gift', zh: '用礼物充值' },
    'Перевести вручную': { en: 'Transfer manually', zh: '手动转账' },
    'Адрес': { en: 'Address', zh: '地址' },
    'Комментарий (обязательно!)': { en: 'Comment (required!)', zh: '备注（必填！）' },
    'Без комментария платёж не будет зачислен автоматически.':
      { en: 'Without the comment the payment won’t be credited automatically.', zh: '不填写备注将无法自动到账。' },
    'Закрыть': { en: 'Close', zh: '关闭' },
    'Открыть аккаунт': { en: 'Open account', zh: '打开账号' },
    'Открыть @{account}': { en: 'Open @{account}', zh: '打开 @{account}' },
    'Не видишь подарок? Включи его показ в профиле Telegram. Обычные (не улучшенные) подарки не принимаются.':
      { en: 'Don’t see your gift? Turn on its display in your Telegram profile. Regular (non-upgraded) gifts are not accepted.', zh: '看不到礼物？请在 Telegram 个人资料中开启展示。不接受普通（未升级）礼物。' },
    'Подари улучшенный подарок на @{account} — зачислим {percent}% от самой низкой цены его коллекции на маркетах (по данным peek.tg). Модель и фон не важны.':
      { en: 'Send an upgraded gift to @{account} — we’ll credit {percent}% of its collection’s lowest market price (per peek.tg). Model and backdrop don’t matter.', zh: '将升级礼物赠送给 @{account}——我们将按该系列市场最低价的 {percent}% 入账（数据来自 peek.tg）。款式和背景不影响金额。' },
    'Свой подарок — вывод призов не блокируется. Если купишь подарок на маркете, вывод откроется через {days} дн. (срок возврата платежа в Telegram).':
      { en: 'Your own gift doesn’t block prize withdrawals. If you buy a gift on a market, withdrawals open in {days} days (Telegram’s payment refund period).', zh: '使用自己的礼物不会限制提取。如果礼物是在市场购买的，需等 {days} 天后才能提取（Telegram 退款期）。' },
    'Смотрю подарки в твоём профиле…': { en: 'Looking at the gifts in your profile…', zh: '正在查看你的礼物…' },
    'Пополнение подарками сейчас выключено': { en: 'Gift top-ups are off right now', zh: '礼物充值暂时关闭' },
    'Не удалось получить подарки. Попробуй ещё раз чуть позже.': { en: 'Couldn’t load gifts. Try again a bit later.', zh: '获取礼物失败，请稍后再试。' },
    'Маркет сейчас не отвечает — подарок можно отправить, его оценит админ вручную.':
      { en: 'The market isn’t responding — you can still send the gift, an admin will price it manually.', zh: '市场暂无响应——仍可发送礼物，管理员会手动估价。' },
    'В профиле нет улучшенных подарков. Если они есть — включи их показ в профиле Telegram.':
      { en: 'No upgraded gifts in your profile. If you have some, turn on their display in your Telegram profile.', zh: '个人资料中没有升级礼物。如果有，请在 Telegram 个人资料中开启展示。' },
    'оценит админ': { en: 'priced by admin', zh: '管理员估价' },
    '1. Открой «{title}» в своём профиле Telegram': { en: '1. Open “{title}” in your Telegram profile', zh: '1. 在 Telegram 个人资料中打开“{title}”' },
    '2. Нажми «Передать»': { en: '2. Tap “Transfer”', zh: '2. 点击“转赠”' },
    '3. Выбери @{account}': { en: '3. Choose @{account}', zh: '3. 选择 @{account}' },
    'Придёт около {sum} TON — точная сумма по цене в момент получения. Бот пришлёт сообщение.':
      { en: 'About {sum} TON will arrive — the exact amount depends on the price at the moment of receipt. The bot will message you.', zh: '约到账 {sum} TON——具体金额以收到时的价格为准。机器人会发消息通知。' },
    'Этот подарок проверит админ — бот пришлёт сообщение с суммой.':
      { en: 'An admin will check this gift — the bot will message you the amount.', zh: '该礼物将由管理员审核——机器人会发送金额通知。' },

    'Ещё разок?': { en: 'One more try?', zh: '再来一次？' },
    'Мешаем!': { en: 'Shuffling!', zh: '洗牌中！' },
    'Смотрим…': { en: 'Let’s see…', zh: '揭晓中…' },
    'Цена подарка обновилась — проверь и жми «Угадать»': { en: 'The gift price has changed — check it and tap “Guess”', zh: '礼物价格已更新——请确认后点击“猜一猜”' },
    'Этот подарок сейчас недоступен — выбери другой': { en: 'This gift is unavailable right now — choose another', zh: '该礼物暂时不可用——请选择其他礼物' },
    'Не удалось загрузить подарки': { en: 'Couldn’t load gifts', zh: '礼物加载失败' },
    'Не удалось загрузить модели': { en: 'Couldn’t load models', zh: '款式加载失败' },
    'Не удалось загрузить топ': { en: 'Couldn’t load the top', zh: '排行榜加载失败' },
    'Выдели ссылку и скопируй вручную': { en: 'Select the link and copy it manually', zh: '请选中链接手动复制' },
    'Не хватает на апгрейд — пополни баланс': { en: 'Not enough for an upgrade — top up your balance', zh: '余额不足——请先充值' },
    'Кошелёк отвязан': { en: 'Wallet disconnected', zh: '钱包已断开' },
    'Не удалось сменить кошелёк': { en: 'Couldn’t change the wallet', zh: '更换钱包失败' },
    'Приём депозитов не настроен': { en: 'Deposits are not set up', zh: '充值功能尚未配置' },
    'Перевод отправлен, ждём подтверждения сети': { en: 'Transfer sent, waiting for network confirmation', zh: '转账已发送，等待网络确认' },
    'Не удалось отправить перевод': { en: 'Couldn’t send the transfer', zh: '转账发送失败' },
    'Закрой и открой приложение заново': { en: 'Close the app and open it again', zh: '请关闭并重新打开应用' },

    // ---------- общее
    'Ошибка запроса': { en: 'Request error', zh: '请求出错' },
    'Откройте приложение через бота': { en: 'Open the app through the bot', zh: '请通过机器人打开应用' },
    'Нет связи с сервером': { en: 'No connection to the server', zh: '无法连接服务器' },
  };

  /* Слова при числах. ru: 1 / 2–4 / 5+; en: 1 / много; zh: счётное слово. */
  const NOUNS = {
    prize: { ru: ['приз', 'приза', 'призов'], en: ['prize', 'prizes'], zh: ['个奖品', '奖品'] },
    game: { ru: ['игра', 'игры', 'игр'], en: ['game', 'games'], zh: ['局', '局'] },
    referral: { ru: ['реферал', 'реферала', 'рефералов'], en: ['referral', 'referrals'], zh: ['位好友', '好友'] },
  };

  function fill(text, vars) {
    if (!vars) return text;
    return text.replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k])));
  }

  function tr(key, vars) {
    const k = String(key === undefined || key === null ? '' : key);
    const row = lang === 'ru' ? null : DICT[k];
    return fill((row && row[lang]) || k, vars);
  }

  /** «5 призов» / «5 prizes» / «5 个奖品». wordOnly — только слово, без числа. */
  function tn(n, noun, wordOnly) {
    const forms = (NOUNS[noun] || {})[lang] || (NOUNS[noun] || {}).ru;
    if (!forms) return String(n);
    const num = Math.abs(Number(n)) || 0;
    let word;
    if (lang === 'ru') {
      const a = num % 100, b = num % 10;
      word = a > 10 && a < 20 ? forms[2] : b === 1 ? forms[0] : b >= 2 && b <= 4 ? forms[1] : forms[2];
    } else if (lang === 'en') {
      word = num === 1 ? forms[0] : forms[1];
    } else {
      return wordOnly ? forms[1] : `${n} ${forms[0]}`;
    }
    return wordOnly ? word : `${n} ${word}`;
  }

  const ATTRS = ['placeholder', 'aria-label', 'title', 'alt'];

  /* Чтобы менять язык на месте, надо по тексту на экране узнать его ключ
     (русский исходник): сам ключ, либо его перевод на любой из языков. */
  let REV = null;
  function keyOf(text) {
    if (DICT[text]) return text;
    if (!REV) {
      REV = {};
      for (const k of Object.keys(DICT)) {
        for (const l of LANGS) {
          const v = DICT[k][l.code];
          if (v && !(v in REV) && !DICT[v]) REV[v] = k;
        }
      }
    }
    return REV[text] || null;
  }

  /** Этот текст — сам ключ или один из его переводов? У двух ключей перевод
      может совпасть («ТРИ ШЛЯПЫ» и «Три шляпы» по-китайски одинаковы), поэтому
      запомненный ключ узла важнее поиска по тексту. */
  function matches(key, text) {
    if (key === text) return true;
    const row = DICT[key];
    return !!row && LANGS.some((l) => row[l.code] === text);
  }

  const nodeKey = new WeakMap();      // текстовый узел -> ключ
  const attrKey = new WeakMap();      // элемент -> { атрибут: ключ }

  /** Перевести готовую разметку: тексты и подсказки внутри root. Ключ узла
      запоминается, поэтому повторный вызов после смены языка переводит
      заново, в том числе обратно на русский. */
  function applyDom(root) {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const parent = node.parentNode && node.parentNode.nodeName;
      if (parent === 'SCRIPT' || parent === 'STYLE') continue;
      const raw = node.nodeValue;
      const text = raw.replace(/\s+/g, ' ').trim();
      if (!text) continue;
      // узел мог переписать код — тогда старый ключ уже не про этот текст
      let key = nodeKey.get(node);
      if (key && !matches(key, text)) key = null;
      if (!key) key = keyOf(text);
      if (!key) continue;
      nodeKey.set(node, key);
      const next = (/^\s/.test(raw) ? ' ' : '') + tr(key) + (/\s$/.test(raw) ? ' ' : '');
      if (next !== raw) node.nodeValue = next;
    }
    const sel = ATTRS.map((a) => `[${a}]`).join(',');
    for (const el of root.querySelectorAll(sel)) {
      const keys = attrKey.get(el) || {};
      for (const a of ATTRS) {
        const v = el.getAttribute(a);
        if (!v) continue;
        const t = v.replace(/\s+/g, ' ').trim();
        const key = keys[a] && matches(keys[a], t) ? keys[a] : keyOf(t);
        if (!key) continue;
        keys[a] = key;
        const next = tr(key);
        if (next !== v) el.setAttribute(a, next);
      }
      attrKey.set(el, keys);
    }
  }

  function markLang() {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : lang;
    document.documentElement.dataset.lang = lang;
  }

  const api = {
    get lang() { return lang; },
    get locale() { return (LANGS.find((l) => l.code === lang) || LANGS[0]).locale; },
    langs: LANGS,
    tr, tn, setLang, applyDom,
  };

  /** Сменить язык без перезагрузки: вкладка, прокрутка и открытые окна
      остаются как были. */
  function setLang(code) {
    if (!LANGS.some((l) => l.code === code) || code === lang) return;
    lang = code;
    try { localStorage.setItem(STORE_KEY, code); } catch (e) { /* не сохранится — язык всё равно сменим */ }
    markLang();
    applyDom(document.body);
    window.dispatchEvent(new Event('langchange'));   // app.js перерисует то, что собрано кодом
    applyDom(document.body);                         // и то, что он при этом выставил готовыми строками
  }

  markLang();
  window.I18N = api;

  // Скрипт стоит в конце <body>, разметка уже есть — переводим её сразу,
  // до app.js, чтобы русский текст не мелькал.
  if (document.body) applyDom(document.body);
  else document.addEventListener('DOMContentLoaded', () => applyDom(document.body));
})();