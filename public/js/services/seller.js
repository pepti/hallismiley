// Seller area API client (D-020). GET only — the area is read-only by
// construction; there is nothing to send and so no CSRF header to fetch.
const BASE = '/api/v1/seller';

export class SellerApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function getJSON(path) {
  const res = await fetch(`${BASE}${path}`, { credentials: 'include' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new SellerApiError(data.error || `HTTP ${res.status}`, res.status);
  return data;
}

// { seller: { email, display_name, can_leads, can_accounts, can_commission }, mfa_ready, published_at }
export const fetchSellerMe = () => getJSON('/me');
export const fetchSellerLeads = () => getJSON('/leads');
export const fetchSellerAccounts = () => getJSON('/accounts');
export const fetchSellerStatements = () => getJSON('/statements');
export const fetchSellerStatement = (id) => getJSON(`/statements/${encodeURIComponent(id)}`);
