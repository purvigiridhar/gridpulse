'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Repeat, BatteryCharging, IndianRupee, Zap, Gauge, Server, RefreshCw, ArrowRight, TrendingUp,
} from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/client-api';
import { formatINR, formatNumber, BASE_TARIFF, SURGE_THRESHOLD, RESET_THRESHOLD } from '@/lib/format';
import {
  Card, StatCard, Badge, Skeleton, Spinner, ErrorBanner, FieldError,
  inputClass, primaryButtonClass,
} from '@/components/ui';

const REFRESH_MS = 30_000;
const LOAD_RE = /^\d{1,3}(\.\d{1,2})?$/;

const zoneOf = (pct) => (pct >= SURGE_THRESHOLD ? 'surge' : pct < RESET_THRESHOLD ? 'normal' : 'hold');
const ZONE_BAR = { surge: 'bg-red-500', hold: 'bg-amber-400', normal: 'bg-emerald-500' };

function describeOutcome(load, before, after) {
  const changed = before !== after;
  if (load >= SURGE_THRESHOLD) {
    return changed
      ? { tone: 'amber', text: 'Surge pricing activated: load crossed 80%.' }
      : { tone: 'amber', text: 'Surge tariff was already active; no further change.' };
  }
  if (load < RESET_THRESHOLD) {
    return changed
      ? { tone: 'emerald', text: 'Load fell below 50%: tariff reset to the base rate.' }
      : { tone: 'emerald', text: 'Tariff already at the base rate.' };
  }
  return { tone: 'slate', text: 'Load is in the 50–80% hold band: tariff left unchanged.' };
}

/* ============================ Surge simulator ============================ */

function SurgeSimulator({ nodes, loading, onApplied }) {
  const [nodeId, setNodeId] = useState('');
  const [load, setLoad] = useState('65');
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!nodeId && nodes.length) setNodeId(String(nodes[0].node_id));
  }, [nodes, nodeId]);

  const loadNum = LOAD_RE.test(load.trim()) && Number(load) <= 100 ? Number(load) : null;
  const zone = loadNum === null ? null : zoneOf(loadNum);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setResult(null);

    const errs = {};
    if (!nodeId) errs.node_id = 'Select a grid node.';
    if (!load.trim()) errs.load_percentage = 'Enter a load percentage.';
    else if (!LOAD_RE.test(load.trim())) errs.load_percentage = 'Use a number with up to 2 decimals.';
    else if (Number(load) > 100) errs.load_percentage = 'Load cannot exceed 100%.';
    setFieldErrors(errs);
    if (Object.keys(errs).length) return;

    setSubmitting(true);
    try {
      const res = await apiFetch('/api/admin/snapshots', {
        method: 'POST',
        body: { node_id: Number(nodeId), load_percentage: load.trim() },
      });
      const node = nodes.find((n) => String(n.node_id) === nodeId);
      setResult({ ...res, node_name: node?.node_name });
      onApplied();
    } catch (err) {
      if (err instanceof ApiError && err.details) setFieldErrors(err.details);
      setError(err.message || 'Could not record snapshot.');
    } finally {
      setSubmitting(false);
    }
  }

  const outcome = result ? describeOutcome(result.snapshot.load_percentage, result.tariff.before, result.tariff.after) : null;

  return (
    <Card title="Surge Pricing Simulator" icon={Zap}>
      {loading ? (
        <div className="space-y-4"><Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <ErrorBanner message={error} onDismiss={() => setError('')} />

          <div>
            <label htmlFor="node" className="mb-1.5 block text-sm font-medium text-slate-700">Grid node</label>
            <select
              id="node" value={nodeId} disabled={submitting || !nodes.length}
              onChange={(e) => { setNodeId(e.target.value); setResult(null); }}
              className={inputClass} aria-invalid={!!fieldErrors.node_id}
            >
              {nodes.map((n) => <option key={n.node_id} value={n.node_id}>{n.node_name}</option>)}
            </select>
            <FieldError message={fieldErrors.node_id} />
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label htmlFor="load" className="text-sm font-medium text-slate-700">Load percentage</label>
              {zone && (
                <Badge tone={zone === 'surge' ? 'red' : zone === 'hold' ? 'amber' : 'emerald'}>
                  {zone === 'surge' ? 'Surge zone' : zone === 'hold' ? 'Hold band' : 'Normal'}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-3">
              <input
                type="range" min="0" max="100" step="1" aria-label="Load slider"
                value={loadNum ?? 0} disabled={submitting}
                onChange={(e) => setLoad(e.target.value)}
                className="h-2 flex-1 cursor-pointer accent-emerald-600"
              />
              <div className="relative w-24">
                <input
                  id="load" type="text" inputMode="decimal" value={load} disabled={submitting}
                  onChange={(e) => { setLoad(e.target.value); setFieldErrors((f) => ({ ...f, load_percentage: undefined })); }}
                  aria-invalid={!!fieldErrors.load_percentage} className={`${inputClass} pr-7 text-right`}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">%</span>
              </div>
            </div>
            <div className="mt-2 flex gap-2">
              {[30, 65, 85, 95].map((p) => (
                <button key={p} type="button" onClick={() => setLoad(String(p))} disabled={submitting}
                  className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">
                  {p}%
                </button>
              ))}
            </div>
            <FieldError message={fieldErrors.load_percentage} />
            <p className="mt-2 text-xs text-slate-500">
              ≥ {SURGE_THRESHOLD}% applies a 1.25× surge ({formatINR(BASE_TARIFF * 1.25)}/kWh) · below {RESET_THRESHOLD}% resets to {formatINR(BASE_TARIFF)}/kWh · in between leaves it unchanged.
            </p>
          </div>

          <button type="submit" disabled={submitting || !nodes.length} className={`${primaryButtonClass} w-full`}>
            {submitting ? <Spinner /> : <Gauge className="h-4 w-4" />}
            {submitting ? 'Recording snapshot…' : 'Record load snapshot'}
          </button>

          {result && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4" role="status">
              <p className="text-xs text-slate-500">
                Snapshot #{result.snapshot.snapshot_id} · {result.node_name} · {formatNumber(result.snapshot.load_percentage)}% load
              </p>
              <div className="mt-2 flex items-center gap-3 text-lg font-bold text-slate-900">
                <span>{formatINR(result.tariff.before)}</span>
                <ArrowRight className="h-4 w-4 text-slate-400" aria-hidden="true" />
                <span className={result.tariff.after > result.tariff.before ? 'text-red-600' : result.tariff.after < result.tariff.before ? 'text-emerald-600' : ''}>
                  {formatINR(result.tariff.after)}
                </span>
                <span className="text-xs font-normal text-slate-500">per kWh</span>
              </div>
              <p className="mt-2"><Badge tone={outcome.tone}>{outcome.text}</Badge></p>
            </div>
          )}
        </form>
      )}
    </Card>
  );
}

