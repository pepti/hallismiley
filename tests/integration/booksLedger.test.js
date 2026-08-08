// The ledger, against real Postgres.
//
// These tests assert the SPECIFIC LEGS of each entry, not just that debits equal
// credits. "Balanced" is a tautology here — postEntry and the database trigger
// both refuse to write anything else — so a test that only checks balance proves
// nothing about whether the books are right. The previous system asserted balance
// five times and still booked every counter sale at 0% VAT.
const db = require('../../server/config/database');
const ledger = require('../../server/services/bookkeeping/ledgerService');
const audit = require('../../server/services/bookkeeping/auditLog');
const { createTestAdminUser, reseedBooksReferenceData } = require('../helpers');

let adminId;

// Read an entry's legs back as { accountCode: { debit, credit } } so a test can
// state what it expects the accounting to be.
async function legsOf(entryId) {
  const { rows } = await db.query(
    `SELECT la.code, jl.debit::bigint AS debit, jl.credit::bigint AS credit
       FROM journal_lines jl JOIN ledger_accounts la ON la.id = jl.account_id
      WHERE jl.entry_id = $1 ORDER BY jl.sort_order`,
    [entryId]
  );
  return Object.fromEntries(rows.map(r => [r.code, { debit: Number(r.debit), credit: Number(r.credit) }]));
}

beforeAll(async () => {
  // Every books table FKs to users, so any earlier suite calling cleanTables()
  // sweeps the chart of accounts and the fiscal periods along with it. Restoring
  // them here makes this suite independent of what ran before — without it the
  // period-lock test passes vacuously, because locking a row that no longer exists
  // updates nothing and postEntry then recreates the period as open.
  await reseedBooksReferenceData();
  ledger.invalidateAccountCache();
  adminId = await createTestAdminUser();
});

afterAll(async () => {
  await db.pool.end();
});

beforeEach(async () => {
  // Unlock everything between tests; individual tests lock what they need.
  await db.query(`UPDATE fiscal_periods SET status = 'open', locked_at = NULL, locked_by = NULL`);
});

