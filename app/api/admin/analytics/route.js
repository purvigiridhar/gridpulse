import { NextResponse } from 'next/server';
import { query } from '@/lib/mysql';
import { requireAuth, dbErrorResponse, toNumber, round2 } from '@/lib/api-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/admin/analytics - weekly totals per node from vw_weekly_grid_analytics (ADMIN only). */
export async function GET() {
  const auth = await requireAuth(['ADMIN']);
  if (auth.error) return auth.error;

  try {
    const rows = await query(
      `SELECT v.node_id, v.node_name, v.total_trades, v.total_kwh_traded,
              v.total_revenue_inr, v.avg_trade_rate,
              gn.location_zone, gn.max_capacity_kw, gn.current_tariff_per_kwh,
              (SELECT s.load_percentage
                 FROM node_load_snapshots s
                WHERE s.node_id = v.node_id
                ORDER BY s.recorded_at DESC, s.snapshot_id DESC
                LIMIT 1) AS latest_load_percentage
         FROM vw_weekly_grid_analytics v
         JOIN grid_nodes gn ON gn.node_id = v.node_id
        ORDER BY v.node_name`
    );

    const nodes = rows.map((r) => ({
      node_id: r.node_id,
      node_name: r.node_name,
      location_zone: r.location_zone,
      max_capacity_kw: toNumber(r.max_capacity_kw),
      current_tariff_per_kwh: toNumber(r.current_tariff_per_kwh),
      total_trades: Number(r.total_trades),
      total_kwh_traded: toNumber(r.total_kwh_traded),
      total_revenue_inr: toNumber(r.total_revenue_inr),
      avg_trade_rate: round2(toNumber(r.avg_trade_rate)),
      latest_load_percentage: toNumber(r.latest_load_percentage),
    }));

    const totals = nodes.reduce(
      (t, n) => ({
        total_trades: t.total_trades + n.total_trades,
        total_kwh_traded: round2(t.total_kwh_traded + n.total_kwh_traded),
        total_revenue_inr: round2(t.total_revenue_inr + n.total_revenue_inr),
      }),
      { total_trades: 0, total_kwh_traded: 0, total_revenue_inr: 0 }
    );

    return NextResponse.json({ period: 'last_7_days', generated_at: new Date(), totals, nodes });
  } catch (err) {
    return dbErrorResponse(err, 'GET /api/admin/analytics');
  }
}
