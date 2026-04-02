import axios, { AxiosError } from 'axios';
import crypto from 'crypto';

const PANEL_CONFIG = {
    baseUrl: 'https://141.11.197.193:54321/pg47HOtLpbZ52Jbq6K',
    login: 'admin',
    password: 'icebergpass1'
};

let cookie: string = '';

/**
 * Авторизация в панели
 */
export async function authenticate(): Promise<void> {
    try {
        const loginData = {
            username: PANEL_CONFIG.login,
            password: PANEL_CONFIG.password
        };

        const response = await axios.post(`${PANEL_CONFIG.baseUrl}/login`, loginData, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 5000
        });

        const setCookie = response.headers['set-cookie'];
        if (setCookie) {
            cookie = setCookie.join('; ');
            console.log("✅ Успешно вошли в панель 3X-UI");
        } else {
            console.error("❌ Ошибка: Сессия не получена");
        }
    } catch (e: any) {
        console.error("❌ Ошибка входа в панель:", e.response?.data || e.message);
    }
}

/**
 * Генерация доступа для VLESS + TLS
 */
export async function generateAccess(tgUserId: number | string, username: string | undefined, days: number = 30) {
    if (!cookie) await authenticate();

    try {
        const listResponse = await axios.get(`${PANEL_CONFIG.baseUrl}/panel/api/inbounds/list`, {
            headers: { 'Cookie': cookie }
        });

        const inbounds = listResponse.data.obj;
        if (!inbounds || !Array.isArray(inbounds)) {
            throw new Error("Не удалось получить список подключений");
        }

        const MAX_PER_INBOUND = 100; // Увеличил лимит, раз ты работаешь с TLS

        // 1. Ищем свободный VLESS + TLS Inbound
        const targetInbound = inbounds.find((i: any) => {
            if (!i.enable || i.protocol !== 'vless') return false;
            try {
                const streamSettings = JSON.parse(i.streamSettings);
                // Проверяем, что используется именно TLS
                if (streamSettings.security !== 'tls') return false;
                
                const settings = JSON.parse(i.settings);
                const clientsCount = settings.clients ? settings.clients.length : 0;
                return clientsCount < MAX_PER_INBOUND;
            } catch { return false; }
        });

        if (!targetInbound) {
            console.error("❌ Свободные TLS-инбаунды не найдены");
            return { success: false, expiresAt: undefined };
        }

        // 2. Подготовка данных клиента
        const uuid = crypto.randomUUID();
        const subId = crypto.randomBytes(8).toString('hex');
        const email = `${username || 'user'}_${tgUserId}_${Math.floor(Math.random() * 1000)}`;
        const expiryTimestamp = Date.now() + (days * 24 * 60 * 60 * 1000);
        const expiresAtDate = new Date(expiryTimestamp);

        const clientData = {
            id: targetInbound.id,
            settings: JSON.stringify({
                clients: [{
                    id: uuid, 
                    email: email, 
                    limitIp: 2, 
                    totalGB: 0,
                    expiryTime: expiryTimestamp, 
                    enable: true, 
                    tgId: String(tgUserId), 
                    subId: subId
                }]
            })
        };

        // 3. Добавление клиента
        const addResponse = await axios.post(`${PANEL_CONFIG.baseUrl}/panel/api/inbounds/addClient`, clientData, {
            headers: { 'Cookie': cookie, 'Content-Type': 'application/json' }
        });

        if (!addResponse.data.success) {
            throw new Error(`Ошибка панели: ${addResponse.data.msg}`);
        }

        // --- ФОРМИРОВАНИЕ ПРЯМОЙ ССЫЛКИ VLESS + TLS ---
        
        const streamSettings = JSON.parse(targetInbound.streamSettings);
        const tlsSettings = streamSettings.tlsSettings || {};
        
        const host = "141.11.197.193"; // Твой IP
        const port = targetInbound.port;
        
        // SNI берем из настроек TLS в панели, либо используем IP
        const sni = tlsSettings.serverName || host;
        // ALPN для TLS (обычно h2 и http/1.1)
        const alpn = (tlsSettings.alpn && tlsSettings.alpn.join(',')) || "h2,http/1.1";
        const net = streamSettings.network || 'tcp';

        // Сборка ссылки без Reality-параметров
        const vlessLink = `vless://${uuid}@${host}:${port}?security=tls&sni=${sni}&alpn=${alpn}&type=${net}&encryption=none#IcebergVPN:${username || tgUserId}`;

        console.log(`✅ Ключ TLS создан для ${email}`);

        return {
            success: true,
            subUrl: vlessLink,
            uuid: uuid,
            email: email,
            expiresAt: expiresAtDate
        };

    } catch (e: any) {
        if (e instanceof AxiosError && e.response?.status === 401) {
            cookie = '';
            return generateAccess(tgUserId, username, days);
        }
        console.error("❌ Ошибка generateAccess:", e.message);
        return { success: false, expiresAt: undefined };
    }
}

/**
 * Получение статистики загруженности
 */
export async function getServerStats() {
    try {
        if (!cookie) await authenticate();

        const response = await axios.get(`${PANEL_CONFIG.baseUrl}/panel/api/inbounds/list`, {
            headers: { 'Cookie': cookie }
        });

        if (response.data && response.data.obj) {
            const inbounds = response.data.obj;
            let totalClients = 0;
            let totalRemaining = 0;
            const MAX_PER_INBOUND = 25; 

            for (const inbound of inbounds) {
                if (!inbound.enable || !inbound.settings) continue;
                try {
                    const settings = JSON.parse(inbound.settings);
                    const clientsCount = settings.clients ? settings.clients.length : 0;
                    totalClients += clientsCount;
                    const remaining = MAX_PER_INBOUND - clientsCount;
                    if (remaining > 0) totalRemaining += remaining;
                } catch (e) {}
            }

            return {
                total: totalClients,
                remaining: totalRemaining,
                inboundCount: inbounds.length
            };
        }
    } catch (e) {
        console.error("❌ Ошибка статистики:", e);
        return null;
    }
}