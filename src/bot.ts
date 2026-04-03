import { Markup, session, Telegraf, Scenes } from "telegraf";
import dotenv from "dotenv";
import { initDb, db } from "./database"; // Импортируем инициализатор и саму переменную БД
import { getAdminStats, ADMIN_IDS, getAllUserIds } from "./admin";
import { MyContext } from "./types";
import YooCheckout from "yookassa";
import { authenticate, generateAccess, getServerStats } from "./generator";
import { CronJob } from "cron";
import path from "path";
import {fileURLToPath} from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

// Настройка ЮKassa
const checkout = new YooCheckout({
    shopId: process.env.YOOKASSA_SHOP_ID!,
    secretKey: process.env.YOOKASSA_SECRET_KEY! 
});

const CHANNEL_ID = '@VPNiceberg'; // ID или юзернейм канала
const CHANNEL_URL = 'https://t.me/VPNiceberg';

// Цены и периоды
const pricing = {
    "1m": { amount: 149, days: 30, text: "1 месяц - 149 руб" },
    "3m": { amount: 359, days: 90, text: "3 месяца - 359 руб" },
    "6m": { amount: 659, days: 180, text: "6 месяцев - 659 руб" },
    "12m": { amount: 1049, days: 365, text: "12 месяцев - 1049 руб" }
};

// --- СЦЕНА РАССЫЛКИ ---
const broadcastScene = new Scenes.WizardScene<any>(
    "broadcast_scene",
    async (ctx) => {
        await ctx.reply("📢 Введите сообщение для рассылки (текст, фото или видео).\nДля отмены напишите /cancel");
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (ctx.message && 'text' in ctx.message && ctx.message.text === "/cancel") {
            await ctx.reply("❌ Рассылка отменена.");
            return ctx.scene.leave();
        }
        if (!ctx.message) return;

        const userIds = await getAllUserIds(db);
        let successCount = 0;
        let errorCount = 0;

        await ctx.reply(`🚀 Начинаю рассылку на ${userIds.length} пользователей...`);

        for (const userId of userIds) {
            try {
                await ctx.telegram.copyMessage(userId, ctx.chat.id, ctx.message.message_id);
                successCount++;
                await new Promise(res => setTimeout(res, 50)); 
            } catch (e) {
                errorCount++;
            }
        }
        await ctx.reply(`✅ Рассылка завершена!\nУспешно: ${successCount}\nОшибок: ${errorCount}`);
        return ctx.scene.leave();
    }
);

const bot = new Telegraf<MyContext>(process.env.BOT_TOKEN!);
const stage = new Scenes.Stage<any>([broadcastScene]);

bot.use(session());
bot.use(stage.middleware());

// --- ФУНКЦИИ ОПЛАТЫ ---
async function createPayment(ctx: any, period: keyof typeof pricing, type: "new" | "extend") {
    const plan = pricing[period];
    const userId = ctx.from.id;

    try {
        const payment = await checkout.createPayment({
            amount: { value: plan.amount.toFixed(2), currency: "RUB" },
            confirmation: { type: "redirect", return_url: "https://t.me/VPNiceberg_bot" },
            capture: true,
            description: `${type === "extend" ? "Продление" : "Новый"} VPN на ${plan.days} дней для пользователя @${ctx.from.username}`,
            metadata: { 
                userId: userId.toString(), 
                days: plan.days.toString(),
                type: type,
                amount: plan.amount.toString() // Сохраняем цену в метаданные платежа
            }
        });

        await ctx.reply(`💳 Оплата подписки (${type === "extend" ? "Продление" : "Новый ключ"})\nСумма: ${plan.amount}₽`,
            Markup.inlineKeyboard([
                [Markup.button.url("🔗 Перейти к оплате", payment.confirmation.confirmation_url)],
                [Markup.button.callback("🔄 Проверить оплату", `check_pay_${payment.id}`)],
                [Markup.button.callback("⬅️ Назад", "buy_rub")]
            ])
        );
    } catch (e) {
        console.error(e);
        await ctx.reply("Ошибка платежной системы.");
    }
}

