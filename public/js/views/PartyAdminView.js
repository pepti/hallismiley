import { isAuthenticated, isAdmin } from '../services/auth.js';
import { escHtml }      from '../utils/escHtml.js';

export class PartyAdminView {
  constructor() {
    this._el = null;
  }

  async render() {
    const el = document.createElement('div');
    el.className = 'view party-admin-view';
    this._el = el;

    if (!isAuthenticated() || !isAdmin()) {
      el.innerHTML = '<div class="party-error"><p>Admin access required.</p></div>';
      return el;
    }

    el.innerHTML = '<div class="party-admin-loading">Loading…</div>';

    try {
      await this._loadAndRender();
    } catch (err) {
      el.innerHTML = `<div class="party-error"><p>Failed to load admin panel.</p></div>`;
    }

    return el;
  }

  async _loadAndRender() {
    const [rsvpsRes, infoRes] = await Promise.all([
      fetch('/api/v1/party/rsvps',   { credentials: 'include' }),
      fetch('/api/v1/party/info',    { credentials: 'include' }),
    ]);
    const rsvps   = await rsvpsRes.json();
    const info    = await infoRes.json();

    this._rsvps    = rsvps;
    const parsed   = (() => { try { return JSON.parse(info.rsvp_form || 'null'); } catch { return null; } })();
    this._rsvpForm = Array.isArray(parsed) ? parsed : [];

    this._el.innerHTML = this._renderAll();
    this._bind();
  }

  _renderAll() {
    return `
      <div class="party-admin">
        <div class="party-admin__header">
          <h1 class="party-admin__title">🎂 Party Admin</h1>
          <a href="#/party" class="lol-btn lol-btn--ghost">← Back to Party</a>
        </div>

        ${this._renderStats()}
        ${this._renderAnswerTallies()}
        ${this._renderHelpersList()}
        ${this._renderRsvpTable()}
        ${this._renderGuestListExport()}
      </div>`;
  }

