import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';

/* ------------------------------ responses ------------------------------ */

export function jsonError(status, message, details, headers) {
  return NextResponse.json(
    { error: message, ...(details ? { details } : {}) },
    { status, headers }
  );
}

/**
 * Map a database error to an HTTP response.
 * - SQLSTATE 45000: business rule raised by our stored procedure -> 400 + its message
 * - deadlock / lock-wait timeout -> 503 (safe to retry)
 * - FK violation -> 404, CHECK violation -> 400
 * - connection failures -> 503
 * Anything else is logged server-side and returned as a generic 500.
 */
export function dbErrorResponse(err, label) {
  if (err?.sqlState === '45000') {
    return jsonError(400, err.sqlMessage || err.message);
  }
  if (err?.errno === 1213 || err?.errno === 1205) {
    return jsonError(503, 'The system is busy, please retry.', undefined, { 'Retry-After': '1' });
  }
  if (err?.errno === 1452) {
    return jsonError(404, 'Referenced record does not exist.');
  }
  if (err?.errno === 3819) {
    return jsonError(400, 'Value violates a data constraint.');
  }
  if (['ECONNREFUSED', 'PROTOCOL_CONNECTION_LOST', 'ETIMEDOUT', 'ER_CON_COUNT_ERROR'].includes(err?.code)) {
    console.error(`[api] ${label}: database unavailable:`, err.code);
    return jsonError(503, 'Database temporarily unavailable.');
  }
  console.error(`[api] ${label}:`, err);
  return jsonError(500, 'Internal server error.');
}

/* ------------------------------ auth ------------------------------ */

/**
 * @param {string[]} [roles] allowed roles; omit to allow any signed-in user
 * @returns {Promise<{user: object} | {error: Response}>}
 */
export async function requireAuth(roles) {
  const session = await getServerSession(authOptions);
  const user = session?.user;
  if (!user?.user_id) {
    return { error: jsonError(401, 'Authentication required.') };
  }
  if (roles && !roles.includes(user.user_role)) {
    return { error: jsonError(403, 'You do not have permission to perform this action.') };
  }
  return { user };
}

/* ------------------------------ parsing ------------------------------ */

export async function readJsonBody(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return { error: jsonError(400, 'Request body must be valid JSON.') };
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { error: jsonError(400, 'Request body must be a JSON object.') };
  }
  return { body };
}

/** Integer from a query/body value. Returns { value } or { error }. */
export function parseIntParam(raw, { name, min = 1, max = 2147483647, fallback } = {}) {
  if (raw === null || raw === undefined || raw === '') {
    return fallback !== undefined ? { value: fallback } : { error: `${name} is required.` };
  }
  const s = String(raw).trim();
  if (!/^\d+$/.test(s)) return { error: `${name} must be a whole number.` };
  const n = Number(s);
  if (n < min || n > max) return { error: `${name} must be between ${min} and ${max}.` };
  return { value: n };
}

/**
 * Exact decimal from a JSON number or numeric string, validated by regex so
 * values like 1e3, -5, 0x10, "NaN" or 1.234 are rejected rather than coerced.
 * `value` is the normalised string (safe to pass to a DECIMAL column);
 * `number` is the JS number for comparisons.
 */
export function parseDecimal(raw, { name, intDigits, scale = 2, positive = false, max } = {}) {
  if (typeof raw !== 'number' && typeof raw !== 'string') {
    return { error: `${name} is required.` };
  }
  const s = String(raw).trim();
  const re = new RegExp(`^\\d{1,${intDigits}}(\\.\\d{1,${scale}})?$`);
  if (!re.test(s)) {
    return { error: `${name} must be a non-negative number with at most ${scale} decimal places.` };
  }
  const n = Number(s);
  if (positive && n <= 0) return { error: `${name} must be greater than zero.` };
  if (max !== undefined && n > max) return { error: `${name} must be at most ${max}.` };
  return { value: s, number: n };
}

const METER_ID_RE = /^[A-Za-z0-9_-]{1,50}$/;
export function parseMeterId(raw, name) {
  if (typeof raw !== 'string' || !METER_ID_RE.test(raw.trim())) {
    return { error: `${name} must be 1-50 characters (letters, digits, '-' or '_').` };
  }
  return { value: raw.trim() };
}

/** DECIMAL columns come back from mysql2 as strings; convert for JSON output. */
export const toNumber = (v) => (v === null || v === undefined ? null : Number(v));
export const round2 = (n) => Math.round(n * 100) / 100;
