// api/readings.js
import { sql, authFromRequest, cors } from '../lib/db.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = authFromRequest(req);
  if (!user) return res.status(401).json({ error: 'No autorizado' });

  const { range = 'today', device = 'all', limit = '500' } = req.query;

  // Calculate since timestamp
  const now = new Date();
  let since;
  if (range === 'today') {
    since = new Date(now); since.setHours(0, 0, 0, 0);
  } else if (range === '7d') {
    since = new Date(now - 7 * 86400000);
  } else {
    since = new Date(now - 30 * 86400000);
  }

  try {
    const db = sql();
    let rows;

    if (device === 'all') {
      rows = await db`
        SELECT id, device_id, received_at,
               temperature, humidity, co2, pressure,
               light_level, tvoc, pir, battery
        FROM sensor_readings
        WHERE received_at >= ${since.toISOString()}
        ORDER BY received_at ASC
        LIMIT ${parseInt(limit)}
      `;
    } else {
      rows = await db`
        SELECT id, device_id, received_at,
               temperature, humidity, co2, pressure,
               light_level, tvoc, pir, battery
        FROM sensor_readings
        WHERE received_at >= ${since.toISOString()}
          AND device_id = ${device}
        ORDER BY received_at ASC
        LIMIT ${parseInt(limit)}
      `;
    }

    return res.status(200).json({ data: rows });
  } catch (err) {
    console.error('Readings error:', err);
    return res.status(500).json({ error: 'Error consultando datos' });
  }
}