  _renderStats() {
    const rsvps = this._rsvps;
    const headcount = rsvps.filter(r => r.attending).length;

    // Try to derive day/evening/both from a radio-group field that looks like attendance timing
    const attendField = this._rsvpForm.find(f =>
      f.type === 'radio-group' &&
      (f.id === 'attend_when' || /attend|when|day|evening/i.test(f.label || ''))
    );

    let breakdownCards = '';
    if (attendField) {
      const tally = {};
      (attendField.options || []).forEach(opt => { tally[opt] = 0; });
      rsvps.forEach(r => {
        const a = r.answers?.[attendField.id];
        if (typeof a === 'string') tally[a] = (tally[a] || 0) + 1;
      });
      const pickCount = (regex) => {
        for (const [opt, count] of Object.entries(tally)) {
          if (regex.test(opt)) return count;
        }
        return 0;
      };
      const day      = pickCount(/day/i);
      const evening  = pickCount(/evening/i);
      const both     = pickCount(/both|all day/i);
      const declined = pickCount(/can'?t|sorry|no/i);
      breakdownCards = `
        <div class="party-admin__stat">
          <span class="party-admin__stat-num">${day}</span>
          <span class="party-admin__stat-label">☀️ Day only</span>
        </div>
        <div class="party-admin__stat">
          <span class="party-admin__stat-num">${evening}</span>
          <span class="party-admin__stat-label">🌙 Evening only</span>
        </div>
        <div class="party-admin__stat">
          <span class="party-admin__stat-num">${both}</span>
          <span class="party-admin__stat-label">🎉 Both</span>
        </div>
        <div class="party-admin__stat party-admin__stat--muted">
          <span class="party-admin__stat-num">${declined}</span>
          <span class="party-admin__stat-label">Can't make it</span>
        </div>`;
    }

    return `
      <section class="party-admin__section">
        <h2 class="party-admin__section-title">Stats</h2>
        <div class="party-admin__stats">
          <div class="party-admin__stat">
            <span class="party-admin__stat-num">${rsvps.length}</span>
            <span class="party-admin__stat-label">RSVPs submitted</span>
          </div>
          ${breakdownCards}
          <div class="party-admin__stat party-admin__stat--gold">
            <span class="party-admin__stat-num">${headcount}</span>
            <span class="party-admin__stat-label">Total Headcount</span>
          </div>
        </div>
      </section>`;
  }

  _dataFields() {
    // Fields that actually carry answer data (exclude pure layout)
    return this._rsvpForm.filter(f => !['heading', 'paragraph'].includes(f.type));
  }

  _formatAnswer(val) {
    if (val == null) return '—';
    if (Array.isArray(val)) return val.length ? val.map(escHtml).join(', ') : '—';
    return escHtml(String(val));
  }

  _renderRsvpTable() {
    const fields = this._dataFields();
    const colCount = 2 + fields.length; // Name + Email + one per field

    const rows = this._rsvps.map(r => {
      const answers = r.answers || {};
      const fieldCells = fields.map(f => `<td>${this._formatAnswer(answers[f.id])}</td>`).join('');
      return `
        <tr>
          <td>${escHtml(r.display_name || r.username)}</td>
          <td>${escHtml(r.email)}</td>
          ${fieldCells}
        </tr>`;
    }).join('') || `<tr><td colspan="${colCount}" class="party-empty">No RSVPs yet</td></tr>`;

    const fieldHeaders = fields.map(f => `<th>${escHtml(f.label || f.id)}</th>`).join('');

    return `
      <section class="party-admin__section">
        <h2 class="party-admin__section-title">RSVPs</h2>
        <div class="party-admin__table-wrap">
          <table class="party-admin__table" aria-label="RSVP list">
            <thead>
              <tr>
                <th>Name</th><th>Email</th>${fieldHeaders}
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        </div>
      </section>`;
  }

  _renderAnswerTallies() {
    // Tally all option-based fields (checkbox-group + radio-group)
    const groups = this._rsvpForm.filter(f =>
      (f.type === 'checkbox-group' || f.type === 'radio-group') && (f.options || []).length
    );
    if (!groups.length) return '';

    return groups.map(g => {
      const tally = {};
      (g.options || []).forEach(opt => { tally[opt] = 0; });
      this._rsvps.forEach(r => {
        const ans = r.answers?.[g.id];
        if (Array.isArray(ans)) {
          ans.forEach(v => { tally[v] = (tally[v] || 0) + 1; });
        } else if (typeof ans === 'string') {
          tally[ans] = (tally[ans] || 0) + 1;
        }
      });
      const items = Object.entries(tally).map(([name, count]) => `
        <div class="party-admin__stat">
          <span class="party-admin__stat-num">${count}</span>
          <span class="party-admin__stat-label">${escHtml(name)}</span>
        </div>`).join('');
      return `
        <section class="party-admin__section">
          <h2 class="party-admin__section-title">${escHtml(g.label || 'Tally')}</h2>
          <div class="party-admin__stats">${items}</div>
        </section>`;
    }).join('');
  }

  _renderHelpersList() {
    // Find the "helping" field and the conditional activity-details companion
    const helpField = this._rsvpForm.find(f =>
      f.type === 'checkbox-group' &&
      (f.id === 'helping' || /help/i.test(f.label || ''))
    );
    if (!helpField) return '';

    const activityField = this._rsvpForm.find(f =>
      f.type === 'textarea' &&
      (f.id === 'activity_details' || f.showIf?.fieldId === helpField.id)
    );

    const helpers = this._rsvps
      .map(r => ({
        rsvp:   r,
        offers: r.answers?.[helpField.id],
        detail: activityField ? r.answers?.[activityField.id] : null,
      }))
      .filter(h => Array.isArray(h.offers) && h.offers.length > 0);

    if (!helpers.length) return '';

    const cards = helpers.map(({ rsvp, offers, detail }) => {
      const chips = offers.map(o => `<span class="party-admin__chip">${escHtml(o)}</span>`).join('');
      const detailHtml = detail
        ? `<p class="party-admin__helper-detail"><strong>Activity:</strong> ${escHtml(detail)}</p>`
        : '';
      return `
        <div class="party-admin__helper-card">
          <div class="party-admin__helper-name">${escHtml(rsvp.display_name || rsvp.username)}</div>
          <div class="party-admin__helper-email">${escHtml(rsvp.email)}</div>
          <div class="party-admin__helper-chips">${chips}</div>
          ${detailHtml}
        </div>`;
    }).join('');

    return `
      <section class="party-admin__section">
        <h2 class="party-admin__section-title">🙋 Helpers (${helpers.length})</h2>
        <div class="party-admin__helpers">${cards}</div>
      </section>`;
  }

  _renderGuestListExport() {
    const fields = this._dataFields();
    const lines = this._rsvps.map(r => {
      const name = r.display_name || r.username;
      const parts = [`${name} (${r.email})`];
      for (const f of fields) {
        const a = r.answers?.[f.id];
        if (a == null || (Array.isArray(a) && !a.length) || a === '') continue;
        const val = Array.isArray(a) ? a.join(', ') : a;
        parts.push(`  ${f.label || f.id}: ${val}`);
      }
      return parts.join('\n');
    });

    return `
      <section class="party-admin__section">
        <h2 class="party-admin__section-title">Guest List Export</h2>
        <p class="party-admin__export-note">Copy and paste — ${this._rsvps.length} RSVPs:</p>
        <textarea class="lol-input lol-textarea party-admin__export-area" readonly
                  aria-label="Guest list export">${lines.join('\n\n')}</textarea>
      </section>`;
  }

  _bind() {
    // No-op placeholder — all current sections are read-only.
  }
}
