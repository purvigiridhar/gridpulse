import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || 'gridpulse_nosql';

if (!uri) {
  throw new Error('Missing required env var: MONGODB_URI');
}

const options = {
  maxPoolSize: 20,
  serverSelectionTimeoutMS: 5000,
  retryWrites: true,
};

/**
 * Lazily create ONE MongoClient and cache the connection promise on
 * `globalThis`, so Next.js dev hot-reloads and warm serverless invocations
 * reuse it. Nothing connects at import time, and a failed attempt is cleared
 * so the next request retries instead of reusing a rejected promise.
 */
const globalForMongo = globalThis;

/** @returns {Promise<MongoClient>} */
export function getMongoClient() {
  if (!globalForMongo.__gridpulseMongoPromise) {
    const promise = new MongoClient(uri, options).connect().catch((err) => {
      globalForMongo.__gridpulseMongoPromise = undefined;
      console.error('[mongodb] connection failed:', err.message);
      throw err;
    });
    globalForMongo.__gridpulseMongoPromise = promise;
  }
  return globalForMongo.__gridpulseMongoPromise;
}

/** @returns {Promise<import('mongodb').Db>} */
export async function getDb() {
  const client = await getMongoClient();
  return client.db(dbName);
}

/** @returns {Promise<import('mongodb').Collection>} telemetry collection */
export async function getTelemetryCollection() {
  return (await getDb()).collection('meter_telemetry');
}

export default getMongoClient;
