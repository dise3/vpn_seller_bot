import { Context, Scenes } from 'telegraf';
import { Database } from 'sqlite';

// Данные, которые хранятся в сессии конкретной сцены
export interface MyWizardSession extends Scenes.WizardSessionData {
    db?: Database; // Сюда прокинем базу
    keyContent?: string; // Здесь можно временно хранить текст ключа
}

// Расширенный контекст бота
export interface MyContext extends Context {
    // Указываем наш кастомный тип сессии для сцен
    scene: Scenes.SceneContextScene<MyContext, MyWizardSession>;
    wizard: Scenes.WizardContextWizard<MyContext>;
}