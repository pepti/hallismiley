import { getCSRFToken } from '../services/auth.js';

const BASE = '/api/v1/projects';

async function request(url, options = {}) {
  const headers = { 'Content-Type': 'application/json' };

  const res = await fetch(url, { headers, credentials: 'include', ...options });
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// Build headers that include the CSRF token for state-changing requests.
async function csrfHeaders() {
  const token = await getCSRFToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { 'X-CSRF-Token': token } : {}),
  };
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
  getMedia:    (id)       => request(`${BASE}/${id}/media`),
  async create(data) {
    return request(BASE, { method: 'POST', headers: await csrfHeaders(), body: JSON.stringify(data) });
  },
  async update(id, data) {
    return request(`${BASE}/${id}`, { method: 'PUT', headers: await csrfHeaders(), body: JSON.stringify(data) });
  },
  async patch(id, data) {
    return request(`${BASE}/${id}`, { method: 'PATCH', headers: await csrfHeaders(), body: JSON.stringify(data) });
  },
  async remove(id) {
    return request(`${BASE}/${id}`, { method: 'DELETE', headers: await csrfHeaders() });
  },

  // ── Media management ──────────────────────────────────────────────────────

  // Upload a file (FormData with key "file") or send JSON with file_path + media_type.
  async addMedia(projectId, payload) {
    const token = await getCSRFToken();
    const headers = token ? { 'X-CSRF-Token': token } : {};

    const isFormData = payload instanceof FormData;
    const res = await fetch(`${BASE}/${projectId}/media`, {
      method:      'POST',
      credentials: 'include',
      headers:     isFormData ? headers : { ...headers, 'Content-Type': 'application/json' },
      body:        isFormData ? payload : JSON.stringify(payload),
    });
    if (res.status === 204) return null;
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  },

  async updateMedia(projectId, mediaId, data) {
    const headers = await csrfHeaders();
    const res = await fetch(`${BASE}/${projectId}/media/${mediaId}`, {
      method: 'PATCH', credentials: 'include', headers, body: JSON.stringify(data),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    return body;
  },

  async deleteMedia(projectId, mediaId) {
    const headers = await csrfHeaders();
    const res = await fetch(`${BASE}/${projectId}/media/${mediaId}`, {
      method: 'DELETE', credentials: 'include', headers,
    });
    if (res.status === 204) return null;
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    return body;
  },

  async reorderMedia(projectId, order) {
    const headers = await csrfHeaders();
    const res = await fetch(`${BASE}/${projectId}/media/reorder`, {
      method: 'PATCH', credentials: 'include', headers, body: JSON.stringify({ order }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    return body;
  },

  async setCover(projectId, mediaId) {
    const headers = await csrfHeaders();
    const res = await fetch(`${BASE}/${projectId}/cover`, {
      method: 'PATCH', credentials: 'include', headers,
      body: JSON.stringify({ media_id: mediaId }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    return body;
  },
};
