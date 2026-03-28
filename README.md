# Biblioteca IoT — Setup completo
## Stack: Neon (PostgreSQL) + Vercel (API + Frontend) + JWT propio

```
biblioteca-iot/
├── package.json
├── vercel.json
├── schema.sql
├── create-user.js
├── lib/db.js
├── api/
│   ├── auth/login.js
│   ├── readings.js
│   ├── ttn-webhook.js
│   └── send-alert.js
└── public/
    ├── login.html
    └── index.html
```

## PASO 1 — Neon
1. neon.tech → nuevo proyecto → copia la Connection String
2. SQL Editor → pega y ejecuta schema.sql

## PASO 2 — Crear usuarios
```bash
npm install
export DATABASE_URL="postgresql://..."
node --input-type=module create-user.js tu@email.com Password123 admin
node --input-type=module create-user.js cliente@email.com Pass456 viewer
```

## PASO 3 — Deploy Vercel
```bash
npm install -g vercel
vercel login
vercel --prod
# Framework: Other | Root: . | Build: (vacío) | Output: public
```

## PASO 4 — Variables en Vercel → Settings → Environment Variables
- DATABASE_URL       = postgresql://...neon.tech/db?sslmode=require
- JWT_SECRET         = (node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
- TTN_WEBHOOK_SECRET = token_secreto_para_ttn
- RESEND_API_KEY     = re_xxxx  (resend.com, gratis 3k emails/mes)
- RESEND_FROM        = alertas@tudominio.com
- TWILIO_ACCOUNT_SID = ACxxxx
- TWILIO_AUTH_TOKEN  = xxxx
- TWILIO_FROM_NUMBER = +1234567890

Después: Deployments → Redeploy

## PASO 5 — Webhook TTN
TTN Console → Integrations → Webhooks → Add:
- Base URL: https://tu-app.vercel.app/api/ttn-webhook
- Header: Authorization: Bearer TOKEN_WEBHOOK_SECRET
- Enable: Uplink message

## Polling
El dashboard consulta /api/readings cada 15 segundos (igual que el intervalo del sensor).
Sin WebSockets, sin réplicas. Simple y funciona perfecto con Neon serverless.
