/**
 * Mock smart-meter telemetry generator.
 *
 * Inserts one ping per meter every TELEMETRY_INTERVAL_MS (default 10 s) into
 * MongoDB `meter_telemetry`.
 *
 * Usage:
 *   node scripts/seed-telemetry.js            # run continuously (Ctrl+C to stop)
 *   node scripts/seed-telemetry.js --once     # insert a single batch and exit
 *
 * Requires: npm i mongodb dotenv
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(process.cwd(), '.env.local') });
require('dotenv').config(); // fallback to .env

const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const MONGODB_DB = process.env.MONGODB_DB || 'gridpulse_nosql';
const INTERVAL_MS = Number(process.env.TELEMETRY_INTERVAL_MS) || 10_000;
const RUN_ONCE = process.argv.includes('--once');

// Must match meters/nodes in seed.sql
const METERS = [
  { meter_id: 'MTR-IND-001', node_id: 1 },
  { meter_id: 'MTR-IND-002', node_id: 1 },
  { meter_id: 'MTR-KOR-003', node_id: 2 },
];

const rand = (min, max) => min + Math.random() * (max - min);
const round2 = (n) => Math.round(n * 100) / 100;

function buildPing({ meter_id, node_id }) {
  const voltage = rand(220, 240);
  const current = rand(5, 20);
  return {
    meter_id,
    node_id,
    timestamp: new Date(),
    metrics: {
      voltage_v: round2(voltage),
      current_a: round2(current),
      power_kw: round2((voltage * current) / 1000), // P = V·I (unity power factor)
      mode: Math.random() < 0.7 ? 'SURPLUS_EXPORT' : 'CONSUMING',
    },
  };
}

async function main() {
  const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  const collection = client.db(MONGODB_DB).collection('meter_telemetry');

  // Indexes for the dashboard's per-meter streams and hourly aggregations
  await collection.createIndex({ meter_id: 1, timestamp: -1 });
  await collection.createIndex({ node_id: 1, timestamp: -1 });

  console.log(`⚡ Telemetry generator connected to ${MONGODB_DB} (every ${INTERVAL_MS / 1000}s)`);

  let inFlight = false;
  const tick = async () => {
    if (inFlight) return; // skip if the previous insert is still running
    inFlight = true;
    try {
      const pings = METERS.map(buildPing);
      const res = await collection.insertMany(pings, { ordered: false });
      for (const p of pings) {
        console.log(
          `[${p.timestamp.toISOString()}] ${p.meter_id} ${p.metrics.power_kw} kW ${p.metrics.mode}`
        );
      }
      return res;
    } catch (err) {
      console.error('Insert failed:', err.message);
    } finally {
      inFlight = false;
    }
  };

  let timer = null;
  const shutdown = async (signal) => {
    console.log(`\n${signal} received, shutting down...`);
    if (timer) clearInterval(timer);
    try {
      await client.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  await tick();
  if (RUN_ONCE) {
    await client.close();
    return;
  }
  timer = setInterval(tick, INTERVAL_MS);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