describe('chart of accounts', () => {
  it('seeds a usable Icelandic chart of accounts', async () => {
    const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM ledger_accounts`);
    expect(rows[0].n).toBeGreaterThan(30);
  });

  it('types input VAT as an ASSET, not a liability', async () => {
    // The system this replaces typed 1310 Innskattur as a liability while debiting
    // it, so input VAT rendered as a negative liability on the balance sheet. It is
    // a receivable from the state.
    const { rows } = await db.query(`SELECT type FROM ledger_accounts WHERE code = '1310'`);
    expect(rows[0].type).toBe('asset');
  });

  it('has a separate output-VAT account per rate', async () => {
    // One aggregate VAT account makes a per-rate VSK return impossible to derive
    // from the ledger, which is exactly what RSK 10.01 boxes A/B/D require.
    const { rows } = await db.query(
      `SELECT code, vat_code FROM ledger_accounts WHERE code IN ('2200','2210') ORDER BY code`
    );
    expect(rows).toEqual([
      { code: '2200', vat_code: 'output_24' },
      { code: '2210', vat_code: 'output_11' },
    ]);
  });

  it('flags the statutory non-deductible input-VAT accounts', async () => {
    // Entertainment (risna) and staff meals are two of the four statutory
    // exclusions; encoding them on the COA lets the UI warn before the claim.
    const { rows } = await db.query(
      `SELECT code FROM ledger_accounts WHERE input_vat_blocked ORDER BY code`
    );
    expect(rows.map(r => r.code)).toEqual(expect.arrayContaining(['6900', '6910']));
  });

  it('refuses to post to an unknown account code', async () => {
    await expect(ledger.withTransaction(client => ledger.postEntry(client, {
      entryDate: '2026-07-10', memo: 'bad account', sourceType: 'manual', createdBy: adminId,
      lines: [{ accountCode: '9999', debit: 100 }, { accountCode: '1900', credit: 100 }],
    }))).rejects.toThrow(/Unknown ledger account/);
  });

  it('refuses to post to a deactivated account', async () => {
    await db.query(`UPDATE ledger_accounts SET is_active = FALSE WHERE code = '8200'`);
    ledger.invalidateAccountCache();
    try {
      await expect(ledger.withTransaction(client => ledger.postEntry(client, {
        entryDate: '2026-07-10', memo: 'inactive', sourceType: 'manual', createdBy: adminId,
        lines: [{ accountCode: '8200', debit: 100 }, { accountCode: '1900', credit: 100 }],
      }))).rejects.toThrow(/deactivated/);
    } finally {
      await db.query(`UPDATE ledger_accounts SET is_active = TRUE WHERE code = '8200'`);
      ledger.invalidateAccountCache();
    }
  });
});

describe('postEntry', () => {
  it('posts the exact legs it was given', async () => {
    const posted = await ledger.withTransaction(client => ledger.postEntry(client, {
      entryDate: '2026-07-15',
      memo: 'Sala — reikningur 1001',
      sourceType: 'invoice',
      sourceId: 'inv-test-1',
      createdBy: adminId,
      lines: [
        { accountCode: '1100', debit: 12400 },
        { accountCode: '4110', credit: 10000 },
        { accountCode: '2200', credit: 2400, vatRate: 24 },
      ],
    }));

    // The assertion that actually matters: AR carries the gross, revenue the net,
    // and the 24% output-VAT account exactly the VAT.
    expect(await legsOf(posted.id)).toEqual({
      '1100': { debit: 12400, credit: 0 },
      '4110': { debit: 0, credit: 10000 },
      '2200': { debit: 0, credit: 2400 },
    });
    expect(posted.period).toBe('2026-P4');
    expect(Number(posted.entry_number)).toBeGreaterThan(0);
  });

  it('records who posted it, as gr. 8 requires', async () => {
    const posted = await ledger.withTransaction(client => ledger.postEntry(client, {
      entryDate: '2026-07-15', memo: 'attribution', sourceType: 'manual', createdBy: adminId,
      lines: [{ accountCode: '1900', debit: 500 }, { accountCode: '4110', credit: 500 }],
    }));
    const { rows } = await db.query(
      `SELECT created_by, posted_at, source_type FROM journal_entries WHERE id = $1`, [posted.id]
    );
    expect(rows[0].created_by).toBe(adminId);
    expect(rows[0].posted_at).toBeInstanceOf(Date);
  });

  it('refuses an entry with no actor', async () => {
    await expect(ledger.withTransaction(client => ledger.postEntry(client, {
      entryDate: '2026-07-15', memo: 'anonymous', sourceType: 'manual',
      lines: [{ accountCode: '1900', debit: 1 }, { accountCode: '4110', credit: 1 }],
    }))).rejects.toThrow(/createdBy/);
  });

  it('refuses an entry with no memo', async () => {
    await expect(ledger.withTransaction(client => ledger.postEntry(client, {
      entryDate: '2026-07-15', memo: '  ', sourceType: 'manual', createdBy: adminId,
      lines: [{ accountCode: '1900', debit: 1 }, { accountCode: '4110', credit: 1 }],
    }))).rejects.toThrow(/memo/);
  });

  it('refuses an unbalanced entry', async () => {
    await expect(ledger.withTransaction(client => ledger.postEntry(client, {
      entryDate: '2026-07-15', memo: 'unbalanced', sourceType: 'manual', createdBy: adminId,
      lines: [{ accountCode: '1100', debit: 100 }, { accountCode: '4110', credit: 99 }],
    }))).rejects.toThrow(/Unbalanced/);
  });

  it('drops zero legs rather than violating the one-side rule', async () => {
    // A COGS leg for a product with no recorded cost is legitimately zero; it
    // carries no information and must not break the posting.
    const posted = await ledger.withTransaction(client => ledger.postEntry(client, {
      entryDate: '2026-07-15', memo: 'zero leg', sourceType: 'invoice', createdBy: adminId,
      lines: [
        { accountCode: '1100', debit: 1000 },
        { accountCode: '4110', credit: 1000 },
        { accountCode: '5100', debit: 0 },
        { accountCode: '1200', credit: 0 },
      ],
    }));
    expect(Object.keys(await legsOf(posted.id)).sort()).toEqual(['1100', '4110']);
  });

  it('refuses a leg carrying both a debit and a credit', async () => {
    await expect(ledger.withTransaction(client => ledger.postEntry(client, {
      entryDate: '2026-07-15', memo: 'both sides', sourceType: 'manual', createdBy: adminId,
      lines: [{ accountCode: '1100', debit: 50, credit: 50 }, { accountCode: '4110', credit: 50 }],
    }))).rejects.toThrow(/both a debit and a credit/);
  });

  it('refuses a negative amount instead of flipping it silently', async () => {
    await expect(ledger.withTransaction(client => ledger.postEntry(client, {
      entryDate: '2026-07-15', memo: 'negative', sourceType: 'manual', createdBy: adminId,
      lines: [{ accountCode: '1100', debit: -100 }, { accountCode: '4110', credit: -100 }],
    }))).rejects.toThrow(/negative/);
  });

  it('rejects an invalid accounting date', async () => {
    await expect(ledger.withTransaction(client => ledger.postEntry(client, {
      entryDate: 'yesterday-ish', memo: 'bad date', sourceType: 'manual', createdBy: adminId,
      lines: [{ accountCode: '1900', debit: 1 }, { accountCode: '4110', credit: 1 }],
    }))).rejects.toThrow(/Invalid|date/i);
  });
});

describe('gapless numbering', () => {
  it('leaves no hole in the series when a transaction rolls back', async () => {
    // The whole reason a counter row is used instead of a SEQUENCE: a SEQUENCE does
    // not roll back, so a failed insert burns a number and holes the series, which
    // Reglugerð 505/2013 gr. 16 does not permit.
    const before = await counterValue('journal_entry');
    await expect(ledger.withTransaction(async (client) => {
      await ledger.postEntry(client, {
        entryDate: '2026-07-20', memo: 'will roll back', sourceType: 'manual', createdBy: adminId,
        lines: [{ accountCode: '1900', debit: 10 }, { accountCode: '4110', credit: 10 }],
      });
      throw new Error('deliberate rollback');
    })).rejects.toThrow('deliberate rollback');
    expect(await counterValue('journal_entry')).toBe(before);
  });

  it('hands out consecutive numbers under concurrency', async () => {
    const before = await counterValue('journal_entry');
    const posts = await Promise.all(Array.from({ length: 6 }, (_, i) =>
      ledger.withTransaction(client => ledger.postEntry(client, {
        entryDate: '2026-07-21', memo: `concurrent ${i}`, sourceType: 'manual', createdBy: adminId,
        lines: [{ accountCode: '1900', debit: 100 + i }, { accountCode: '4110', credit: 100 + i }],
      }))
    ));
    const numbers = posts.map(p => Number(p.entry_number)).sort((a, b) => a - b);
    // Consecutive with no duplicates and no gaps.
    expect(numbers).toEqual(Array.from({ length: 6 }, (_, i) => before + i));
    expect(await counterValue('journal_entry')).toBe(before + 6);
  });

  it('keeps invoice and receipt series independent', async () => {
    // Reglugerð 50/1993: receipt numbering is a separate series from sales invoices.
    const a = await ledger.withTransaction(c => ledger.nextCounter(c, 'invoice'));
    const b = await ledger.withTransaction(c => ledger.nextCounter(c, 'receipt'));
    const a2 = await ledger.withTransaction(c => ledger.nextCounter(c, 'invoice'));
    expect(a2).toBe(a + 1);
    expect(b).not.toBe(a); // different series, independent counters
  });

  it('starts invoice numbers at 1001', async () => {
    const { rows } = await db.query(`SELECT next_value FROM bookkeeping_counters WHERE name = 'invoice'`);
    expect(Number(rows[0].next_value)).toBeGreaterThanOrEqual(1001);
  });
});

async function counterValue(name) {
  const { rows } = await db.query(`SELECT next_value FROM bookkeeping_counters WHERE name = $1`, [name]);
  return Number(rows[0].next_value);
}

describe('append-only enforcement (Reglugerð 505/2013 gr. 9)', () => {
  let posted;

  beforeEach(async () => {
    posted = await ledger.withTransaction(client => ledger.postEntry(client, {
      entryDate: '2026-07-25', memo: 'immutable', sourceType: 'manual', createdBy: adminId,
      lines: [{ accountCode: '1100', debit: 6200 }, { accountCode: '4110', credit: 5000 },
        { accountCode: '2200', credit: 1200 }],
    }));
  });

  // Raw SQL on purpose: the point is that the DATABASE refuses, so the guarantee
  // survives a future code path that forgets to go through the service.
  it('refuses a direct UPDATE of a posted entry', async () => {
    await expect(db.query(`UPDATE journal_entries SET memo = 'tampered' WHERE id = $1`, [posted.id]))
      .rejects.toThrow(/cannot be altered/);
  });

  it('refuses a direct DELETE of a posted entry', async () => {
    await expect(db.query(`DELETE FROM journal_entries WHERE id = $1`, [posted.id]))
      .rejects.toThrow(/cannot be deleted/);
  });

  it('refuses a direct UPDATE of a posted line', async () => {
    await expect(db.query(`UPDATE journal_lines SET debit = 999999 WHERE entry_id = $1`, [posted.id]))
      .rejects.toThrow(/cannot be altered or deleted/);
  });

  it('refuses a direct DELETE of a posted line', async () => {
    await expect(db.query(`DELETE FROM journal_lines WHERE entry_id = $1`, [posted.id]))
      .rejects.toThrow(/cannot be altered or deleted/);
  });

  it('refuses to un-post an entry', async () => {
    await expect(db.query(
      `UPDATE journal_entries SET posted_at = NULL, entry_number = NULL WHERE id = $1`, [posted.id]
    )).rejects.toThrow(/cannot be altered/);
  });

  it('refuses to attach a line to an already-posted entry, even by raw SQL', async () => {
    // The first line of defence, and the reason postEntry builds a draft and only
    // then flips it: if entries could be born posted, appending a BALANCED PAIR of
    // lines afterwards would rewrite posted history and pass every other check.
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO journal_entries (entry_number, entry_date, memo, source_type, posted_at, created_by)
         VALUES (990001, '2026-07-26', 'raw', 'manual', NOW(), $1) RETURNING id`, [adminId]);
      const acct = await client.query(`SELECT id FROM ledger_accounts WHERE code = '1100'`);
      await expect(client.query(
        `INSERT INTO journal_lines (entry_id, account_id, debit, credit) VALUES ($1, $2, 500, 0)`,
        [rows[0].id, acct.rows[0].id]
      )).rejects.toThrow(/cannot be added to a posted/i);
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
  });

  it('refuses to POST an unbalanced draft written by raw SQL, bypassing the service', async () => {
    // Second line of defence: the deferred constraint trigger, which is the
    // backstop for any future writer that does not go through postEntry.
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO journal_entries (entry_date, memo, source_type, created_by)
         VALUES ('2026-07-26', 'raw draft', 'manual', $1) RETURNING id`, [adminId]);
      const acct = await client.query(`SELECT id FROM ledger_accounts WHERE code = '1100'`);
      await client.query(
        `INSERT INTO journal_lines (entry_id, account_id, debit, credit) VALUES ($1, $2, 500, 0)`,
        [rows[0].id, acct.rows[0].id]);
      await client.query(
        `UPDATE journal_entries SET posted_at = NOW(), entry_number = 990002 WHERE id = $1`,
        [rows[0].id]);
      await expect(client.query('COMMIT')).rejects.toThrow(/unbalanced/i);
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
  });

  it('refuses to move a journal line between entries', async () => {
    // Reparenting was the subtler half of the same hole: moving a balanced PAIR
    // out of a draft and into a posted entry left the target balanced, so only a
    // check on the DESTINATION parent catches it.
    const posted = await ledger.withTransaction(client => ledger.postEntry(client, {
      entryDate: '2026-07-26', memo: 'target', sourceType: 'manual', createdBy: adminId,
      lines: [{ accountCode: '1100', debit: 1000 }, { accountCode: '4110', credit: 1000 }],
    }));
    const draft = await ledger.withTransaction(client => ledger.createDraft(client, {
      entryDate: '2026-07-26', memo: 'source', createdBy: adminId,
      lines: [{ accountCode: '1100', debit: 500 }, { accountCode: '4110', credit: 500 }],
    }));
    await expect(db.query(
      `UPDATE journal_lines SET entry_id = $1 WHERE entry_id = $2`, [posted.id, draft.id]
    )).rejects.toThrow(/cannot be moved between entries/i);
  });
});

describe('reverseEntry', () => {
  it('mirrors every leg and cross-references the original', async () => {
    const original = await ledger.withTransaction(client => ledger.postEntry(client, {
      entryDate: '2026-07-27', memo: 'to be reversed', sourceType: 'invoice', createdBy: adminId,
      lines: [{ accountCode: '1100', debit: 12400 }, { accountCode: '4110', credit: 10000 },
        { accountCode: '2200', credit: 2400 }],
    }));

    const { reversal } = await ledger.withTransaction(client => ledger.reverseEntry(
      client, original.id, { createdBy: adminId, reason: 'Rangur viðtakandi', entryDate: '2026-07-28' }
    ));

    // Every side flipped, same amounts.
    expect(await legsOf(reversal.id)).toEqual({
      '1100': { debit: 0, credit: 12400 },
      '4110': { debit: 10000, credit: 0 },
      '2200': { debit: 2400, credit: 0 },
    });

    const { rows } = await db.query(
      `SELECT reverses_entry_id, source_type, memo FROM journal_entries WHERE id = $1`, [reversal.id]
    );
    expect(rows[0].reverses_entry_id).toBe(original.id);
    expect(rows[0].source_type).toBe('reversal');
    expect(rows[0].memo).toContain('Rangur viðtakandi');
  });

  it('carries vat_rate onto the mirror VAT leg', async () => {
    // The reversal's SELECT dropped jl.vat_rate, so every reversed VAT leg came back
    // blank — the same NULL-vat_rate class of bug the original INSERT had. The VSK return
    // derives from vat_code so it survived, but the journal export's VSK% column did not.
    const original = await ledger.withTransaction(client => ledger.postEntry(client, {
      entryDate: '2026-07-27', memo: 'vat leg', sourceType: 'invoice', createdBy: adminId,
      lines: [
        { accountCode: '1100', debit: 12400 },
        { accountCode: '4110', credit: 10000 },
        { accountCode: '2200', credit: 2400, vatRate: 24 },
      ],
    }));
    const { reversal } = await ledger.withTransaction(client => ledger.reverseEntry(
      client, original.id, { createdBy: adminId, reason: 'Bakfærsla', entryDate: '2026-07-28' }
    ));
    const { rows } = await db.query(
      `SELECT jl.vat_rate FROM journal_lines jl
         JOIN ledger_accounts la ON la.id = jl.account_id
        WHERE jl.entry_id = $1 AND la.code = '2200'`,
      [reversal.id]
    );
    expect(rows[0].vat_rate).toBe(24);
  });

  it('nets to zero against the original, leaving no balance behind', async () => {
    const original = await ledger.withTransaction(client => ledger.postEntry(client, {
      entryDate: '2026-07-27', memo: 'net to zero', sourceType: 'manual', createdBy: adminId,
      lines: [{ accountCode: '1910', debit: 3000 }, { accountCode: '4100', credit: 3000 }],
    }));
    const before = await accountBalance('1910');
    await ledger.withTransaction(client => ledger.reverseEntry(
      client, original.id, { createdBy: adminId, reason: 'Afturkallað', entryDate: '2026-07-28' }
    ));
    expect(await accountBalance('1910')).toBe(before - 3000);
  });

  it('refuses to reverse the same entry twice', async () => {
    const original = await ledger.withTransaction(client => ledger.postEntry(client, {
      entryDate: '2026-07-27', memo: 'reverse once', sourceType: 'manual', createdBy: adminId,
      lines: [{ accountCode: '1900', debit: 100 }, { accountCode: '4110', credit: 100 }],
    }));
    await ledger.withTransaction(client => ledger.reverseEntry(
      client, original.id, { createdBy: adminId, reason: 'first' }
    ));
    await expect(ledger.withTransaction(client => ledger.reverseEntry(
      client, original.id, { createdBy: adminId, reason: 'second' }
    ))).rejects.toThrow(/already been reversed/);
  });

  it('requires a reason', async () => {
    const original = await ledger.withTransaction(client => ledger.postEntry(client, {
      entryDate: '2026-07-27', memo: 'needs reason', sourceType: 'manual', createdBy: adminId,
      lines: [{ accountCode: '1900', debit: 100 }, { accountCode: '4110', credit: 100 }],
    }));
    await expect(ledger.withTransaction(client => ledger.reverseEntry(
      client, original.id, { createdBy: adminId, reason: '  ' }
    ))).rejects.toThrow(/reason/i);
  });

  it('flags a cross-period reversal as a correction', async () => {
    const original = await ledger.withTransaction(client => ledger.postEntry(client, {
      entryDate: '2026-05-10', memo: 'prior period', sourceType: 'manual', createdBy: adminId,
      lines: [{ accountCode: '1900', debit: 700 }, { accountCode: '4110', credit: 700 }],
    }));
    const { reversal } = await ledger.withTransaction(client => ledger.reverseEntry(
      client, original.id, { createdBy: adminId, reason: 'found late', entryDate: '2026-07-29' }
    ));
    const { rows } = await db.query(`SELECT is_correction FROM journal_entries WHERE id = $1`, [reversal.id]);
    expect(rows[0].is_correction).toBe(true);
  });
});

async function accountBalance(code) {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(jl.debit) - SUM(jl.credit), 0)::bigint AS bal
       FROM journal_lines jl
       JOIN ledger_accounts la ON la.id = jl.account_id
       JOIN journal_entries je ON je.id = jl.entry_id
      WHERE la.code = $1 AND je.posted_at IS NOT NULL`,
    [code]
  );
  return Number(rows[0].bal);
}

describe('period locking', () => {
  // Locking through a helper that PROVES a row was affected. A bare UPDATE against
  // a missing period row updates nothing, postEntry then recreates the period as
  // open, and every test below would pass while testing nothing.
  async function lockPeriod(period) {
    const res = await db.query(
      `UPDATE fiscal_periods SET status='locked', locked_at=NOW(), locked_by=$1 WHERE period=$2`,
      [adminId, period]
    );
    expect(res.rowCount).toBe(1);
  }

  it('refuses to post into a locked period', async () => {
    await lockPeriod('2026-P1');
    await expect(ledger.withTransaction(client => ledger.postEntry(client, {
      entryDate: '2026-02-10', memo: 'into a filed period', sourceType: 'manual', createdBy: adminId,
      lines: [{ accountCode: '1900', debit: 100 }, { accountCode: '4110', credit: 100 }],
    }))).rejects.toThrow(/closed because its VSK return has been filed/);
  });

  it('reports the lock as a 409 conflict, not a 500', async () => {
    await lockPeriod('2026-P1');
    await expect(ledger.withTransaction(client => ledger.postEntry(client, {
      entryDate: '2026-02-10', memo: 'locked', sourceType: 'manual', createdBy: adminId,
      lines: [{ accountCode: '1900', debit: 1 }, { accountCode: '4110', credit: 1 }],
    }))).rejects.toMatchObject({ status: 409, code: 'PERIOD_LOCKED' });
  });

  it('still allows posting into an open period', async () => {
    await lockPeriod('2026-P1');
    const posted = await ledger.withTransaction(client => ledger.postEntry(client, {
      entryDate: '2026-08-01', memo: 'open period', sourceType: 'manual', createdBy: adminId,
      lines: [{ accountCode: '1900', debit: 100 }, { accountCode: '4110', credit: 100 }],
    }));
    expect(posted.period).toBe('2026-P4');
  });

  it('honours the lock at the DB trigger even if a second period overlaps the date', async () => {
    // The trigger used to read `SELECT status INTO v_status` for the covering
    // period. SELECT ... INTO takes the first of however many rows match and
    // discards the rest, so with an open period and a locked one both covering
    // the date, whether the posting was refused depended on row order — probing
    // it produced both answers on different runs. ensureFiscalPeriod only ever
    // writes canonical non-overlapping VSK periods, so this needs raw SQL to set
    // up, but a statutory control should not rest on that.
    await db.query(
      `INSERT INTO fiscal_periods (period, starts_on, ends_on, status, locked_at, locked_by)
       VALUES ('OVERLAP-TEST', '2026-08-05', '2026-08-09', 'locked', NOW(), $1)`,
      [adminId]
    );
    try {
      // 2026-P4 (2026-07-01..08-31) is open and also covers this date.
      const p4 = await db.query(`SELECT status FROM fiscal_periods WHERE period = '2026-P4'`);
      expect(p4.rows[0].status).toBe('open');

      // Build a genuinely balanced draft first, so the ONLY thing that can
      // reject the posting is the period lock — an entry with no lines is
      // refused by the balance trigger instead, which would pass for the
      // wrong reason.
      const accs = await db.query(
        `SELECT id, code FROM ledger_accounts WHERE code IN ('1900','4110') ORDER BY code`);
      const [a4110, a1900] = [accs.rows.find(r => r.code === '4110'), accs.rows.find(r => r.code === '1900')];
      await db.query(
        `INSERT INTO journal_entries (id, entry_date, memo, source_type, is_correction, created_by)
         VALUES ('overlap-probe', '2026-08-07', 'straight at the trigger', 'manual', false, $1)`,
        [adminId]
      );
      await db.query(
        `INSERT INTO journal_lines (id, entry_id, account_id, debit, credit, memo, sort_order)
         VALUES ('overlap-l1','overlap-probe',$1,100,0,'d',0),
                ('overlap-l2','overlap-probe',$2,0,100,'c',1)`,
        [a1900.id, a4110.id]
      );
      await expect(db.query(
        `UPDATE journal_entries SET posted_at = NOW(), entry_number = 987654321
          WHERE id = 'overlap-probe'`
      )).rejects.toThrow(/is locked/);
    } finally {
      await db.query(`DELETE FROM journal_lines WHERE entry_id = 'overlap-probe'`);
      await db.query(`DELETE FROM journal_entries WHERE id = 'overlap-probe'`);
      await db.query(`DELETE FROM fiscal_periods WHERE period = 'OVERLAP-TEST'`);
    }
  });

  it('creates a fiscal period on demand for a year that was never seeded', async () => {
    // A year boundary must never be a hard stop, so ensureFiscalPeriod inserts.
    await db.query(`DELETE FROM fiscal_periods WHERE period = '2031-P3'`);
    const posted = await ledger.withTransaction(client => ledger.postEntry(client, {
      entryDate: '2031-06-15', memo: 'future year', sourceType: 'manual', createdBy: adminId,
      lines: [{ accountCode: '1900', debit: 100 }, { accountCode: '4110', credit: 100 }],
    }));
    expect(posted.period).toBe('2031-P3');
    const { rows } = await db.query(
      `SELECT starts_on, ends_on, status FROM fiscal_periods WHERE period = '2031-P3'`);
    expect(rows[0].status).toBe('open');
  });
});

describe('drafts', () => {
  it('allows an unbalanced draft, then refuses to post it', async () => {
    // Drafts are what make an append-only ledger usable: build and review, then
    // commit. But posting is the point of no return, so it must balance.
    const draft = await ledger.withTransaction(client => ledger.createDraft(client, {
      entryDate: '2026-08-02', memo: 'work in progress', createdBy: adminId,
      lines: [{ accountCode: '1900', debit: 500 }],
    }));
    await expect(ledger.withTransaction(client => ledger.postDraft(client, draft.id, { createdBy: adminId })))
      .rejects.toThrow(/unbalanced/i);
  });

  it('lets a draft be edited and deleted', async () => {
    const draft = await ledger.withTransaction(client => ledger.createDraft(client, {
      entryDate: '2026-08-02', memo: 'editable', createdBy: adminId,
      lines: [{ accountCode: '1900', debit: 500 }],
    }));
    await expect(db.query(`UPDATE journal_entries SET memo = 'edited' WHERE id = $1`, [draft.id]))
      .resolves.toBeDefined();
    await expect(db.query(`DELETE FROM journal_entries WHERE id = $1`, [draft.id]))
      .resolves.toBeDefined();
  });

  it('posts a balanced draft and assigns it a number', async () => {
    const draft = await ledger.withTransaction(client => ledger.createDraft(client, {
      entryDate: '2026-08-02', memo: 'ready', createdBy: adminId,
      lines: [{ accountCode: '1900', debit: 500 }, { accountCode: '4110', credit: 500 }],
    }));
    const posted = await ledger.withTransaction(client =>
      ledger.postDraft(client, draft.id, { createdBy: adminId }));
    expect(Number(posted.entry_number)).toBeGreaterThan(0);
    // ...and it is immutable from that moment on.
    await expect(db.query(`DELETE FROM journal_entries WHERE id = $1`, [draft.id]))
      .rejects.toThrow(/cannot be deleted/);
  });

  it('refuses to post the same draft twice', async () => {
    const draft = await ledger.withTransaction(client => ledger.createDraft(client, {
      entryDate: '2026-08-02', memo: 'once only', createdBy: adminId,
      lines: [{ accountCode: '1900', debit: 200 }, { accountCode: '4110', credit: 200 }],
    }));
    await ledger.withTransaction(client => ledger.postDraft(client, draft.id, { createdBy: adminId }));
    await expect(ledger.withTransaction(client => ledger.postDraft(client, draft.id, { createdBy: adminId })))
      .rejects.toThrow(/already posted/);
  });
});

describe('audit log', () => {
  it('is append-only', async () => {
    await ledger.withTransaction(client => audit.record(client, {
      actorId: adminId, action: 'journal.posted', entityType: 'journal_entry', entityId: 'x1',
      summary: { entry_number: 1 },
    }));
    await expect(db.query(`UPDATE books_audit_log SET action = 'tampered' WHERE entity_id = 'x1'`))
      .rejects.toThrow(/append-only/);
    await expect(db.query(`DELETE FROM books_audit_log WHERE entity_id = 'x1'`))
      .rejects.toThrow(/append-only/);
  });

  it('rejects an unregistered action, keeping the vocabulary a real index', async () => {
    await expect(ledger.withTransaction(client => audit.record(client, {
      actorId: adminId, action: 'invented.action', entityType: 'invoice', entityId: 'x2',
    }))).rejects.toThrow(/Unknown books audit action/);
  });

  it('reads history back newest first with the actor resolved', async () => {
    await ledger.withTransaction(async (client) => {
      await audit.record(client, {
        actorId: adminId, action: 'invoice.issued', entityType: 'invoice', entityId: 'inv-h1',
        summary: { total_gross: 12400 },
      });
      await audit.record(client, {
        actorId: adminId, action: 'payment.recorded', entityType: 'invoice', entityId: 'inv-h1',
        summary: { amount: 12400 },
      });
    });
    const history = await audit.forEntity(db, 'invoice', 'inv-h1');
    expect(history).toHaveLength(2);
    expect(history[0].action).toBe('payment.recorded');
    expect(history[0].actor_username).toBe(process.env.ADMIN_USERNAME);
  });
});
