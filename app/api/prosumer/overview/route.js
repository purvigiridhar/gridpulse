import { NextResponse } from 'next/server';
import { query } from '@/lib/mysql';
import { requireAuth, dbErrorResponse, toNumber } from '@/lib/api-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/prosumer/overview   (PROSUMER only)
 * Everything the household dashboard needs in one round trip:
 *  - wallet balance
 *  - the caller's active meters with their grid node (incl. live tariff)
 *  - other users' active meters that can be chosen as a seller, with the
 *    tariff that would apply (the procedure prices at the SELLER node's tariff)
 */
export async function GET() {
  const auth = await requireAuth(['PROSUMER']);
  if (auth.error) return auth.error;
  const { user } = auth;

  try {
    const [wallets, meters, sellers] = await Promise.all([
      query('SELECT balance_inr FROM wallets WHERE user_id = ? LIMIT 1', [user.user_id]),
      query(
        `SELECT sm.meter_id, sm.installation_address, sm.node_id,
                gn.node_name, gn.location_zone, gn.max_capacity_kw,
                gn.current_load_kw, gn.current_tariff_per_kwh
           FROM smart_meters sm
           JOIN grid_nodes gn ON gn.node_id = sm.node_id
          WHERE sm.user_id = ? AND sm.is_active = TRUE
          ORDER BY sm.created_at, sm.meter_id`,
        [user.user_id]
      ),
      query(
        `SELECT sm.meter_id, sm.node_id, gn.node_name, gn.current_tariff_per_kwh
           FROM smart_meters sm
           JOIN grid_nodes gn ON gn.node_id = sm.node_id
          WHERE sm.user_id <> ? AND sm.is_active = TRUE
          ORDER BY gn.node_name, sm.meter_id
          LIMIT 200`,
        [user.user_id]
      ),
    ]);

    return NextResponse.json({
      wallet: { balance_inr: wallets.length ? toNumber(wallets[0].balance_inr) : null },
      meters: meters.map((m) => ({
        ...m,
        max_capacity_kw: toNumber(m.max_capacity_kw),
        current_load_kw: toNumber(m.current_load_kw),
        current_tariff_per_kwh: toNumber(m.current_tariff_per_kwh),
      })),
      sellers: sellers.map((s) => ({
        ...s,
        current_tariff_per_kwh: toNumber(s.current_tariff_per_kwh),
      })),
    });
  } catch (err) {
    return dbErrorResponse(err, 'GET /api/prosumer/overview');
  }
}
