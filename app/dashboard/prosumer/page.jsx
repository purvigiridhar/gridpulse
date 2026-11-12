'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Wallet, Cpu, MapPin, TrendingUp, ArrowLeftRight, Activity, ReceiptText,
  Pause, Play, RefreshCw, ArrowDownLeft, ArrowUpRight, AlertTriangle, Zap,
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { apiFetch, ApiError } from '@/lib/client-api';
import { formatINR, formatNumber, formatDateTime, formatTime, BASE_TARIFF } from '@/lib/format';
import {
  Card, Badge, Skeleton, Spinner, ErrorBanner, SuccessBanner, FieldError,
  inputClass, primaryButtonClass,
} from '@/components/ui';

const UNITS_RE = /^\d{1,6}(\.\d{1,2})?$/;
const OVERVIEW_REFRESH_MS = 30_000;
const TELEMETRY_REFRESH_MS = 5_000;

/* ============================ Wallet & status ============================ */

function WalletStatusCard({ overview, loading, meter, onSelectMeter }) {
  if (loading) {
    return (
      <Card title="Wallet & Status" icon={Wallet}>
        <Skeleton className="h-10 w-48" />
        <Skeleton className="mt-6 h-4 w-full" />
        <Skeleton className="mt-3 h-4 w-2/3" />
      </Card>
    );
  }
  if (!overview) return null;

  const { wallet, meters } = overview;
  const surge = meter && meter.current_tariff_per_kwh > BASE_TARIFF;

  return (
    <Card title="Wallet & Status" icon={Wallet} action={<Badge tone="emerald">● Active</Badge>}>
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Wallet balance</p>
          <p className="mt-1 text-3xl font-bold tracking-tight text-slate-900">
            {wallet.balance_inr === null ? '—' : formatINR(wallet.balance_inr)}
          </p>
          {wallet.balance_inr === null && (
            <p className="mt-1 text-xs text-amber-700">No wallet found for this account. Contact an administrator.</p>
          )}
        </div>

        {meter ? (
          <dl className="space-y-3 text-sm">
            <div className="flex items-start gap-3">
              <Cpu className="mt-0.5 h-4 w-4 text-slate-400" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <dt className="text-xs text-slate-500">Smart meter</dt>
                <dd className="font-mono font-medium text-slate-900">
                  {meters.length > 1 ? (
                    <select
                      aria-label="Active meter" value={meter.meter_id}
                      onChange={(e) => onSelectMeter(e.target.value)}
                      className={`${inputClass} mt-1 py-1 font-mono`}
                    >
                      {meters.map((m) => <option key={m.meter_id} value={m.meter_id}>{m.meter_id}</option>)}
                    </select>
                  ) : meter.meter_id}
                </dd>
                <dd className="truncate text-xs text-slate-500">{meter.installation_address}</dd>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <MapPin className="mt-0.5 h-4 w-4 text-slate-400" aria-hidden="true" />
              <div>
                <dt className="text-xs text-slate-500">Grid node</dt>
                <dd className="font-medium text-slate-900">{meter.node_name}</dd>
                <dd className="text-xs text-slate-500">
                  {meter.location_zone} · {formatNumber(meter.max_capacity_kw, 0)} kW capacity
                </dd>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <TrendingUp className="mt-0.5 h-4 w-4 text-slate-400" aria-hidden="true" />
              <div>
                <dt className="text-xs text-slate-500">Node tariff</dt>
                <dd className="flex items-center gap-2 font-medium text-slate-900">
                  {formatINR(meter.current_tariff_per_kwh)}/kWh
                  {surge && <Badge tone="amber"><Zap className="h-3 w-3" />Surge</Badge>}
                </dd>
              </div>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-slate-500">No active smart meter is linked to your account.</p>
        )}
      </div>
    </Card>
  );
}

/* ============================== Trade form ============================== */

