// api/readings.js
import { sql, authFromRequest, cors } from '../lib/db.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = authFromRequest(req);
  if (!user) return res.status(401).json({ error: 'No autorizado' });

  const { range = 'today', device = 'all', since: sinceParam } = req.query;

  const now = new Date();
  let since;
  if (sinceParam) {
    since = new Date(sinceParam);
  } else if (range === 'today') {
    since = new Date(now); since.setHours(0, 0, 0, 0);
  } else if (range === '7d') {
    since = new Date(now - 7 * 86400000);
  } else {
    since = new Date(now - 30 * 86400000);
  }

  // Límite por rango — sensores enviando cada 1 min
  // hoy: 1440/sensor, 7d: 10080/sensor, 30d: 43200/sensor
  // Para gráficas fluidas usamos submuestreo en el frontend
  const lim = range === '30d' ? 10000 : range === '7d' ? 3000 : 1500;

  const sinceISO = since.toISOString();

  try {
    const db = sql();
    let rows;

    if (device !== 'all') {
      // Un sensor específico — traer los más recientes y revertir para graficar
      const raw = await db`
        SELECT id, device_id, received_at,
               temperature, humidity, co2, pressure,
               light_level, tvoc, pir, battery,
               occupancy, illuminance, lai, laimax, laeq
        FROM sensor_readings
        WHERE received_at >= ${sinceISO}
          AND device_id = ${device}
        ORDER BY received_at DESC
        LIMIT ${lim}
      `;
      rows = raw.reverse();
    } else {
      // Todos los sensores — query independiente por sensor para que
      // ninguno robe espacio del otro con el límite
      const [r7, rS, rP, last7, lastS, lastP] = await Promise.all([
        db`SELECT id, device_id, received_at, temperature, humidity, co2, pressure, light_level, tvoc, pir, battery, occupancy, illuminance, lai, laimax, laeq
           FROM sensor_readings WHERE received_at >= ${sinceISO} AND device_id = '7en1'
           ORDER BY received_at DESC LIMIT ${lim}`,
        db`SELECT id, device_id, received_at, temperature, humidity, co2, pressure, light_level, tvoc, pir, battery, occupancy, illuminance, lai, laimax, laeq
           FROM sensor_readings WHERE received_at >= ${sinceISO} AND device_id = 'sound'
           ORDER BY received_at DESC LIMIT ${lim}`,
        db`SELECT id, device_id, received_at, temperature, humidity, co2, pressure, light_level, tvoc, pir, battery, occupancy, illuminance, lai, laimax, laeq
           FROM sensor_readings WHERE received_at >= ${sinceISO} AND device_id = 'presence'
           ORDER BY received_at DESC LIMIT ${lim}`,
        // Último de cada sensor sin importar rango — garantiza KPIs actualizados
        db`SELECT id, device_id, received_at, temperature, humidity, co2, pressure, light_level, tvoc, pir, battery, occupancy, illuminance, lai, laimax, laeq
           FROM sensor_readings WHERE device_id = '7en1' ORDER BY received_at DESC LIMIT 1`,
        db`SELECT id, device_id, received_at, temperature, humidity, co2, pressure, light_level, tvoc, pir, battery, occupancy, illuminance, lai, laimax, laeq
           FROM sensor_readings WHERE device_id = 'sound' ORDER BY received_at DESC LIMIT 1`,
        db`SELECT id, device_id, received_at, temperature, humidity, co2, pressure, light_level, tvoc, pir, battery, occupancy, illuminance, lai, laimax, laeq
           FROM sensor_readings WHERE device_id = 'presence' ORDER BY received_at DESC LIMIT 1`,
      ]);

      // Revertir cada array a orden cronológico y combinar
      const historico = [
        ...r7.reverse(),
        ...rS.reverse(),
        ...rP.reverse(),
      ].sort((a, b) => new Date(a.received_at) - new Date(b.received_at));

      // Asegurar que el último de cada sensor esté incluido
      // aunque esté fuera del rango de fecha seleccionado
      const ids = new Set(historico.map(r => r.id));
      for (const latest of [...last7, ...lastS, ...lastP]) {
        if (!ids.has(latest.id)) historico.push(latest);
      }

      rows = historico;
    }

    return res.status(200).json({ data: rows });
  } catch (err) {
    console.error('Readings error:', err);
    return res.status(500).json({ error: String(err) });
  }
}