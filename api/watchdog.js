// api/watchdog.js
// Vercel Cron Job — corre cada 10 minutos
// Detecta dispositivos sin señal y manda alerta por Telegram + email
// Cuando el dispositivo vuelve, ttn-webhook.js manda la notificación de recuperación
import { sql, cors } from '../lib/db.js';

const DEVICES      = ['7en1', 'sound', 'presence'];
const GAP_MINUTES  = parseInt(process.env.WATCHDOG_GAP_MIN || '10');
const CRON_SECRET  = process.env.CRON_SECRET || '';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Seguridad: solo Vercel Cron puede llamar este endpoint
  // Vercel manda Authorization: Bearer <CRON_SECRET> automáticamente
  const authHeader = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
  if (CRON_SECRET && authHeader !== CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db      = sql();
  const now     = new Date();
  const gapMs   = GAP_MINUTES * 60 * 1000;
  const results = [];

  for (const deviceId of DEVICES) {
    // Último uplink de este dispositivo
    const rows = await db`
      SELECT received_at FROM sensor_readings
      WHERE device_id = ${deviceId}
      ORDER BY received_at DESC
      LIMIT 1
    `;

    if (rows.length === 0) {
      results.push({ deviceId, status: 'no_data' });
      continue;
    }

    const lastSeen   = new Date(rows[0].received_at);
    const silentMs   = now - lastSeen;
    const silentMin  = Math.floor(silentMs / 60000);
    const isOffline  = silentMs > gapMs;

    results.push({ deviceId, silentMin, isOffline, lastSeen: lastSeen.toISOString() });

    if (!isOffline) continue;

    // ── Verificar cooldown para no spamear alertas de offline ──
    // Reutilizamos alert_cooldowns con field = 'offline'
    const cdRows = await db`
      SELECT last_sent FROM alert_cooldowns
      WHERE device_id = ${deviceId} AND field = 'offline'
    `;

    const offlineCooldownMs = parseInt(process.env.WATCHDOG_COOLDOWN_MIN || '30') * 60 * 1000;

    if (cdRows.length > 0) {
      const elapsed = now - new Date(cdRows[0].last_sent);
      if (elapsed < offlineCooldownMs) {
        console.log(`Watchdog: ${deviceId} offline but still in cooldown (${Math.floor(elapsed/60000)} min elapsed)`);
        continue;
      }
    }

    // Upsert cooldown
    await db`
      INSERT INTO alert_cooldowns (device_id, field, last_sent)
      VALUES (${deviceId}, 'offline', ${now.toISOString()})
      ON CONFLICT (device_id, field)
      DO UPDATE SET last_sent = ${now.toISOString()}
    `;

    // Mandar alerta
    const alertMsg = [
      `📡 *Sin señal — ${deviceId}*`,
      ``,
      `Último uplink: ${lastSeen.toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })}`,
      `Tiempo sin señal: ${silentMin} minutos`,
      ``,
      `_Verifica el gateway y la alimentación del sensor._`,
    ].join('\n');

    const baseUrl        = process.env.BASE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
    const internalSecret = process.env.INTERNAL_SECRET || process.env.TTN_WEBHOOK_SECRET || '';

    const alertRes = await fetch(`${baseUrl}/api/send-alert`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${internalSecret}`,
      },
      body: JSON.stringify({
        to:      process.env.ALERT_EMAIL || '',
        channel: 'all',
        subject: `📡 Sin señal: ${deviceId}`,
        body:    alertMsg,
      }),
    });

    if (alertRes.ok) {
      console.log(`Watchdog alert sent for ${deviceId} (${silentMin} min offline)`);
    } else {
      console.error(`Watchdog alert failed for ${deviceId}:`, await alertRes.text());
    }
  }

  return res.status(200).json({
    ok: true,
    checked_at: now.toISOString(),
    gap_threshold_min: GAP_MINUTES,
    results,
  });
}