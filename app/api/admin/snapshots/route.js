import { NextResponse } from 'next/server';
import { withTransaction } from '@/lib/mysql';
import {
  requireAuth, readJsonBody, jsonError, dbErrorResponse,
  parseIntParam, parseDecimal, toNumber,
} from '@/lib/api-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/snapshots  { node_id, load_percentage }   (ADMIN only)
 * Inserts into node_load_snapshots; trg_dynamic_surge_pricing then adjusts
 * grid_nodes.current_tariff_per_kwh inside the same transaction. The response
 * reports the tariff before/after so the effect of the snapshot is visible.
 */
export async function POST(request) {
  const auth = await requireAuth(['ADMIN']);
  if (auth.error) return auth.error;

  const parsed = await readJsonBody(request);
  if (parsed.error) return parsed.error;
  const { body } = parsed;

  const node = parseIntParam(body.node_id, { name: 'node_id' });
  const load = parseDecimal(body.load_percentage, {
    name: 'load_percentage', intDigits: 3, scale: 2, max: 100,
  });

  const details = {};
  if (node.error) details.node_id = node.error;
  if (load.error) details.load_percentage = load.error;
  if (Object.keys(details).length) return jsonError(400, 'Validation failed.', details);

  try {
    const result = await withTransaction(async (conn) => {
      // Lock the node row so before/after tariffs are consistent under concurrency.
      const [before] = await conn.execute(
        'SELECT current_tariff_per_kwh FROM grid_nodes WHERE node_id = ? FOR UPDATE',
        [node.value]
      );
      if (!before.length) return null;

      const [ins] = await conn.execute(
        'INSERT INTO node_load_snapshots (node_id, load_percentage) VALUES (?, ?)',
        [node.value, load.value]
      );

      const [after] = await conn.execute(
        'SELECT current_tariff_per_kwh FROM grid_nodes WHERE node_id = ?',
        [node.value]
      );

      return {
        snapshot_id: ins.insertId,
        tariff_before: toNumber(before[0].current_tariff_per_kwh),
        tariff_after: toNumber(after[0].current_tariff_per_kwh),
      };
    });

    if (!result) return jsonError(404, `Grid node ${node.value} not found.`);

    return NextResponse.json(
      {
        snapshot: {
          snapshot_id: result.snapshot_id,
          node_id: node.value,
          load_percentage: load.number,
        },
        tariff: {
          before: result.tariff_before,
          after: result.tariff_after,
          changed: result.tariff_before !== result.tariff_after,
        },
      },
      { status: 201 }
    );
  } catch (err) {
    return dbErrorResponse(err, 'POST /api/admin/snapshots');
  }
}