async function isSubscribed(ctx: any): Promise<boolean> {
    try {
        const member = await ctx.telegram.getChatMember(CHANNEL_ID, ctx.from.id);
        // Статусы 'member', 'administrator', 'creator' означают, что юзер в канале
        const allowedStatuses = ['member', 'administrator', 'creator'];
        return allowedStatuses.includes(member.status);
    } catch (error) {
        // Если бот не админ или канал не найден
        console.error("Ошибка проверки подписки:", error);
        return false;
    }
}
bot.use(async (ctx, next) => {
    // Список команд-исключений (например, чтобы кнопка "Проверить" работала)
    const bypassActions = ['check_subscription'];
    
    // Если это callback-запрос, проверяем, нет ли его в исключениях
    if (ctx.callbackQuery && bypassActions.includes((ctx.callbackQuery as any).data)) {
        return next();
    }

    const subscribed = await isSubscribed(ctx);

    if (subscribed) {
        return next(); // Пропускаем к следующему обработчику
    } else {
        const text = `⚠️ <b>Доступ ограничен!</b>\n\nЧтобы пользоваться ботом <b>Айсберг VPN</b>, подпишитесь на наш канал. Там мы публикуем новости и статус серверов.`;
        
        const keyboard = Markup.inlineKeyboard([
            [Markup.button.url("📢 Подписаться на канал", CHANNEL_URL)],
            [Markup.button.callback("✅ Я подписался", "check_subscription")]
        ]);

        // Если это сообщение — отвечаем новым сообщением
        // Если это нажатие кнопки — редактируем текущее
        if (ctx.callbackQuery) {
            await ctx.answerCbQuery("❌ Вы еще не подписались!", { show_alert: true });
        } else {
            await ctx.replyWithHTML(text, keyboard);
        }
    }
});

bot.action("check_subscription", async (ctx) => {
    const subscribed = await isSubscribed(ctx);
    if (subscribed) {
        await ctx.answerCbQuery("✅ Спасибо за подписку!", { show_alert: false });
        await ctx.deleteMessage().catch(() => {});
        // Отправляем главное меню (вызови свою функцию старта)
        return ctx.reply("👋 Добро пожаловать! Теперь вам доступны все функции. \n Введите /start для начала.");
    } else {
        await ctx.answerCbQuery("❌ Вы всё еще не подписаны на канал.", { show_alert: true });
    }
});

// --- КОМАНДЫ ---
bot.start(async (ctx) => {
    const { id, username } = ctx.from;
    try {
        // Гарантируем создание пользователя при старте
        await db.run('INSERT OR IGNORE INTO users (id, username) VALUES (?, ?)', [id, username || 'Guest']);
        
        await ctx.replyWithPhoto({ source: "./src/photo/start.jpg" }, { 
            caption: "Добро пожаловать в Айсберг VPN! 👋\n\nНадежный доступ и высокая скорость. Выберите нужный раздел меню:",
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
                [Markup.button.callback("💎 Приобрести VPN", "buy")],
                [Markup.button.callback("👤 Мой аккаунт", "account"), Markup.button.callback("❓ Как подключить", "settings")],
                [Markup.button.callback("📞 Связаться с поддержкой", "support")]
            ])
        });
    } catch (error) {
        console.error("Ошибка в bot.start:", error);
    }
});

