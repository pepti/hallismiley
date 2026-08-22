// Admin read surface for the server-side event log (Admin → Monitoring).
// Read-only, so no CSRF header is needed — see server/routes/adminEventRoutes.js.

export async function fetchEvents({ source, level, q, limit = 50, offset = 0 } = {}) {
  const params = new URLSearchParams();
  if (source) params.set('source', source);
  if (level)  params.set('level', level);
  if (q)      params.set('q', q);
  params.set('limit', String(limit));
  params.set('offset', String(offset));

  const res  = await fetch(`/api/v1/admin/events?${params}`, { credentials: 'include' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to load the event log');
  return data;   // { events, total, limit, offset }
}
