// api/ttn-webhook.js
import { sql, cors } from '../lib/db.js';

// Cooldown en minutos — alertar cada X minutos mientras siga fuera de rango
const COOLDOWN_MINUTES = 5;

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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

    // ── Mapeo de campos por dispositivo ──────────────────
    let temperature = null, humidity    = null, co2      = null;
    let pressure    = null, light_level = null, tvoc     = null;
    let pir         = null, battery     = null;
    let occupancy   = null, illuminance = null;
    let lai         = null, laimax      = null, laeq     = null;

    if (deviceId === '7en1') {
      temperature  = payload.temperature  ?? null;
      humidity     = payload.humidity     ?? null;
      co2          = payload.co2          ?? null;
      pressure     = payload.pressure     ?? null;
      light_level  = payload.light_level  ?? null;
      tvoc         = payload.tvoc         ?? null;
      pir          = payload.pir          ?? null;
      battery      = payload.battery      ?? null;
    } else if (deviceId === 'presence') {
      battery     = payload.battery     ?? null;
      occupancy   = payload.occupancy   ?? null;
      illuminance = payload.illuminance ?? null;
    } else if (deviceId === 'sound') {
      battery = payload.battery ?? null;
      lai     = payload.LAI     ?? null;
      laimax  = payload.LAImax  ?? null;
      laeq    = payload.LAeq    ?? null;
    }

    const db = sql();

    // ── Detectar gap / recuperación ───────────────────────
    // Si el dispositivo estaba marcado como offline y acaba de mandar
    // un uplink, mandamos notificación de recuperación y limpiamos el cooldown
    const lastRow = await db`
      SELECT received_at FROM sensor_readings
      WHERE device_id = ${deviceId}
      ORDER BY received_at DESC
      LIMIT 1
    `;

    const baseUrl        = process.env.BASE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
    const internalSecret = process.env.INTERNAL_SECRET || process.env.TTN_WEBHOOK_SECRET || '';

    if (lastRow.length > 0) {
      const lastTime  = new Date(lastRow[0].received_at);
      const gapMs     = new Date(receivedAt) - lastTime;
      const gapMin    = Math.floor(gapMs / 60000);
      const GAP_ALERT = parseInt(process.env.WATCHDOG_GAP_MIN || '8');

      if (gapMin >= GAP_ALERT) {
        console.log(`Gap recovered for ${deviceId}: was offline ${gapMin} min`);

        // Limpiar cooldown de offline para que el watchdog pueda alertar de nuevo si vuelve a caer
        await db`
          DELETE FROM alert_cooldowns
          WHERE device_id = ${deviceId} AND field = 'offline'
        `;

        // Notificar recuperación
        const recoveryMsg = [
          `✅ *Señal recuperada — ${deviceId}*`,
          ``,
          `Estuvo sin señal: ${gapMin} minutos`,
          `Recuperado: ${new Date(receivedAt).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })}`,
        ].join('\n');

        fetch(`${baseUrl}/api/send-alert`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${internalSecret}`,
          },
          body: JSON.stringify({
            to:      process.env.ALERT_EMAIL || '',
            channel: 'all',
            subject: `✅ Recuperado: ${deviceId}`,
            body:    recoveryMsg,
          }),
        }).catch(e => console.error('Recovery alert failed:', e));
      }
    }

    // ── INSERT lectura ────────────────────────────────────
    await db`
      INSERT INTO sensor_readings
        (device_id, received_at,
         temperature, humidity, co2, pressure, light_level, tvoc, pir, battery,
         occupancy, illuminance,
         lai, laimax, laeq)
      VALUES
        (${deviceId}, ${receivedAt},
         ${temperature}, ${humidity}, ${co2}, ${pressure}, ${light_level}, ${tvoc}, ${pir}, ${battery},
         ${occupancy}, ${illuminance},
         ${lai}, ${laimax}, ${laeq})
    `;

    // ── Umbrales desde env vars ───────────────────────────
    const TH = {
      temperature: { min: parseFloat(process.env.TH_TEMP_MIN   || '16'),  max: parseFloat(process.env.TH_TEMP_MAX   || '30')   },
      humidity:    { min: parseFloat(process.env.TH_HUM_MIN    || '30'),  max: parseFloat(process.env.TH_HUM_MAX    || '70')   },
      co2:         { min: 0,                                               max: parseFloat(process.env.TH_CO2_MAX    || '1000') },
      tvoc:        { min: 0,                                               max: parseFloat(process.env.TH_TVOC_MAX   || '1000') },
      pressure:    { min: parseFloat(process.env.TH_PRES_MIN   || '800'), max: parseFloat(process.env.TH_PRES_MAX   || '1050') },
      laeq:        { min: 0,                                               max: parseFloat(process.env.TH_LAEQ_MAX   || '70')  },
      laimax:      { min: 0,                                               max: parseFloat(process.env.TH_LAIMAX_MAX || '85')  },
      battery:     { min: parseFloat(process.env.TH_BAT_MIN    || '20'),  max: 100 },
    };

    // ── Qué valores checar para este dispositivo ──────────
    const checks = {
      '7en1':     [['temperature',temperature],['humidity',humidity],['co2',co2],['tvoc',tvoc],['pressure',pressure],['battery',battery]],
      'sound':    [['laeq',laeq],['laimax',laimax],['battery',battery]],
      'presence': [['battery',battery]],
    }[deviceId] || [];

    const alertsToSend = [];

    for (const [field, value] of checks) {
      if (value === null || value === undefined) continue;
      const th = TH[field];
      if (!th) continue;

      const isOutOfRange = value < th.min || value > th.max;

      if (!isOutOfRange) {
        // Valor volvió al rango normal — limpiar cooldown para que
        // la próxima vez que salga se alerte inmediatamente
        await db`
          DELETE FROM alert_cooldowns
          WHERE device_id = ${deviceId} AND field = ${field}
        `;
        continue;
      }

      // Está fuera de rango — verificar cooldown en BD
      const cooldownRows = await db`
        SELECT last_sent FROM alert_cooldowns
        WHERE device_id = ${deviceId} AND field = ${field}
      `;

      const now = new Date();
      const cooldownMs = COOLDOWN_MINUTES * 60 * 1000;

      if (cooldownRows.length > 0) {
        const lastSent = new Date(cooldownRows[0].last_sent);
        const elapsed  = now - lastSent;
        if (elapsed < cooldownMs) {
          // Todavía en cooldown, no mandar alerta
          continue;
        }
      }

      // Fuera de rango Y fuera de cooldown → alertar
      // Upsert del cooldown con el timestamp actual
      await db`
        INSERT INTO alert_cooldowns (device_id, field, last_sent)
        VALUES (${deviceId}, ${field}, ${now.toISOString()})
        ON CONFLICT (device_id, field)
        DO UPDATE SET last_sent = ${now.toISOString()}
      `;

      const dir = value < th.min ? 'BAJO' : 'ALTO';
      const lim = dir === 'BAJO' ? th.min : th.max;
      alertsToSend.push(`${fieldLabel(field)} ${dir}: ${value}${fieldUnit(field)} (límite: ${lim}${fieldUnit(field)})`);
    }

    // ── Mandar alertas acumuladas en un solo mensaje ──────
    if (alertsToSend.length > 0) {
      const alertMsg = `Dispositivo: *${deviceId}*\n\n${alertsToSend.join('\n')}`;

      const alertRes = await fetch(`${baseUrl}/api/send-alert`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${internalSecret}`,
        },
        body: JSON.stringify({
          to: process.env.ALERT_EMAIL || '',
          channel: 'all',
          subject: `⚠️ Alerta IoT: ${deviceId}`,
          body: alertMsg,
        }),
      });

      if (!alertRes.ok) {
        const errText = await alertRes.text();
        console.error(`Alert dispatch failed — status: ${alertRes.status}, body: ${errText}, url: ${baseUrl}/api/send-alert`);
      } else {
        console.log(`Alerts sent OK to ${baseUrl}/api/send-alert — ${alertsToSend.length} alert(s)`);
      }
    }

    return res.status(200).json({ ok: true, alerts_sent: alertsToSend.length });
  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).json({ error: String(err) });
  }
}

function fieldLabel(field) {
  return {
    temperature: '🌡 Temperatura', humidity: '💧 Humedad',
    co2: '🫧 CO₂', tvoc: '🧪 TVOC', pressure: '🔵 Presión',
    laeq: '🔊 Ruido LAeq', laimax: '📢 Ruido LAImax',
    battery: '🔋 Batería',
  }[field] || field;
}

function fieldUnit(field) {
  return { temperature:'°C', humidity:'%', co2:'ppm', tvoc:'µg/m³', pressure:'hPa', laeq:'dB', laimax:'dB', battery:'%' }[field] || '';
}