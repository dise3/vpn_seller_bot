import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';

export let db: Database;

/**
 * Инициализация базы данных
 * Создает файл database.db с корректной структурой с нуля
 */
export async function initDb() {
    db = await open({
        filename: './database.db',
        driver: sqlite3.Database
    });

    // Включаем поддержку внешних ключей
    await db.run('PRAGMA foreign_keys = ON');

    await db.exec(`
        -- 1. Пользователи
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY,           -- Telegram ID
            username TEXT,
            balance REAL DEFAULT 0.0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        -- 2. Подписки (сразу с колонкой price для статистики)
        CREATE TABLE IF NOT EXISTS subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            uuid TEXT UNIQUE,                -- UUID для панели
            sub_id TEXT,                     -- subId для ссылок
            client_email TEXT,               -- email (user_12345)
            inbound_id INTEGER DEFAULT 1,
            sub_url TEXT,                    -- Готовая vless:// ссылка
            price REAL DEFAULT 0.0,          -- СТОИМОСТЬ ПОКУПКИ
            expires_at DATETIME,
            status TEXT DEFAULT 'active',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        -- 3. Тарифы
        CREATE TABLE IF NOT EXISTS plans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,                       -- Например: '1 Месяц'
            days INTEGER,                    -- Например: 30
            price REAL                       -- Стоимость в рублях
        );
    `);

    console.log("🗄️ База данных Айсберг VPN создана с чистого листа.");
    return db;
}

/**
 * Функция получения активной подписки пользователя
 */
export async function getUserSubscription(userId: number) {
    return await db.get(`
        SELECT sub_url, expires_at, status 
        FROM subscriptions 
        WHERE user_id = ? 
          AND status = 'active' 
          AND expires_at > CURRENT_TIMESTAMP
        ORDER BY expires_at DESC LIMIT 1
    `, [userId]);
}

/**
 * Функция для записи новой продажи в базу
 */
export async function createSubscription(data: {
    userId: number,
    uuid: string,
    subId: string,
    email: string,
    url: string,
    price: number,
    expiresAt: string
}) {
    return await db.run(`
        INSERT INTO subscriptions 
        (user_id, uuid, sub_id, client_email, sub_url, price, expires_at) 
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
        data.userId, 
        data.uuid, 
        data.subId, 
        data.email, 
        data.url, 
        data.price, 
        data.expiresAt
    ]);
}