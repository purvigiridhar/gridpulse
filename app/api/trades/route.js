import { NextResponse } from 'next/server';
import pool, { query } from '@/lib/mysql';
import {
  requireAuth, readJsonBody, jsonError, dbErrorResponse,
  parseMeterId, parseDecimal, parseIntParam, toNumber,
} from '@/lib/api-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Calls the stored procedure, retrying on InnoDB deadlock (errno 1213). */
async function executeTrade(seller, buyer, units) {
  for (let attempt = 1; ; attempt++) {
    try {
      const [result] = await pool.execute('CALL sp_execute_energy_trade(?,?,?)', [seller, buyer, units]);
      // CALL yields [ [rowOfResultSet], ResultSetHeader ]
      const row = Array.isArray(result) ? result.find(Array.isArray)?.[0] : undefined;
      if (!row) throw new Error('sp_execute_energy_trade returned no result row');
      return row;
    } catch (err) {
      if (err?.errno === 1213 && attempt < 3) {
        await sleep(50 * attempt);
        continue;
      }
      throw err;
    }
  }
}

/**
 * POST /api/trades  { seller_meter_id, buyer_meter_id, units_kwh }
 * The signed-in PROSUMER is the buyer (they pay), so buyer_meter_id must be
 * one of their own active meters.
 */
export async function POST(request) {
  const auth = await requireAuth(['PROSUMER']);
  if (auth.error) return auth.error;
  const { user } = auth;

  const parsed = await readJsonBody(request);
  if (parsed.error) return parsed.error;
  const { body } = parsed;

  const seller = parseMeterId(body.seller_meter_id, 'seller_meter_id');
  const buyer = parseMeterId(body.buyer_meter_id, 'buyer_meter_id');
  const units = parseDecimal(body.units_kwh, { name: 'units_kwh', intDigits: 6, scale: 2, positive: true });

  const details = {};
  if (seller.error) details.seller_meter_id = seller.error;
  if (buyer.error) details.buyer_meter_id = buyer.error;
  if (units.error) details.units_kwh = units.error;
  if (!Object.keys(details).length && seller.value === buyer.value) {
    details.buyer_meter_id = 'Seller and buyer meters must differ.';
  }
  if (Object.keys(details).length) return jsonError(400, 'Validation failed.', details);

  try {
    const owned = await query(
      'SELECT 1 FROM smart_meters WHERE meter_id = ? AND user_id = ? AND is_active = TRUE LIMIT 1',
      [buyer.value, user.user_id]
    );
    if (!owned.length) {
      return jsonError(403, 'buyer_meter_id must be one of your active meters.');
    }

    const row = await executeTrade(seller.value, buyer.value, units.value);

    return NextResponse.json(
      {
        trade: {
          trade_id: row.trade_id,
          seller_meter_id: seller.value,
          buyer_meter_id: buyer.value,
          units_kwh: units.number,
          rate_per_kwh: toNumber(row.rate_per_kwh),
          total_amount: toNumber(row.total_amount),
          trade_status: 'COMPLETED',
        },
      },
      { status: 201 }
    );
  } catch (err) {
    return dbErrorResponse(err, 'POST /api/trades');
  }
}

/**
 * GET /api/trades?limit=20[&meter_id=...]
 * PROSUMER: trades where any of their meters is seller or buyer (with direction).
 * ADMIN: all trades, optionally filtered by meter.
 */
export async function GET(request) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;
  const { user } = auth;

  const sp = request.nextUrl.searchParams;
  const limit = parseIntParam(sp.get('limit'), { name: 'limit', min: 1, max: 100, fallback: 20 });
  if (limit.error) return jsonError(400, limit.error);

  let meterFilter = null;
  if (sp.get('meter_id')) {
    const m = parseMeterId(sp.get('meter_id'), 'meter_id');
    if (m.error) return jsonError(400, m.error);
    meterFilter = m.value;
  }

  const cols = `et.trade_id, et.seller_meter_id, et.buyer_meter_id, et.units_kwh,
                et.rate_per_kwh, et.total_amount, et.trade_status, et.traded_at`;
  // limit.value is a validated integer, so inlining it is safe (avoids a
  // prepared-statement LIMIT ? type quirk in some MySQL 8 versions).
  const tail = `ORDER BY et.traded_at DESC, et.trade_id DESC LIMIT ${limit.value}`;

  try {
    let rows;
    if (user.user_role === 'ADMIN') {
      rows = await query(
        `SELECT ${cols} FROM energy_trades et
          ${meterFilter ? 'WHERE et.seller_meter_id = ? OR et.buyer_meter_id = ?' : ''}
          ${tail}`,
        meterFilter ? [meterFilter, meterFilter] : []
      );
    } else {
      const params = [user.user_id, user.user_id, user.user_id];
      if (meterFilter) params.push(meterFilter, meterFilter);
      rows = await query(
        `SELECT ${cols},
                CASE WHEN sm_s.user_id = ? THEN 'SOLD' ELSE 'BOUGHT' END AS direction
           FROM energy_trades et
           JOIN smart_meters sm_s ON sm_s.meter_id = et.seller_meter_id
           JOIN smart_meters sm_b ON sm_b.meter_id = et.buyer_meter_id
          WHERE (sm_s.user_id = ? OR sm_b.user_id = ?)
          ${meterFilter ? 'AND (et.seller_meter_id = ? OR et.buyer_meter_id = ?)' : ''}
          ${tail}`,
        params
      );
    }

    const trades = rows.map((r) => ({
      ...r,
      units_kwh: toNumber(r.units_kwh),
      rate_per_kwh: toNumber(r.rate_per_kwh),
      total_amount: toNumber(r.total_amount),
    }));
    return NextResponse.json({ count: trades.length, trades });
  } catch (err) {
    return dbErrorResponse(err, 'GET /api/trades');
  }
}
