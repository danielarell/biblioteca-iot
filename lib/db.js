// lib/db.js  — shared across all /api routes
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export function sql() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL not set');
  return neon(process.env.DATABASE_URL);
}

const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret_in_vercel_env';
const JWT_EXPIRES = '7d';

export function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

// Extract + verify Bearer token from request headers
export function authFromRequest(req) {
  const header = req.headers['authorization'] || req.headers['Authorization'] || '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  try { return verifyToken(token); }
  catch { return null; }
}

export function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}
