-- ============================================================
-- SCHEMA COMPLETO — ejecutar en Neon SQL Editor (una sola vez)
-- ============================================================

-- Tabla de usuarios del dashboard
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'viewer',  -- 'admin' | 'viewer'
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Tabla principal de lecturas de sensores
CREATE TABLE IF NOT EXISTS sensor_readings (
  id           BIGSERIAL PRIMARY KEY,
  device_id    TEXT NOT NULL,
  received_at  TIMESTAMPTZ NOT NULL,
  temperature  FLOAT,
  humidity     FLOAT,
  co2          INT,
  pressure     FLOAT,
  light_level  INT,
  tvoc         INT,
  pir          TEXT,
  battery      INT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para queries rápidas por fecha y dispositivo
CREATE INDEX IF NOT EXISTS idx_readings_device_time
  ON sensor_readings (device_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_readings_time
  ON sensor_readings (received_at DESC);

-- ============================================================
-- CREAR USUARIOS INICIALES
-- Genera el hash con: node -e "const b=require('bcryptjs'); console.log(b.hashSync('TU_PASSWORD',10))"
-- O usa el script create-user.js incluido en este proyecto
-- ============================================================

-- Ejemplo (reemplaza el hash por uno real generado con bcryptjs):
-- INSERT INTO users (email, password_hash, role)
-- VALUES ('tu@email.com', '$2b$10$HASH_AQUI', 'admin');
-- INSERT INTO users (email, password_hash, role)
-- VALUES ('cliente@email.com', '$2b$10$HASH_AQUI', 'viewer');
