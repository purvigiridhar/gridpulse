/** Browser-side fetch wrapper that normalises errors from our API routes. */

export class ApiError extends Error {
  constructor(message, { status = 0, details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details; // { field: message } on validation failures
  }
}

export async function apiFetch(url, { method = 'GET', body, signal } = {}) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
      cache: 'no-store',
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new ApiError('Network error. Check your connection and try again.');
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON body */
  }

  if (res.status === 401 && typeof window !== 'undefined') {
    // Session expired: send the user back to sign in.
    window.location.assign(`/login?callbackUrl=${encodeURIComponent(window.location.pathname)}`);
  }

  if (!res.ok) {
    throw new ApiError(data?.error || `Request failed (${res.status}).`, {
      status: res.status,
      details: data?.details,
    });
  }
  return data;
}