/* ============================ Node performance ============================ */

function LoadBar({ pct, maxKw }) {
  if (pct === null || pct === undefined) return <span className="text-xs text-slate-400">No snapshot</span>;
  const z = zoneOf(pct);
  return (
    <div className="min-w-[8rem]">
      <div className="flex justify-between text-xs text-slate-600">
        <span>{formatNumber(pct, 1)}%</span>
        <span className="text-slate-400">{formatNumber((pct / 100) * maxKw, 1)} kW</span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${ZONE_BAR[z]}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
    </div>
  );
}

function NodeTable({ nodes, loading }) {
  return (
    <Card title="Grid Node Performance" icon={Server}>
      {loading ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>
      ) : nodes.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">No grid nodes found.</p>
      ) : (
        <div className="-mx-5 overflow-x-auto px-5">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-4 font-medium">Node</th>
                <th className="py-2 pr-4 font-medium">Load (latest)</th>
                <th className="py-2 pr-4 text-right font-medium">Capacity</th>
                <th className="py-2 pr-4 text-right font-medium">Tariff</th>
                <th className="py-2 pr-4 text-right font-medium">Trades</th>
                <th className="py-2 pr-4 text-right font-medium">kWh</th>
                <th className="py-2 text-right font-medium">Revenue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {nodes.map((n) => {
                const surge = n.current_tariff_per_kwh > BASE_TARIFF;
                return (
                  <tr key={n.node_id} className="hover:bg-slate-50">
                    <td className="py-3 pr-4">
                      <p className="font-medium text-slate-900">{n.node_name}</p>
                      <p className="text-xs text-slate-500">{n.location_zone}</p>
                    </td>
                    <td className="py-3 pr-4"><LoadBar pct={n.latest_load_percentage} maxKw={n.max_capacity_kw} /></td>
                    <td className="py-3 pr-4 text-right tabular-nums">{formatNumber(n.max_capacity_kw, 0)} kW</td>
                    <td className="whitespace-nowrap py-3 pr-4 text-right">
                      <span className="tabular-nums font-medium">{formatINR(n.current_tariff_per_kwh)}</span>
                      {surge && <Badge tone="red" className="ml-2"><Zap className="h-3 w-3" />Surge</Badge>}
                    </td>
                    <td className="py-3 pr-4 text-right tabular-nums">{n.total_trades}</td>
                    <td className="py-3 pr-4 text-right tabular-nums">{formatNumber(n.total_kwh_traded)}</td>
                    <td className="py-3 text-right font-medium tabular-nums">{formatINR(n.total_revenue_inr)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/* ================================== Page ================================== */

export default function AdminDashboardPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      setData(await apiFetch('/api/admin/analytics'));
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const nodes = data?.nodes ?? [];
  const totals = data?.totals;
  const surgeNodes = nodes.filter((n) => n.current_tariff_per_kwh > BASE_TARIFF).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Grid Control</h1>
          <p className="text-sm text-slate-500">Weekly trading performance and dynamic tariff controls.</p>
        </div>
        <button
          type="button" onClick={() => load(true)} disabled={refreshing}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" /> Refresh
        </button>
      </div>

      <ErrorBanner message={error} onRetry={() => load(true)} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Grid trades" icon={Repeat} loading={loading} value={totals ? formatNumber(totals.total_trades, 0) : '—'} hint="Last 7 days" />
        <StatCard label="Energy exchanged" icon={BatteryCharging} loading={loading} value={totals ? `${formatNumber(totals.total_kwh_traded)} kWh` : '—'} hint="Last 7 days" />
        <StatCard label="Gross revenue" icon={IndianRupee} loading={loading} value={totals ? formatINR(totals.total_revenue_inr) : '—'} hint="Completed trades, last 7 days" />
        <StatCard label="Nodes in surge" icon={TrendingUp} loading={loading} value={data ? `${surgeNodes} / ${nodes.length}` : '—'} hint="Tariff above base rate" />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <SurgeSimulator nodes={nodes} loading={loading && !data} onApplied={() => load()} />
        </div>
        <div className="lg:col-span-3">
          <NodeTable nodes={nodes} loading={loading} />
        </div>
      </div>
    </div>
  );
}
