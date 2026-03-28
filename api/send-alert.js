// api/send-alert.js
import { authFromRequest, cors } from '../lib/db.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = authFromRequest(req);
  if (!user) return res.status(401).json({ error: 'No autorizado' });

  const { to, subject, body, channel } = req.body || {};
  if (!to || !body || !channel)
    return res.status(400).json({ error: 'Missing fields' });

  try {
    if (channel === 'email') {
      await sendEmail(to, subject || 'Alerta IoT', body);
    } 
    else if (channel === 'sms') {
      // Aquí cambiamos Twilio -> Telegram GRATIS
      await sendTelegram(body);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Alert error:', err);
    return res.status(500).json({ error: String(err) });
  }
}

// ── Email via Resend (free: 3,000 emails/month) ───────────
async function sendEmail(to, subject, body) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY not configured');

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <style>
    body{font-family:-apple-system,sans-serif;background:#f4f6f9;padding:20px;margin:0}
    .card{background:#fff;border-radius:14px;padding:28px;max-width:520px;margin:0 auto;border-left:5px solid #ff4757}
    .header{display:flex;align-items:center;gap:12px;margin-bottom:18px}
    .ico{font-size:28px}
    .title{font-size:18px;font-weight:700;color:#1a1a2e}
    .msg{font-size:15px;color:#333;line-height:1.7;background:#f8f9fb;padding:16px;border-radius:9px;margin:16px 0;border:1px solid #eee}
    .footer{font-size:12px;color:#aaa;margin-top:20px;border-top:1px solid #eee;padding-top:12px}
  </style></head><body>
  <div class="card">
    <div class="header"><span class="ico">🚨</span><span class="title">Alerta — Biblioteca IoT</span></div>
    <div class="msg">${body}</div>
    <div class="footer">Biblioteca IoT Monitor · ${new Date().toLocaleString('es-MX')}<br>Generado automáticamente.</div>
  </div></body></html>`;

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.RESEND_FROM || 'alertas@tudominio.com', to: [to], subject, html })
  });
  if (!r.ok) throw new Error(`Resend: ${await r.text()}`);
}

// ── FREE SMS-LIKE ALERT via Telegram Bot (instead of Twilio) ──────────
async function sendTelegram(body) {
  const bot = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;

  if (!bot || !chat) throw new Error('Telegram credentials not configured');

  const text = `⚠️ *Alerta IoT Biblioteca*\n${body}\n_${new Date().toLocaleString('es-MX')}_`;

  const url = `https://api.telegram.org/bot${bot}/sendMessage`;

  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chat,
      text,
      parse_mode: "Markdown"
    })
  });

  const data = await r.json();
  if (!data.ok) throw new Error(`Telegram: ${JSON.stringify(data)}`);
}