bot.command("adminpanel", async (ctx) => {
    const userId = ctx.from.id;
    if (!ADMIN_IDS.includes(userId)) return ctx.reply("❌ Нет доступа.");
    try {
        const stats = await getAdminStats(db);
        const serverInfo = stats.server ? `\n🖥 <b>Сервер:</b> ${stats.server.total} чел. (свободно: ${stats.server.remaining})` : "";
        const messageText = `📊 <b>Панель администратора</b>\n\n👥 Пользователей: ${stats.users}\n🔑 Активных подписок: ${stats.subs}\n💰 Общий заработок: ${stats.money.toFixed(2)}₽` + serverInfo;
        
        await ctx.replyWithHTML(messageText, Markup.inlineKeyboard([
            [Markup.button.callback("📢 Сделать рассылку", "start_broadcast")],
            [Markup.button.callback("➕ Ключ", "add_vpn_key"), Markup.button.callback("💳 Деньги", "give_test_money")],
            [Markup.button.callback("⬅️ Назад в меню", "back_to_main")]
        ]));
    } catch (e) {
        console.error(e);
    }
});

// --- CALLBACK ОБРАБОТЧИКИ ---

bot.action("back_to_main", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.deleteMessage();
    await ctx.replyWithPhoto({ source: "./src/photo/start.jpg" }, { 
        caption: "Добро пожаловать в Айсберг VPN! 👋",
        ...Markup.inlineKeyboard([
            [Markup.button.callback("💎Приобрести VPN", "buy")],
            [Markup.button.callback("👤Мой аккаунт", "account"), Markup.button.callback("❓Как подключить", "settings")],
            [Markup.button.callback("📞Связяться с поддержкой", "support")]
        ])
    });
});

bot.action("buy", async (ctx) => {
    await ctx.answerCbQuery();
    const stats = await getServerStats();
    if (stats && stats.remaining <= 0) {
        return ctx.reply("⚠️ Внимание! Сейчас свободных мест нет.\nОплата временно приостановлена. Загляните позже!");
    }
    await ctx.deleteMessage();
    await ctx.replyWithPhoto({ source: "./src/photo/start.jpg" }, { 
        caption: "Выберите способ оплаты",
        ...Markup.inlineKeyboard([
            [Markup.button.callback("💳Оплата rub", "buy_rub")],
            [Markup.button.callback("⬅️ Назад в меню", "back_to_main")]
        ])
    });
});

bot.action("buy_rub", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.deleteMessage();
    await ctx.replyWithPhoto({ source: "./src/photo/start.jpg" }, { 
        caption: "Выберите период подписки",
        ...Markup.inlineKeyboard([
            [Markup.button.callback("💳1 месяц - 149 руб", "comfrim_1m")],
            [Markup.button.callback("💳3 месяца - 359 руб", "comfrim_3m")],
            [Markup.button.callback("💳6 месяцев - 659 руб", "comfrim_6m")],
            [Markup.button.callback("💳12 месяцев - 1049 руб", "comfrim_12m")],
            [Markup.button.callback("⬅️ Назад в меню", "back_to_main")]
        ])
    });
});

// Обработчики подтверждения выбора (comfrim)
const confirmPeriods = ["1m", "3m", "6m", "12m"] as const;
confirmPeriods.forEach(p => {
    bot.action(`comfrim_${p}`, async (ctx) => {
        await ctx.answerCbQuery(); 
        await ctx.deleteMessage();
        await ctx.replyWithPhoto({ source: "./src/photo/start.jpg" }, { 
            caption: `Вы выбрали подписку на ${pricing[p].text}. Подтвердите выбор и перейдите к оплате.`,
            ...Markup.inlineKeyboard([
                [Markup.button.callback("✅Подтвердить выбор", `confirm_payment_${p}`)], 
                [Markup.button.callback("⬅️ Назад", "buy_rub")]
            ])
        });
    });
});

