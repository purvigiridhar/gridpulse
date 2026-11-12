import { NextResponse } from 'next/server';
import { query } from '@/lib/mysql';
import { getTelemetryCollection } from '@/lib/mongodb';
import {
  requireAuth, jsonError, dbErrorResponse,
  parseMeterId, parseIntParam, round2,
} from '@/lib/api-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function mongoErrorResponse(err, label) {
  console.error(`[api] ${label}:`, err);
  if (err?.name === 'MongoServerSelectionError' || err?.name === 'MongoNetworkError') {
    return jsonError(503, 'Telemetry store temporarily unavailable.');
  }
  return jsonError(500, 'Internal server error.');
}

/**
 * GET /api/telemetry?meter_id=MTR-IND-001&limit=20   -> latest N pings, oldest first (line charts)
 * GET /api/telemetry?node_id=1[&window_minutes=60]   -> aggregated node stats over a time window
 *
 * PROSUMER: only their own meters, and only nodes they have a meter on
 *           (node responses omit the per-meter breakdown for privacy).
 * ADMIN: anything.
 */
export async function GET(request) {
  const auth = await requireAuth();
  if (auth.error) return auth.error;
  const { user } = auth;
  const isAdmin = user.user_role === 'ADMIN';

  const sp = request.nextUrl.searchParams;
  const meterRaw = sp.get('meter_id');
  const nodeRaw = sp.get('node_id');

  if (meterRaw && nodeRaw) return jsonError(400, 'Provide either meter_id or node_id, not both.');
  if (!meterRaw && !nodeRaw) return jsonError(400, 'meter_id or node_id query parameter is required.');

  /* ---------------- per-meter time series ---------------- */
  if (meterRaw) {
    const meter = parseMeterId(meterRaw, 'meter_id');
    if (meter.error) return jsonError(400, meter.error);
    const limit = parseIntParam(sp.get('limit'), { name: 'limit', min: 1, max: 200, fallback: 20 });
    if (limit.error) return jsonError(400, limit.error);

    try {
      if (!isAdmin) {
        const owned = await query(
          'SELECT 1 FROM smart_meters WHERE meter_id = ? AND user_id = ? LIMIT 1',
          [meter.value, user.user_id]
        );
        if (!owned.length) return jsonError(403, 'You can only view telemetry for your own meters.');
      }
    } catch (err) {
      return dbErrorResponse(err, 'GET /api/telemetry (ownership)');
    }

    try {
      const col = await getTelemetryCollection();
      const docs = await col
        .find({ meter_id: meter.value }, { projection: { _id: 0, node_id: 1, timestamp: 1, metrics: 1 } })
        .sort({ timestamp: -1 })
        .limit(limit.value)
        .toArray();

      const data = docs.reverse().map((d) => ({
        timestamp: d.timestamp,
        voltage_v: d.metrics?.voltage_v ?? null,
        current_a: d.metrics?.current_a ?? null,
        power_kw: d.metrics?.power_kw ?? null,
        mode: d.metrics?.mode ?? null,
      }));
      return NextResponse.json({ meter_id: meter.value, count: data.length, data });
    } catch (err) {
      return mongoErrorResponse(err, 'GET /api/telemetry (meter)');
    }
  }

  /* ---------------- node aggregation ---------------- */
  const node = parseIntParam(nodeRaw, { name: 'node_id' });
  if (node.error) return jsonError(400, node.error);
  const windowMin = parseIntParam(sp.get('window_minutes'), {
    name: 'window_minutes', min: 1, max: 1440, fallback: 60,
  });
  if (windowMin.error) return jsonError(400, windowMin.error);

  try {
    if (!isAdmin) {
      const onNode = await query(
        'SELECT 1 FROM smart_meters WHERE user_id = ? AND node_id = ? LIMIT 1',
        [user.user_id, node.value]
      );
      if (!onNode.length) return jsonError(403, 'You can only view aggregates for your own node.');
    }
  } catch (err) {
    return dbErrorResponse(err, 'GET /api/telemetry (node access)');
  }

  try {
    const since = new Date(Date.now() - windowMin.value * 60_000);
    const col = await getTelemetryCollection();
    const groups = await col
      .aggregate([
        { $match: { node_id: node.value, timestamp: { $gte: since } } },
        {
          $group: {
            _id: '$meter_id',
            pings: { $sum: 1 },
            avg_power_kw: { $avg: '$metrics.power_kw' },
            max_power_kw: { $max: '$metrics.power_kw' },
            last_seen: { $max: '$timestamp' },
            export_pings: { $sum: { $cond: [{ $eq: ['$metrics.mode', 'SURPLUS_EXPORT'] }, 1, 0] } },
            consuming_pings: { $sum: { $cond: [{ $eq: ['$metrics.mode', 'CONSUMING'] }, 1, 0] } },
          },
        },
        { $sort: { _id: 1 } },
      ])
      .toArray();

    const totalPings = groups.reduce((s, g) => s + g.pings, 0);
    const weightedPower = groups.reduce((s, g) => s + g.avg_power_kw * g.pings, 0);

    const summary = {
      node_id: node.value,
      window_minutes: windowMin.value,
      since,
      active_meters: groups.length,
      total_pings: totalPings,
      avg_power_kw: totalPings ? round2(weightedPower / totalPings) : 0,
      max_power_kw: groups.length ? Math.max(...groups.map((g) => g.max_power_kw)) : 0,
      export_pings: groups.reduce((s, g) => s + g.export_pings, 0),
      consuming_pings: groups.reduce((s, g) => s + g.consuming_pings, 0),
    };

    if (!isAdmin) return NextResponse.json({ summary });

    const meters = groups.map((g) => ({
      meter_id: g._id,
      pings: g.pings,
      avg_power_kw: round2(g.avg_power_kw),
      max_power_kw: g.max_power_kw,
      export_pings: g.export_pings,
      consuming_pings: g.consuming_pings,
      last_seen: g.last_seen,
    }));
    return NextResponse.json({ summary, meters });
  } catch (err) {
    return mongoErrorResponse(err, 'GET /api/telemetry (node)');
  }
}
