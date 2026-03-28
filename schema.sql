-- ============================================================
-- SCHEMA v2 — Biblioteca IoT
-- ============================================================

-- Tabla de usuarios del dashboard
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'viewer',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Tabla principal de lecturas (todos los sensores)
CREATE TABLE IF NOT EXISTS sensor_readings (
  id           BIGSERIAL PRIMARY KEY,
  device_id    TEXT NOT NULL,
  received_at  TIMESTAMPTZ NOT NULL,

  -- 7en1: sensor ambiental
  temperature  FLOAT,
  humidity     FLOAT,
  co2          INT,
  pressure     FLOAT,
  light_level  INT,
  tvoc         INT,
  pir          TEXT,
  battery      INT,

  -- presence: ocupación
  occupancy    TEXT,        -- "occupied" | "unoccupied"
  illuminance  TEXT,        -- "dim" | "bright" | "dark"

  -- sound: ruido (dB)
  lai          FLOAT,       -- Level Acoustic Instantaneous
  laimax       FLOAT,       -- Pico máximo
  laeq         FLOAT,       -- Nivel equivalente (el más importante)

  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_readings_device_time
  ON sensor_readings (device_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_readings_time
  ON sensor_readings (received_at DESC);

-- Tabla de cooldowns de alertas (evita spam al recargar página)
-- El webhook escribe aquí antes de mandar una alerta
-- Si ya hay un registro reciente para ese device+field, no manda
-- field = 'offline' es usado por el watchdog para cooldown de alertas sin señal
CREATE TABLE IF NOT EXISTS alert_cooldowns (
  id         SERIAL PRIMARY KEY,
  device_id  TEXT NOT NULL,
  field      TEXT NOT NULL,
  last_sent  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (device_id, field)
);

-- ============================================================
-- VARIABLES DE ENTORNO ADICIONALES PARA EL WATCHDOG
-- Agregar en Vercel → Settings → Environment Variables
-- ============================================================
-- CRON_SECRET          = cadena aleatoria (igual a la que configures en Vercel Cron)
--                        genera con: node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
-- WATCHDOG_GAP_MIN     = 8    (minutos sin señal antes de alertar, default: 8)
-- WATCHDOG_COOLDOWN_MIN= 30   (minutos entre alertas de offline del mismo dispositivo, default: 30)
-- BASE_URL             = https://tu-app.vercel.app  (ya debería estar configurada)
-- ALERT_EMAIL          = correo@destino.com         (ya debería estar configurada)


-- ============================================================
-- SI YA TIENES LA TABLA CREADA (migración incremental):
-- Ejecuta solo este bloque en el SQL Editor de Neon
-- ============================================================
ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS occupancy   TEXT;
ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS illuminance TEXT;
ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS lai         FLOAT;
ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS laimax      FLOAT;
ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS laeq        FLOAT;


-- ============================================================
-- USUARIOS — crear con el script create-user.js
-- ============================================================
-- node --input-type=module create-user.js tu@email.com Password123 admin
-- node --input-type=module create-user.js cliente@email.com Pass456 viewer