function TradeForm({ sellers, buyerMeterId, balance, loading, onSuccess }) {
  const [sellerId, setSellerId] = useState('');
  const [units, setUnits] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const seller = sellers.find((s) => s.meter_id === sellerId);
  const rate = seller ? Number(seller.current_tariff_per_kwh) : null;
  const unitsValid = UNITS_RE.test(units.trim()) && Number(units) > 0;
  const total = unitsValid && rate !== null ? Math.round(Number(units) * rate * 100) / 100 : null;
  const insufficient = total !== null && balance !== null && total > balance;
  const surge = rate !== null && rate > BASE_TARIFF;

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess(null);

    const errs = {};
    if (!sellerId) errs.seller_meter_id = 'Choose a seller meter.';
    if (!units.trim()) errs.units_kwh = 'Enter the units to buy.';
    else if (!UNITS_RE.test(units.trim())) errs.units_kwh = 'Use a positive number with up to 2 decimals (max 6 digits).';
    else if (Number(units) <= 0) errs.units_kwh = 'Units must be greater than zero.';
    setFieldErrors(errs);
    if (Object.keys(errs).length) return;
    if (insufficient) return;

    setSubmitting(true);
    try {
      const { trade } = await apiFetch('/api/trades', {
        method: 'POST',
        body: { seller_meter_id: sellerId, buyer_meter_id: buyerMeterId, units_kwh: units.trim() },
      });
      setSuccess(trade);
      setUnits('');
      onSuccess();
    } catch (err) {
      if (err instanceof ApiError && err.details) setFieldErrors(err.details);
      setError(err.message || 'Trade failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card title="P2P Energy Trading" icon={ArrowLeftRight}>
      {loading ? (
        <div className="space-y-4"><Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="h-16" /></div>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <ErrorBanner message={error} onDismiss={() => setError('')} />
          <SuccessBanner onDismiss={() => setSuccess(null)}>
            {success && (
              <>
                Trade <span className="font-mono font-semibold">#{success.trade_id}</span> completed: bought{' '}
                {formatNumber(success.units_kwh)} kWh from <span className="font-mono">{success.seller_meter_id}</span> at{' '}
                {formatINR(success.rate_per_kwh)}/kWh for <strong>{formatINR(success.total_amount)}</strong>.
              </>
            )}
          </SuccessBanner>

          <div>
            <label htmlFor="seller" className="mb-1.5 block text-sm font-medium text-slate-700">Seller meter</label>
            <select
              id="seller" value={sellerId} disabled={submitting || !sellers.length}
              onChange={(e) => { setSellerId(e.target.value); setFieldErrors((f) => ({ ...f, seller_meter_id: undefined })); }}
              aria-invalid={!!fieldErrors.seller_meter_id} className={inputClass}
            >
              <option value="">{sellers.length ? 'Select a neighbour’s meter…' : 'No sellers available'}</option>
              {sellers.map((s) => (
                <option key={s.meter_id} value={s.meter_id}>
                  {s.meter_id} · {s.node_name} · {formatINR(s.current_tariff_per_kwh)}/kWh
                </option>
              ))}
            </select>
            <FieldError message={fieldErrors.seller_meter_id} />
          </div>

          <div>
            <label htmlFor="units" className="mb-1.5 block text-sm font-medium text-slate-700">Units (kWh)</label>
            <input
              id="units" type="text" inputMode="decimal" placeholder="e.g. 5.50"
              value={units} disabled={submitting}
              onChange={(e) => { setUnits(e.target.value); setFieldErrors((f) => ({ ...f, units_kwh: undefined })); }}
              aria-invalid={!!fieldErrors.units_kwh} className={inputClass}
            />
            <FieldError message={fieldErrors.units_kwh} />
          </div>

          <div className="rounded-lg bg-slate-50 p-4 text-sm">
            <div className="flex items-center justify-between text-slate-600">
              <span>Rate (seller node)</span>
              <span className="flex items-center gap-2">
                {surge && <Badge tone="amber"><Zap className="h-3 w-3" />Surge</Badge>}
                {rate !== null ? `${formatINR(rate)}/kWh` : '—'}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-slate-200 pt-2">
              <span className="font-medium text-slate-900">Estimated total</span>
              <span className="text-lg font-bold text-slate-900">{total !== null ? formatINR(total) : '—'}</span>
            </div>
            {insufficient && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-red-600">
                <AlertTriangle className="h-3.5 w-3.5" /> Exceeds your wallet balance of {formatINR(balance)}.
              </p>
            )}
            <p className="mt-2 text-xs text-slate-500">The final price is locked at execution using the seller node’s live tariff.</p>
          </div>

          <button type="submit" disabled={submitting || !buyerMeterId || insufficient} className={`${primaryButtonClass} w-full`}>
            {submitting ? <Spinner /> : <ArrowLeftRight className="h-4 w-4" />}
            {submitting ? 'Executing trade…' : 'Buy energy'}
          </button>
        </form>
      )}
    </Card>
  );
}