// Обработчики логики (проверка наличия активной подписки)
confirmPeriods.forEach(p => {
    bot.action(`confirm_payment_${p}`, async (ctx) => {
        await ctx.answerCbQuery();
        const userId = ctx.from!.id;
        const activeSub = await db.get('SELECT id FROM subscriptions WHERE user_id = ? AND status = "active" LIMIT 1', [userId]);

        if (activeSub) {
            await ctx.deleteMessage();
            await ctx.replyWithPhoto({ source: "./src/photo/start.jpg" }, { 
                caption: "У вас уже есть активная подписка. Вы хотите продлить текущий ключ или создать новый?",
                ...Markup.inlineKeyboard([
                    [Markup.button.callback("➕ Продлить текущую", `pay_type_extend_${p}`)],
                    [Markup.button.callback("🔑 Создать новый ключ", `pay_type_new_${p}`)],
                    [Markup.button.callback("⬅️ Назад", "buy_rub")]
                ])
            });
        } else {
            await ctx.deleteMessage();
            await createPayment(ctx, p, "new");
        }
    });
});

bot.action(/^pay_type_(new|extend)_(.*)$/, async (ctx) => {
    const type = ctx.match[1] as "new" | "extend";
    const period = ctx.match[2] as keyof typeof pricing;
    await ctx.answerCbQuery();
    await ctx.deleteMessage();
    await createPayment(ctx, period, type);
});

// --- ПРОВЕРКА ПЛАТЕЖА (Главная логика) ---

