import { Database } from 'sqlite';
import { getServerStats } from './generator';
import dotenv from 'dotenv';

dotenv.config();

export const ADMIN_IDS: number[] = process.env.ADMIN_IDS 
    ? process.env.ADMIN_IDS.split(',').map(id => parseInt(id.trim())) 
    : [];

export async function getAllUserIds(db: Database): Promise<number[]> {
    const users = await db.all('SELECT id FROM users');
    return users.map(user => user.id);
}

export async function getAdminStats(db: Database) {
    const usersCount = await db.get('SELECT COUNT(*) as count FROM users');
    const activeSubs = await db.get('SELECT COUNT(*) as count FROM subscriptions WHERE expires_at > CURRENT_TIMESTAMP');
    
    // Считаем сумму всех когда-либо купленных подписок
    const totalEarnings = await db.get('SELECT SUM(price) as sum FROM subscriptions');
    
    // Опционально: заработок только за сегодня
    const dailyEarnings = await db.get("SELECT SUM(price) as sum FROM subscriptions WHERE date(created_at) = date('now')");

    const vpnStats = await getServerStats();
    
    return {
        users: usersCount?.count || 0,
        subs: activeSubs?.count || 0,
        money: totalEarnings?.sum || 0, // Это будет реальный доход
        daily: dailyEarnings?.sum || 0,
        server: vpnStats ? {
            total: vpnStats.total,
            remaining: vpnStats.remaining
        } : null
    };
}