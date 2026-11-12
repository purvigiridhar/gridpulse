export const BASE_TARIFF = 5; // INR/kWh; matches the base rate in trg_dynamic_surge_pricing
export const SURGE_THRESHOLD = 80;
export const RESET_THRESHOLD = 50;

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });
const num = (n) => (n === null || n === undefined || Number.isNaN(Number(n)) ? null : Number(n));

export const formatINR = (n) => (num(n) === null ? '—' : inr.format(num(n)));
export const formatNumber = (n, digits = 2) =>
  num(n) === null ? '—' : num(n).toLocaleString('en-IN', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
export const formatDateTime = (v) =>
  new Date(v).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
export const formatTime = (v) => new Date(v).toLocaleTimeString('en-IN', { hour12: false });
