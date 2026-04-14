import { isAuthenticated, isAdmin } from '../services/auth.js';
import { getCsrfHeaders } from '../utils/api.js';
import { showToast }    from '../components/Toast.js';
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
    const [invitesRes, rsvpsRes, infoRes] = await Promise.all([
      fetch('/api/v1/party/invites', { credentials: 'include' }),
      fetch('/api/v1/party/rsvps',   { credentials: 'include' }),
      fetch('/api/v1/party/info',    { credentials: 'include' }),
    ]);
    const invites = await invitesRes.json();
    const rsvps   = await rsvpsRes.json();
    const info    = await infoRes.json();

    this._invites = invites;
    this._rsvps   = rsvps;
    this._foodOptions   = (() => { try { return JSON.parse(info.food_options   || '[]'); } catch { return []; } })();
    this._rsvpQuestions = (() => { try { return JSON.parse(info.rsvp_questions || '[]'); } catch { return []; } })();

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
        ${this._renderFoodTally()}
        ${this._renderInviteManager()}
        ${this._renderRsvpTable()}
        ${this._renderGuestListExport()}
      </div>`;
  }

  _renderStats() {
    const invites  = this._invites;
    const rsvps    = this._rsvps;

    const pending  = invites.filter(i => i.status === 'pending').length;
    const accepted = invites.filter(i => i.status === 'accepted').length;
    const declined = invites.filter(i => i.status === 'declined').length;
    const total    = invites.length;

    const headcount = rsvps.reduce((sum, r) => {
      if (!r.attending) return sum;
      return sum + 1 + (r.plus_one ? 1 : 0);
    }, 0);

    return `
      <section class="party-admin__section">
        <h2 class="party-admin__section-title">Stats</h2>
        <div class="party-admin__stats">
          <div class="party-admin__stat">
            <span class="party-admin__stat-num">${total}</span>
            <span class="party-admin__stat-label">Invited</span>
          </div>
          <div class="party-admin__stat party-admin__stat--green">
            <span class="party-admin__stat-num">${accepted}</span>
            <span class="party-admin__stat-label">Accepted</span>
          </div>
          <div class="party-admin__stat party-admin__stat--red">
            <span class="party-admin__stat-num">${declined}</span>
            <span class="party-admin__stat-label">Declined</span>
          </div>
          <div class="party-admin__stat party-admin__stat--muted">
            <span class="party-admin__stat-num">${pending}</span>
            <span class="party-admin__stat-label">Pending</span>
          </div>
          <div class="party-admin__stat party-admin__stat--gold">
            <span class="party-admin__stat-num">${headcount}</span>
            <span class="party-admin__stat-label">Total Headcount</span>
          </div>
        </div>
      </section>`;
  }

  _renderInviteManager() {
    const rows = this._invites.map(inv => `
      <tr>
        <td>${escHtml(inv.email)}</td>
        <td><span class="party-status party-status--${inv.status}">${escHtml(inv.status)}</span></td>
        <td class="party-admin__token-cell">
          <code class="party-admin__token" title="Invite link token">${escHtml(inv.invite_token || '')}</code>
        </td>
        <td>${escHtml(inv.invited_by_username || '—')}</td>
        <td>
          <button class="lol-btn lol-btn--danger lol-btn--sm party-admin__remove-invite"
                  data-id="${inv.id}" aria-label="Remove invite for ${escHtml(inv.email)}">Remove</button>
        </td>
      </tr>`).join('') || '<tr><td colspan="5" class="party-empty">No invites yet</td></tr>';

    return `
      <section class="party-admin__section">
        <h2 class="party-admin__section-title">Invite Management</h2>
        <form class="party-admin__invite-form" id="add-invites-form" novalidate>
          <label class="party-label" for="invite-emails">Add emails (one per line)</label>
          <textarea id="invite-emails" class="lol-input lol-textarea party-admin__invite-textarea"
                    placeholder="alice@example.com&#10;bob@example.com"
                    aria-label="Email addresses to invite"></textarea>
          <button type="submit" class="lol-btn lol-btn--primary">Send Invites</button>
        </form>
        <div class="party-admin__table-wrap">
          <table class="party-admin__table" aria-label="Invite list">
            <thead>
              <tr>
                <th>Email</th><th>Status</th><th>Token</th><th>Invited by</th><th></th>
              </tr>
            </thead>
            <tbody id="invite-table-body">
              ${rows}
            </tbody>
          </table>
        </div>
      </section>`;
  }

  _renderRsvpTable() {
    const hasQuestions = this._rsvpQuestions.length > 0;
    const colCount = 6 + (hasQuestions ? 1 : 0);

    const rows = this._rsvps.map(r => {
      const foodCell = r.food_choices?.guest?.length
        ? escHtml(r.food_choices.guest.join(', '))
        : escHtml(r.dietary_needs || '—');

      const plusOneFood = r.food_choices?.plus_one?.length
        ? ` (${escHtml(r.food_choices.plus_one.join(', '))})`
        : (r.plus_one_dietary ? ` (${escHtml(r.plus_one_dietary)})` : '');
      const plusOneCell = r.plus_one
        ? `Yes — ${escHtml(r.plus_one_name || 'Guest')}${plusOneFood}`
        : 'No';

      const answersCell = hasQuestions
        ? `<td>${this._rsvpQuestions.map(q => {
            const ans = r.custom_answers?.[q.id];
            return ans?.length ? `<strong>${escHtml(q.label)}:</strong> ${ans.map(a => escHtml(a)).join(', ')}` : '';
          }).filter(Boolean).join('<br>') || '—'}</td>`
        : '';

      return `
        <tr>
          <td>${escHtml(r.display_name || r.username)}</td>
          <td>${escHtml(r.email)}</td>
          <td><span class="party-status party-status--${r.attending ? 'accepted' : 'declined'}">${r.attending ? 'Yes ✅' : 'No ❌'}</span></td>
          <td>${foodCell}</td>
          <td>${plusOneCell}</td>
          ${answersCell}
          <td>${escHtml(r.message || '—')}</td>
        </tr>`;
    }).join('') || `<tr><td colspan="${colCount}" class="party-empty">No RSVPs yet</td></tr>`;

    return `
      <section class="party-admin__section">
        <h2 class="party-admin__section-title">RSVPs</h2>
        <div class="party-admin__table-wrap">
          <table class="party-admin__table" aria-label="RSVP list">
            <thead>
              <tr>
                <th>Name</th><th>Email</th><th>Attending</th><th>Food</th><th>Plus One</th>${hasQuestions ? '<th>Answers</th>' : ''}<th>Message</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        </div>
      </section>`;
  }

  _renderFoodTally() {
    if (!this._foodOptions.length) return '';
    const attending = this._rsvps.filter(r => r.attending);
    const tally = {};
    this._foodOptions.forEach(opt => { tally[opt] = 0; });
    attending.forEach(r => {
      (r.food_choices?.guest || []).forEach(f => { tally[f] = (tally[f] || 0) + 1; });
      if (r.plus_one) {
        (r.food_choices?.plus_one || []).forEach(f => { tally[f] = (tally[f] || 0) + 1; });
      }
    });

    const statItems = Object.entries(tally).map(([name, count]) => `
      <div class="party-admin__stat">
        <span class="party-admin__stat-num">${count}</span>
        <span class="party-admin__stat-label">${escHtml(name)}</span>
      </div>`).join('');

    return `
      <section class="party-admin__section">
        <h2 class="party-admin__section-title">Food Tally</h2>
        <div class="party-admin__stats">${statItems}</div>
      </section>`;
  }

  _renderGuestListExport() {
    const attending = this._rsvps.filter(r => r.attending);
    const lines = attending.flatMap(r => {
      const name = r.display_name || r.username;
      const foodInfo = r.food_choices?.guest?.length
        ? ` — Food: ${r.food_choices.guest.join(', ')}`
        : (r.dietary_needs ? ` — ${r.dietary_needs}` : '');
      const rows = [`${name} (${r.email})${foodInfo}`];
      if (r.plus_one) {
        const plusFood = r.food_choices?.plus_one?.length
          ? ` — Food: ${r.food_choices.plus_one.join(', ')}`
          : (r.plus_one_dietary ? ` — ${r.plus_one_dietary}` : '');
        rows.push(`  + ${r.plus_one_name || 'Plus one'}${plusFood}`);
      }
      // Custom answers
      for (const q of this._rsvpQuestions) {
        const ans = r.custom_answers?.[q.id];
        if (ans?.length) rows.push(`  ${q.label}: ${ans.join(', ')}`);
      }
      return rows;
    });

    return `
      <section class="party-admin__section">
        <h2 class="party-admin__section-title">Guest List Export</h2>
        <p class="party-admin__export-note">Copy and paste — ${attending.length} confirmed guests:</p>
        <textarea class="lol-input lol-textarea party-admin__export-area" readonly
                  aria-label="Guest list export">${lines.join('\n')}</textarea>
      </section>`;
  }

  _bind() {
    // Add invites form
    this._el.querySelector('#add-invites-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const raw    = this._el.querySelector('#invite-emails')?.value || '';
      const emails = raw.split('\n').map(s => s.trim()).filter(Boolean);
      if (emails.length === 0) {
        showToast('Enter at least one email', 'error');
        return;
      }

      const btn = e.target.querySelector('[type="submit"]');
      btn.disabled = true;
      btn.textContent = 'Sending…';
      try {
        const headers = await getCsrfHeaders();
        const res = await fetch('/api/v1/party/invites', {
          method:      'POST',
          credentials: 'include',
          headers,
          body:        JSON.stringify({ emails }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');

        showToast(`${data.length} invite(s) added`, 'success');
        this._el.querySelector('#invite-emails').value = '';
        // Reload
        await this._loadAndRender();
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        btn.disabled    = false;
        btn.textContent = 'Send Invites';
      }
    });

    // Remove invite buttons
    this._el.querySelectorAll('.party-admin__remove-invite').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        if (!confirm('Remove this invite?')) return;

        try {
          const headers = await getCsrfHeaders();
          const res = await fetch(`/api/v1/party/invites/${id}`, {
            method: 'DELETE', credentials: 'include', headers,
          });
          if (!res.ok) {
            const d = await res.json();
            throw new Error(d.error);
          }
          showToast('Invite removed', 'success');
          await this._loadAndRender();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });
  }
}
