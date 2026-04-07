// api/send-alert.js
import { authFromRequest, cors } from '../lib/db.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user          = authFromRequest(req);
  const authHeader    = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
  const serviceSecret = process.env.INTERNAL_SECRET || process.env.TTN_WEBHOOK_SECRET || '';
  const isInternal    = serviceSecret && authHeader === serviceSecret;

  if (!user && !isInternal) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  const { to, subject, body, channel } = req.body || {};
  if (!body || !channel) return res.status(400).json({ error: 'Missing fields' });

  try {
    const tasks = [];

    if (channel === 'email' || channel === 'all') {
      if (to) tasks.push(sendEmail(to, subject || 'Alerta IoT', body));
    }
    if (channel === 'telegram' || channel === 'all') {
      tasks.push(sendTelegram(body, to));
    }
    if (channel === 'teams' || channel === 'all') {
      tasks.push(sendTeams(body, subject));
    }

    const results = await Promise.allSettled(tasks);
    const errors  = results.filter(r => r.status === 'rejected').map(r => r.reason?.message || r.reason);
    if (errors.length > 0) console.error('Some channels failed:', errors);

    return res.status(200).json({ ok: true, channels_sent: results.length - errors.length, errors });
  } catch (err) {
    console.error('Alert error:', err);
    return res.status(500).json({ error: String(err) });
  }
}

// ── Email via Resend ──────────────────────────────────────
async function sendEmail(to, subject, body) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY not configured');

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <style>
    body{font-family:-apple-system,sans-serif;background:#f4f6f9;padding:20px;margin:0}
    .card{background:#fff;border-radius:14px;padding:28px;max-width:520px;margin:0 auto;border-left:5px solid #ef4444}
    .header{display:flex;align-items:center;gap:12px;margin-bottom:18px}
    .ico{font-size:28px}.title{font-size:18px;font-weight:700;color:#1a1a2e}
    .msg{font-size:15px;color:#333;line-height:1.7;background:#f8f9fb;padding:16px;border-radius:9px;margin:16px 0;border:1px solid #eee}
    .footer{font-size:12px;color:#aaa;margin-top:20px;border-top:1px solid #eee;padding-top:12px}
  </style></head><body>
  <div class="card">
    <div class="header"><span class="ico">🚨</span><span class="title">Alerta — Biblioteca IoT</span></div>
    <div class="msg">${body}</div>
    <div class="footer">Biblioteca IoT Monitor · ${new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })}<br>Generado automáticamente.</div>
  </div></body></html>`;

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.RESEND_FROM || 'luis.arellano@iteso.mx', to: [to], subject, html })
  });
  if (!r.ok) throw new Error(`Resend: ${await r.text()}`);
}

// ── Telegram — múltiples destinatarios ───────────────────
async function sendTelegram(body, toChatId) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) throw new Error('TELEGRAM_BOT_TOKEN not configured');

  const envIds = (process.env.TELEGRAM_CHAT_IDS || process.env.TELEGRAM_CHAT_ID || '')
    .split(',').map(s => s.trim()).filter(Boolean);

  if (toChatId && toChatId !== 'telegram' && !envIds.includes(String(toChatId))) {
    envIds.push(String(toChatId));
  }

  if (envIds.length === 0) throw new Error('No Telegram chat IDs configured.');

  const text = `⚠️ *Alerta IoT Biblioteca*\n\n${body}\n\n_${new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })}_`;
  const url  = `https://api.telegram.org/bot${botToken}/sendMessage`;

  const results = await Promise.allSettled(
    envIds.map(chatId =>
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
      }).then(r => r.json())
    )
  );

  const failed = results.filter(r => r.status === 'rejected' || !r.value?.ok);
  if (failed.length > 0) console.warn('Some Telegram sends failed:', JSON.stringify(failed));

  const anyOk = results.some(r => r.status === 'fulfilled' && r.value?.ok);
  if (!anyOk) throw new Error('All Telegram sends failed: ' + JSON.stringify(results));
}

// ── Microsoft Teams via Workflow Webhook ─────────────────
// Variable de entorno: TEAMS_WEBHOOK_URL
// Obtener URL: Teams → Apps → Workflows → "Send webhook alerts to a chat"
async function sendTeams(body, subject) {
  const url = process.env.TEAMS_WEBHOOK_URL;
  if (!url) throw new Error('TEAMS_WEBHOOK_URL not configured');

  const now = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });

  // Formato compatible con Teams Workflow webhooks
  const payload = {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          '$schema': 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.2',
          body: [
            {
              type: 'TextBlock',
              text: subject || '⚠️ Alerta IoT Biblioteca',
              weight: 'Bolder',
              size: 'Medium',
              color: 'Attention',
              wrap: true,
            },
            {
              type: 'TextBlock',
              text: body.replace(/\*/g, '').replace(/_/g, ''),
              wrap: true,
              spacing: 'Medium',
            },
            {
              type: 'TextBlock',
              text: `🕐 ${now}`,
              isSubtle: true,
              size: 'Small',
              spacing: 'Small',
            },
          ],
        },
      },
    ],
  };

  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  // Teams Workflows devuelve 202 Accepted, no 200
  if (!r.ok && r.status !== 202) {
    throw new Error(`Teams webhook failed: ${r.status} ${await r.text()}`);
  }
}