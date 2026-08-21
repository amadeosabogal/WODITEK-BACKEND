import express from 'express';
import webpush from 'web-push';
import { getConnection } from '../sqlconfig.js';

const router = express.Router();

// Configurar VAPID
webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
);

// Función para enviar notificaciones a todas las suscripciones
export const sendNotificationToAll = async (payload) => {
    try {
        const pool = await getConnection();
        // Obtener todas las suscripciones
        const result = await pool.request().query('SELECT * FROM PushSubscriptions');
        const subscriptions = result.recordset;

        const notifications = subscriptions.map(sub => {
            const pushSubscription = {
                endpoint: sub.endpoint,
                keys: {
                    p256dh: sub.p256dh,
                    auth: sub.auth
                }
            };

            return webpush.sendNotification(pushSubscription, JSON.stringify(payload))
                .catch(async err => {
                    if (err.statusCode === 410 || err.statusCode === 404) {
                        // Suscripción inválida, borrar de la BD
                        console.log(`Subscription expired/invalid: ${sub.endpoint}, removing...`);
                        await pool.request()
                            .input('endpoint', sub.endpoint)
                            .query(`DELETE FROM PushSubscriptions WHERE endpoint = @endpoint`);
                    } else {
                        console.error('Error sending notification:', err);
                    }
                });
        });

        await Promise.all(notifications);
        console.log(`Notifications sent to ${subscriptions.length} subscribers.`);
    } catch (error) {
        console.error('Error in sendNotificationToAll:', error);
    }
};

// Endpoint para guardar la suscripción
router.post('/suscribirse', async (req, res) => {
    const subscription = req.body;
    const { endpoint, keys } = subscription;

    if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
        return res.status(400).json({ error: 'Invalid subscription object' });
    }

    try {
        const pool = await getConnection();

        // Crear tabla si no existe (Simple check, naive approach)
        // En producción esto debería ser una migración
        await pool.request().query(`
            IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='PushSubscriptions' and xtype='U')
            CREATE TABLE PushSubscriptions (
                id INT IDENTITY(1,1) PRIMARY KEY,
                endpoint VARCHAR(MAX) NOT NULL,
                p256dh VARCHAR(MAX) NOT NULL,
                auth VARCHAR(MAX) NOT NULL,
                created_at DATETIME DEFAULT GETDATE()
            )
        `);

        // Insertar suscripción si no existe (usando endpoint como clave única lógica)
        // Usamos parámetros para evitar SQL Injection básico, aunque el driver mssql lo maneja bien con .input()
        // Pero aquí lo haré con query parametrizada si es posible, o string template con cuidado.
        // Mssql driver soporta: request.input('name', type, value)

        const request = pool.request();
        request.input('endpoint', endpoint);
        request.input('p256dh', keys.p256dh);
        request.input('auth', keys.auth);

        // Verificar si ya existe
        const check = await request.query(`SELECT COUNT(*) as count FROM PushSubscriptions WHERE endpoint = @endpoint`);

        if (check.recordset[0].count === 0) {
            const insertRequest = pool.request(); // New request object for new query
            insertRequest.input('endpoint', endpoint);
            insertRequest.input('p256dh', keys.p256dh);
            insertRequest.input('auth', keys.auth);
            await insertRequest.query(`
                INSERT INTO PushSubscriptions (endpoint, p256dh, auth)
                VALUES (@endpoint, @p256dh, @auth)
            `);
            res.status(201).json({ message: 'Subscription saved' });
        } else {
            res.status(200).json({ message: 'Subscription updated/already exists' });
        }

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error saving subscription' });
    }
});

// Endpoint para simular envío (opcional, para testear)
router.post('/send-test', async (req, res) => {
    const payload = {
        title: "Test Notification",
        body: "This is a test notification from backend",
        url: "/"
    };
    await sendNotificationToAll(payload);
    res.json({ message: 'Notifications sent' });
});

export default router;
