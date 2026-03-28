#!/usr/bin/env node
// create-user.js — run locally to add users to Neon
// Usage: node create-user.js <email> <password> [role]
// Example: node create-user.js admin@biblioteca.com MiPass123 admin

import bcrypt from 'bcryptjs';
import { neon } from '@neondatabase/serverless';

const [,, email, password, role = 'viewer'] = process.argv;

if (!email || !password) {
  console.error('Usage: node create-user.js <email> <password> [admin|viewer]');
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error('Set DATABASE_URL env var first:\nexport DATABASE_URL="postgresql://..."');
  process.exit(1);
}

const hash = await bcrypt.hash(password, 10);
const db   = neon(process.env.DATABASE_URL);

try {
  const rows = await db`
    INSERT INTO users (email, password_hash, role)
    VALUES (${email.toLowerCase()}, ${hash}, ${role})
    ON CONFLICT (email) DO UPDATE SET password_hash = ${hash}, role = ${role}
    RETURNING id, email, role
  `;
  console.log('✓ Usuario creado/actualizado:', rows[0]);
} catch (err) {
  console.error('Error:', err.message);
  process.exit(1);
}