// Хранилище для защиты от спама и повторных запросов
const lastCheckTime: Record<number, number> = {}; 
const processingPayments = new Set<string>(); // Блокировка на время выполнения запроса
const CHECK_INTERVAL = 3 * 60 * 1000; // 3 минуты
bot.action(/^check_pay_(.*)$/, async (ctx) => {
    const paymentId = ctx.match[1];
    const userId = ctx.from!.id;
    const now = Date.now();

    // 1. Проверка на частоту нажатий (раз в 3 минуты)
    if (lastCheckTime[userId] && (now - lastCheckTime[userId] < CHECK_INTERVAL)) {
        const secondsLeft = Math.ceil((CHECK_INTERVAL - (now - lastCheckTime[userId])) / 1000);
        return ctx.answerCbQuery(`⏳ Повторная проверка доступна через ${secondsLeft} сек.`, { show_alert: true });
    }

    // 2. Блокировка повторного входа, пока идет текущий запрос (защита от клик-спама)
    if (processingPayments.has(paymentId)) {
        return ctx.answerCbQuery("⚠️ Запрос уже обрабатывается, подождите...", { show_alert: true });
    }

    try {
        processingPayments.add(paymentId);
        
        // Получаем данные платежа от платежки
        const payment = await checkout.getPayment(paymentId);

        if (payment.status === 'succeeded') {
            const daysToAdd = parseInt(payment.metadata.days || "30");
            const type = payment.metadata.type; // 'new' или 'extend'
            const amountPaid = parseFloat(payment.amount.value || "0");

            // КРИТИЧЕСКАЯ ПРОВЕРКА: не выдавали ли мы уже ключ по этому ID платежа?
            const alreadyProcessed = await db.get('SELECT id FROM subscriptions WHERE uuid = ?', [paymentId]);
            if (alreadyProcessed) {
                processingPayments.delete(paymentId);
                return ctx.editMessageCaption("✅ Доступ за эту оплату уже был предоставлен ранее.", 
                    Markup.inlineKeyboard([[Markup.button.callback("⬅️ В меню", "back_to_main")]]));
            }

            // Обновляем время последней проверки ТОЛЬКО если статус 'succeeded'
            lastCheckTime[userId] = now;

            if (type === "extend") {
                // ЛОГИКА ПРОДЛЕНИЯ
                const sub = await db.get('SELECT * FROM subscriptions WHERE user_id = ? AND status = "active" ORDER BY expires_at DESC LIMIT 1', [userId]);
                
                if (sub) {
                    const currentExp = Math.max(Date.now(), new Date(sub.expires_at).getTime());
                    const newExp = new Date(currentExp + (daysToAdd * 24 * 60 * 60 * 1000));
                    
                    await db.run('UPDATE subscriptions SET expires_at = ?, price = price + ?, uuid = ? WHERE id = ?', 
                        [newExp.toISOString(), amountPaid, paymentId, sub.id]);
                    
                    await ctx.deleteMessage().catch(() => {});
                    await ctx.reply(`✅ Подписка успешно продлена на ${daysToAdd} дней!`);
                } else {
                    // Если подписки нет, но нажато "продлить" — создаем новую
                    const vpnData = await generateAccess(userId, ctx.from?.username, daysToAdd);
                    if (vpnData.success && vpnData.subUrl) {
                        await db.run(`
                            INSERT INTO subscriptions (user_id, uuid, client_email, sub_url, price, expires_at) 
                            VALUES (?, ?, ?, ?, ?, ?)`,
                            [userId, paymentId, vpnData.email, vpnData.subUrl, amountPaid, vpnData.expiresAt?.toISOString()]
                        );
                        await ctx.deleteMessage().catch(() => {});
                        await ctx.replyWithHTML(`🎉 <b>Оплата прошла!</b>\n\nВаш ключ:\n<code>${vpnData.subUrl}</code>`);
                    }
                }
            } else {
                // ЛОГИКА НОВОЙ ПОДПИСКИ
                const vpnData = await generateAccess(userId, ctx.from?.username, daysToAdd);
                
                if (vpnData.success && vpnData.subUrl) {
                    await db.run(`
                        INSERT INTO subscriptions (user_id, uuid, client_email, sub_url, price, expires_at) 
                        VALUES (?, ?, ?, ?, ?, ?)`,
                        [userId, paymentId, vpnData.email, vpnData.subUrl, amountPaid, vpnData.expiresAt?.toISOString()]
                    );
                    
                    await ctx.deleteMessage().catch(() => {});
                    await ctx.replyWithHTML(`🎉 <b>Оплата прошла!</b>\n\nВаш новый ключ:\n<code>${vpnData.subUrl}</code>`);
                } else {
                    throw new Error("Ошибка генерации ключа в панели");
                }
            }
        } else {
            // Если статус не Succeeded
            await ctx.answerCbQuery("⏳ Оплата еще не поступила (статус: ожидание).", { show_alert: true });
            // Для неуспешной оплаты НЕ ставим глобальный лимит в 3 минуты, 
            // чтобы юзер мог проверить еще раз через минуту, если банк долго "думает".
        }

    } catch (e) {
        console.error("❌ Ошибка при проверке оплаты:", e);
        await ctx.reply("🆘 Произошла ошибка. Пожалуйста, обратитесь в поддержку @dissolw7s");
    } finally {
        // Всегда снимаем временную блокировку процесса
        processingPayments.delete(paymentId);
    }
});
bot.action("account", async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from!.id;
    try {
        const user = await db.get('SELECT * FROM users WHERE id = ?', userId);
        if (!user) return ctx.reply("Пожалуйста, начните с /start.");
        const activeSubs = await db.get('SELECT COUNT(*) as count FROM subscriptions WHERE user_id = ? AND expires_at > CURRENT_TIMESTAMP', [userId]);
        await ctx.deleteMessage();
        const profileInfo = `👤Мой профиль\n\n👥 Пользователь: @${ctx.from.username}\n💰 Баланс: ${user.balance.toFixed(2)}₽\n🔑 Активных ключей: ${activeSubs.count}`;
        await ctx.replyWithPhoto({ source: "./src/photo/start.jpg" }, { 
            caption: profileInfo, 
            ...Markup.inlineKeyboard([[Markup.button.callback("🔑 Мои ключи", "my_keys")],
                                    [Markup.button.callback("⬅️ Назад в меню", "back_to_main")]])
        });
    } catch (error) {
        console.error(error);
    }
});
bot.action("my_keys", async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from!.id;

    // Укажи правильный путь к твоему фото
    const photoPath = path.join(__dirname, 'photo', 'keys.jpg');

    try {
        const subs = await db.all(
            `SELECT sub_url, expires_at, client_email 
             FROM subscriptions 
             WHERE user_id = ? AND expires_at > CURRENT_TIMESTAMP AND status = 'active'`, 
            [userId]
        );

        let message = "";
        if (!subs || subs.length === 0) {
            message = "⚠️ У вас пока нет активных ключей.";
        } else {
            message = "<b>🗝 Ваши активные ключи:</b>\n\n";
            subs.forEach((sub, index) => {
                const date = new Date(sub.expires_at).toLocaleDateString('ru-RU');
                message += `${index + 1}. 📅 До: <b>${date}</b>\n`;
                message += `<code>${sub.sub_url}</code>\n\n`;
            });
            message += "<i>Нажмите на ключ, чтобы скопировать его.</i>";
        }

        // 1. Пытаемся отредактировать текущее сообщение (если там уже было фото)
        try {
            await ctx.editMessageMedia({
                type: 'photo',
                media: { source: photoPath },
                caption: message,
                parse_mode: 'HTML'
            }, Markup.inlineKeyboard([[Markup.button.callback("⬅️ Назад", "account")]]));
        } catch (e) {
            // 2. Если редактирование не вышло (например, старое сообщение было без фото),
            // удаляем старое и отправляем новое с картинкой
            await ctx.deleteMessage().catch(() => {});
            await ctx.replyWithPhoto({ source: photoPath }, {
                caption: message,
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([[Markup.button.callback("⬅️ Назад", "account")]])
            });
        }

    } catch (error) {
        console.error("Ошибка при получении ключей:", error);
        await ctx.reply("❌ Произошла ошибка при загрузке ключей.");
    }
});
bot.action("settings", async (ctx) => {
    await ctx.answerCbQuery(); 
    await ctx.deleteMessage();
    await ctx.replyWithPhoto({ source: "./src/photo/start.jpg" }, { 
        caption: "Инструкции по подключению VPN: \nhttps://graph.org/Kak-podklyuchit-podpisku-Ajsberg-VPN-03-31", 
        ...Markup.inlineKeyboard([[Markup.button.callback("⬅️ Назад в меню", "back_to_main")]])
    });
});

