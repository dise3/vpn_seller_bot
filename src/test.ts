import axios, { AxiosError } from 'axios';
import crypto from 'crypto';

const PANEL_CONFIG = {
    baseUrl: 'https://icebergvpn.ru:54321/pg47HOtLpbZ52Jbq6K',
    inboundId: 1,
    login: 'admin',
    password: 'icebergpass1'
};

let cookie: string = '';

async function authenticate(): Promise<void> {
    try {
        // Попробуем отправить данные как обычный JSON, 
        // так как многие современные форки 3X-UI перешли на него
        const loginData = {
            username: PANEL_CONFIG.login,
            password: PANEL_CONFIG.password
        };

        console.log(`Попытка входа по адресу: ${PANEL_CONFIG.baseUrl}/login`);

        const response = await axios.post(`${PANEL_CONFIG.baseUrl}/login`, loginData, {
            headers: {
                'Content-Type': 'application/json'
            }
        });

        // Выводим заголовки для отладки, если куки снова не будет
        console.log("Заголовки ответа:", response.headers);

        const setCookie = response.headers['set-cookie'];
        if (setCookie) {
            cookie = setCookie.join('; ');
            console.log("✅ Успешно вошли в панель");
        } else {
            console.error("❌ Сервер ответил 200 OK, но НЕ прислал Set-Cookie.");
            console.log("Тело ответа:", response.data);
        }
    } catch (e: any) {
        if (e.response) {
            console.error(`❌ Ошибка API (${e.response.status}):`, e.response.data);
            
            // Если получили 405 (Method Not Allowed), попробуем вернуться к URLSearchParams
            if (e.response.status === 405) {
                console.log("Пробую альтернативный метод (x-www-form-urlencoded)...");
                // Тут можно вызвать версию с URLSearchParams
            }
        } else {
            console.error("❌ Ошибка соединения:", e.message);
        }
    }
}

async function generateAccess(tgUserId: number | string, username: string | undefined) {
    const uuid = crypto.randomUUID();
    const subId = crypto.randomBytes(8).toString('hex');
    const email = `${username || 'user'}_${tgUserId}`;

    const clientSettings = {
        id: PANEL_CONFIG.inboundId,
        settings: JSON.stringify({
            clients: [{
                id: uuid,
                email: email,
                limitIp: 2,
                totalGB: 0,
                expiryTime: Date.now() + (30 * 24 * 60 * 60 * 1000),
                enable: true,
                tgId: String(tgUserId),
                subId: subId
            }]
        })
    };

    try {
        await axios.post(`${PANEL_CONFIG.baseUrl}/panel/api/inbounds/addClient`, clientSettings, {
            headers: { 'Cookie': cookie }
        });

        const subUrl = `${PANEL_CONFIG.baseUrl}/sub/${subId}`;
        
        return {
            success: true,
            subUrl: subUrl,
            uuid: uuid,
            email: email,
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        };
    } catch (e: unknown) {
        // Правильная обработка unknown ошибки в TS
        if (e instanceof AxiosError) {
            console.error("❌ Ошибка API:", e.response?.data || e.message);
        } else {
            console.error("❌ Неизвестная ошибка:", e);
        }
        return { success: false };
    }
}

async function runTest() {
    console.log("🚀 Начинаем тест...");

    // 1. Пытаемся залогиниться
    await authenticate();

    if (cookie) {
        // 2. Если логин успешен, создаем тестового клиента
        // Используем фейковые данные (ID 12345, имя TestUser)
        const result = await generateAccess(12345, 'TestUser');

        if (result.success) {
            console.log("⭐ ТЕСТ ПРОЙДЕН УСПЕШНО!");
            console.log("🔗 Ссылка для клиента:", result.subUrl);
            console.log("🆔 UUID:", result.uuid);
            console.log("📅 Истекает:", result.expiresAt);
        } else {
            console.log("❌ Тест провален на этапе создания клиента.");
        }
    } else {
        console.log("❌ Тест остановлен: нет авторизации.");
    }
}

runTest();