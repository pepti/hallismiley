import { getToken } from '../services/auth.js';

const BASE = '/api/v1/projects';

async function request(url, options = {}) {
  const headers = { 'Content-Type': 'application/json' };

  // Attach Bearer token for write operations
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(url, { headers, credentials: 'include', ...options });
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export const projectApi = {
  getAll:      (params = {}) => {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([,v]) => v !== undefined))
    ).toString();
    return request(`${BASE}${qs ? '?' + qs : ''}`);
  },
  getFeatured: ()         => request(`${BASE}/featured`),
  getOne:      (id)       => request(`${BASE}/${id}`),
  create:      (data)     => request(BASE, { method: 'POST', body: JSON.stringify(data) }),
  update:      (id, data) => request(`${BASE}/${id}`, { method: 'PUT',   body: JSON.stringify(data) }),
  patch:       (id, data) => request(`${BASE}/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  remove:      (id)       => request(`${BASE}/${id}`, { method: 'DELETE' }),
};
