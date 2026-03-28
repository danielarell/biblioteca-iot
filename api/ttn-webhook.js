// api/ttn-webhook.js  — called by TTN on every uplink
import { sql, cors } from '../lib/db.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Verify shared secret set in TTN webhook header
  const secret = process.env.TTN_WEBHOOK_SECRET || '';
  const auth   = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
  if (secret && auth !== secret)
    return res.status(401).json({ error: 'Unauthorized' });

  try {
    const body   = req.body || {};
    const result = body.result ?? body;

    const deviceId   = result?.end_device_ids?.device_id;
    const receivedAt = result?.received_at;
    const payload    = result?.uplink_message?.decoded_payload ?? {};

    if (!deviceId || !receivedAt)
      return res.status(400).json({ error: 'Missing device_id or received_at' });

    // Map fields per device
    let temperature  = null, humidity = null, co2 = null;
    let pressure     = null, light_level = null, tvoc = null;
    let pir          = null, battery = null;

    if (deviceId === '7en1') {
      temperature  = payload.temperature  ?? null;
      humidity     = payload.humidity     ?? null;
      co2          = payload.co2          ?? null;
      pressure     = payload.pressure     ?? null;
      light_level  = payload.light_level  ?? null;
      tvoc         = payload.tvoc         ?? null;
      pir          = payload.pir          ?? null;
      battery      = payload.battery      ?? null;
    } else if (deviceId === 'sound' || deviceId === 'presence') {
      battery = payload.battery ?? null;
    }

    const db = sql();
    await db`
      INSERT INTO sensor_readings
        (device_id, received_at, temperature, humidity, co2,
         pressure, light_level, tvoc, pir, battery)
      VALUES
        (${deviceId}, ${receivedAt}, ${temperature}, ${humidity}, ${co2},
         ${pressure}, ${light_level}, ${tvoc}, ${pir}, ${battery})
    `;

    // ─────────────────────────────────────────────
    // ✅ ALERTA AUTOMÁTICA (Telegram)
    // ─────────────────────────────────────────────
    const alerts = [];

    if (temperature !== null && temperature > 30) {
      alerts.push(`🔥 Temperatura alta (${temperature}°C)`);
    }

    if (co2 !== null && co2 > 1000) {
      alerts.push(`🫁 CO₂ elevado (${co2} ppm)`);
    }

    if (pir !== null && pir === 1) {
      alerts.push(`🚶 Movimiento detectado`);
    }

    if (battery !== null && battery < 20) {
      alerts.push(`🔋 Batería baja (${battery}%)`);
    }

    if (alerts.length > 0) {
      const msg = `Dispositivo: ${deviceId}\n${alerts.join("\n")}`;

      // ✅ CORRECCIÓN IMPORTANTE: agregar https:// al dominio de Vercel
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'http://localhost:3000';

      await fetch(`${baseUrl}/api/send-alert`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.TTN_WEBHOOK_SECRET}`
        },
        body: JSON.stringify({
          to: "telegram",
          channel: "sms",
          body: msg
        })
      });
    }
    // ─────────────────────────────────────────────

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).json({ error: String(err) });
  }
}