bot.action("support", async (ctx) => {
    await ctx.answerCbQuery(); 
    await ctx.deleteMessage();
    await ctx.replyWithPhoto({ source: "./src/photo/start.jpg" }, { 
        caption: "https://t.me/dissolw7\n\nСвяжитесь с поддержкой!", 
        ...Markup.inlineKeyboard([[Markup.button.callback("⬅️ Назад в меню", "back_to_main")]])
    });
});

bot.action("start_broadcast", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.scene.enter("broadcast_scene");
});

// --- ПЛАНИРОВЩИК ---
export function startNotificationScheduler(bot: any, database: any) {
    const job = new CronJob('0 0 12 * * *', async () => {
        console.log("Запуск проверки истекающих подписок...");
        try {
            const expiringSoon = await database.all(`
                SELECT user_id, expires_at 
                FROM subscriptions 
                WHERE date(expires_at) = date('now', '+3 days')
                AND status = 'active'
            `);

            for (const sub of expiringSoon) {
                try {
                    await bot.telegram.sendMessage(
                        sub.user_id, 
                        `⚠️ <b>Внимание!</b>\n\nВаша подписка на VPN истекает через <b>3 дня</b>.\nЧтобы не потерять доступ, пожалуйста, продлите её в меню.`,
                        { parse_mode: 'HTML' }
                    );
                } catch (err) {
                    console.error(`Ошибка отправки уведомления ${sub.user_id}`);
                }
            }
        } catch (error) {
            console.error("Ошибка в планировщике:", error);
        }
    });
    job.start();
}

// --- ЗАПУСК БОТА ---
async function startBot() {
    // Используем единый метод инициализации из database.ts
    await initDb(); 
    
    startNotificationScheduler(bot, db);
    
    bot.launch();
    console.log("🤖 Бот Айсберг VPN запущен.");
}

startBot().catch((error) => {
    console.error("Ошибка при запуске бота:", error);
});