/* ============================ Telemetry chart ============================ */

const SERIES = [
  { key: 'voltage_v', label: 'Voltage (V)', color: '#0ea5e9', axis: 'v' },
  { key: 'current_a', label: 'Current (A)', color: '#f59e0b', axis: 'a' },
  { key: 'power_kw', label: 'Power (kW)', color: '#10b981', axis: 'a' },
];

function TelemetryChart({ meterId }) {
  const [points, setPoints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [paused, setPaused] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [visible, setVisible] = useState({ voltage_v: true, current_a: true, power_kw: true });

  // Reset the chart only when the meter changes (not when pausing/resuming).
  useEffect(() => {
    setPoints([]);
    setLoading(true);
    setError('');
    setUpdatedAt(null);
  }, [meterId]);

  useEffect(() => {
    if (!meterId || paused) return undefined;

    let controller;
    const load = async () => {
      controller?.abort();
      controller = new AbortController();
      try {
        const res = await apiFetch(`/api/telemetry?meter_id=${encodeURIComponent(meterId)}&limit=30`, {
          signal: controller.signal,
        });
        setPoints(res.data.map((d) => ({ ...d, label: formatTime(d.timestamp) })));
        setUpdatedAt(new Date());
        setError('');
      } catch (err) {
        if (err.name !== 'AbortError') setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, TELEMETRY_REFRESH_MS);
    return () => { clearInterval(id); controller?.abort(); };
  }, [meterId, paused]);

  const latest = points[points.length - 1];

  return (
    <Card
      title="Live Sensor Telemetry" icon={Activity}
      action={
        <div className="flex items-center gap-3">
          {updatedAt && !paused && !error && (
            <span className="hidden items-center gap-1.5 text-xs text-slate-500 sm:flex">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" /> Live · {formatTime(updatedAt)}
            </span>
          )}
          <button
            type="button" onClick={() => setPaused((p) => !p)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            {paused ? 'Resume' : 'Pause'}
          </button>
        </div>
      }
    >
      {!meterId ? (
        <p className="py-10 text-center text-sm text-slate-500">No meter selected.</p>
      ) : (
        <div className="space-y-4">
          <ErrorBanner message={error} />

          <div className="flex flex-wrap gap-2">
            {SERIES.map((s) => (
              <button
                key={s.key} type="button" aria-pressed={visible[s.key]}
                onClick={() => setVisible((v) => ({ ...v, [s.key]: !v[s.key] }))}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition ${
                  visible[s.key] ? 'border-slate-300 bg-white text-slate-800' : 'border-slate-200 bg-slate-50 text-slate-400'
                }`}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: visible[s.key] ? s.color : '#cbd5e1' }} />
                {s.label}
              </button>
            ))}
          </div>

          {loading ? (
            <Skeleton className="h-72 w-full" />
          ) : points.length === 0 ? (
            <div className="flex h-72 flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 text-center text-sm text-slate-500">
              <Activity className="mb-2 h-6 w-6 text-slate-300" />
              No telemetry yet for <span className="font-mono">{meterId}</span>.
              <span className="mt-1 text-xs">Start the generator: node scripts/seed-telemetry.js</span>
            </div>
          ) : (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} minTickGap={32} />
                  <YAxis yAxisId="v" domain={['auto', 'auto']} tick={{ fontSize: 11, fill: '#0ea5e9' }} width={44} />
                  <YAxis yAxisId="a" orientation="right" domain={[0, 'auto']} tick={{ fontSize: 11, fill: '#64748b' }} width={36} />
                  <Tooltip
                    contentStyle={{ borderRadius: 8, borderColor: '#e2e8f0', fontSize: 12 }}
                    formatter={(value, name) => [value, name]}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {SERIES.filter((s) => visible[s.key]).map((s) => (
                    <Line
                      key={s.key} yAxisId={s.axis} type="monotone" dataKey={s.key} name={s.label}
                      stroke={s.color} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {latest && (
            <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
              {[
                ['Voltage', `${formatNumber(latest.voltage_v)} V`],
                ['Current', `${formatNumber(latest.current_a)} A`],
                ['Power', `${formatNumber(latest.power_kw)} kW`],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg bg-slate-50 px-3 py-2">
                  <p className="text-xs text-slate-500">{k}</p>
                  <p className="text-sm font-semibold text-slate-900">{v}</p>
                </div>
              ))}
              <div className="rounded-lg bg-slate-50 px-3 py-2">
                <p className="text-xs text-slate-500">Mode</p>
                <Badge tone={latest.mode === 'SURPLUS_EXPORT' ? 'emerald' : 'sky'}>
                  {latest.mode === 'SURPLUS_EXPORT' ? 'Exporting' : 'Consuming'}
                </Badge>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/* ============================== Trade ledger ============================== */

const FILTERS = [
  { id: 'ALL', label: 'All' },
  { id: 'BOUGHT', label: 'Bought' },
  { id: 'SOLD', label: 'Sold' },
];

function TradeLedger({ trades, loading, error, onRetry }) {
  const [filter, setFilter] = useState('ALL');

  const counts = useMemo(() => ({
    ALL: trades.length,
    BOUGHT: trades.filter((t) => t.direction === 'BOUGHT').length,
    SOLD: trades.filter((t) => t.direction === 'SOLD').length,
  }), [trades]);

  const net = useMemo(() => trades
    .filter((t) => t.trade_status === 'COMPLETED')
    .reduce((s, t) => s + (t.direction === 'SOLD' ? t.total_amount : -t.total_amount), 0), [trades]);

  const rows = filter === 'ALL' ? trades : trades.filter((t) => t.direction === filter);

  return (
    <Card
      title="Trade Ledger" icon={ReceiptText}
      action={
        <div className="flex items-center gap-3">
          {!loading && trades.length > 0 && (
            <span className={`hidden text-xs font-medium sm:inline ${net >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
              Net: {net >= 0 ? '+' : '−'}{formatINR(Math.abs(net))}
            </span>
          )}
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5" role="group" aria-label="Filter trades">
            {FILTERS.map((f) => (
              <button
                key={f.id} type="button" onClick={() => setFilter(f.id)} aria-pressed={filter === f.id}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                  filter === f.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {f.label} <span className="text-slate-400">{counts[f.id]}</span>
              </button>
            ))}
          </div>
        </div>
      }
    >
      <ErrorBanner message={error} onRetry={onRetry} />
      {loading ? (
        <div className="space-y-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-9" />)}</div>
      ) : rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-500">
          {trades.length === 0 ? 'No trades yet. Buy some energy to get started.' : `No ${filter.toLowerCase()} trades.`}
        </p>
      ) : (
        <div className="-mx-5 overflow-x-auto px-5">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-4 font-medium">Date</th>
                <th className="py-2 pr-4 font-medium">Type</th>
                <th className="py-2 pr-4 font-medium">Counterparty</th>
                <th className="py-2 pr-4 text-right font-medium">kWh</th>
                <th className="py-2 pr-4 text-right font-medium">Rate</th>
                <th className="py-2 pr-4 text-right font-medium">Amount</th>
                <th className="py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((t) => {
                const sold = t.direction === 'SOLD';
                return (
                  <tr key={t.trade_id} className="hover:bg-slate-50">
                    <td className="whitespace-nowrap py-2.5 pr-4 text-slate-600">{formatDateTime(t.traded_at)}</td>
                    <td className="py-2.5 pr-4">
                      <Badge tone={sold ? 'emerald' : 'sky'}>
                        {sold ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownLeft className="h-3 w-3" />}
                        {t.direction}
                      </Badge>
                    </td>
                    <td className="py-2.5 pr-4 font-mono text-xs text-slate-700">{sold ? t.buyer_meter_id : t.seller_meter_id}</td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">{formatNumber(t.units_kwh)}</td>
                    <td className="py-2.5 pr-4 text-right tabular-nums">{formatINR(t.rate_per_kwh)}</td>
                    <td className={`py-2.5 pr-4 text-right font-medium tabular-nums ${sold ? 'text-emerald-700' : 'text-slate-900'}`}>
                      {sold ? '+' : '−'}{formatINR(t.total_amount)}
                    </td>
                    <td className="py-2.5">
                      <Badge tone={t.trade_status === 'COMPLETED' ? 'emerald' : t.trade_status === 'PENDING' ? 'amber' : 'red'}>
                        {t.trade_status}
                      </Badge>
                    </td>
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

export default function ProsumerDashboardPage() {
  const [overview, setOverview] = useState(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState('');
  const [activeMeterId, setActiveMeterId] = useState(null);

  const [trades, setTrades] = useState([]);
  const [tradesLoading, setTradesLoading] = useState(true);
  const [tradesError, setTradesError] = useState('');

  const loadOverview = useCallback(async () => {
    try {
      const data = await apiFetch('/api/prosumer/overview');
      setOverview(data);
      setActiveMeterId((prev) => prev ?? data.meters[0]?.meter_id ?? null);
      setOverviewError('');
    } catch (err) {
      setOverviewError(err.message);
    } finally {
      setOverviewLoading(false);
    }
  }, []);

  const loadTrades = useCallback(async () => {
    try {
      const data = await apiFetch('/api/trades?limit=50');
      setTrades(data.trades);
      setTradesError('');
    } catch (err) {
      setTradesError(err.message);
    } finally {
      setTradesLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOverview();
    loadTrades();
    const id = setInterval(() => { if (!document.hidden) loadOverview(); }, OVERVIEW_REFRESH_MS);
    return () => clearInterval(id);
  }, [loadOverview, loadTrades]);

  const meter = overview?.meters.find((m) => m.meter_id === activeMeterId) ?? overview?.meters[0] ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">My Energy</h1>
          <p className="text-sm text-slate-500">Your wallet, live meter readings and peer-to-peer trades.</p>
        </div>
        <button
          type="button" onClick={() => { loadOverview(); loadTrades(); }}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" /> Refresh
        </button>
      </div>

      <ErrorBanner message={overviewError} onRetry={loadOverview} />

      <WalletStatusCard overview={overview} loading={overviewLoading} meter={meter} onSelectMeter={setActiveMeterId} />

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <TradeForm
            sellers={overview?.sellers ?? []}
            buyerMeterId={meter?.meter_id ?? null}
            balance={overview?.wallet.balance_inr ?? null}
            loading={overviewLoading}
            onSuccess={() => { loadOverview(); loadTrades(); }}
          />
        </div>
        <div className="lg:col-span-3">
          <TelemetryChart meterId={meter?.meter_id ?? null} />
        </div>
      </div>

      <TradeLedger trades={trades} loading={tradesLoading} error={tradesError} onRetry={loadTrades} />
    </div>
  );
}
