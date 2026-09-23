'use strict';
// Which job this instance does (D-020, 2026-09-21). One codebase, two roles:
//
//   ops    — the private instance where the business runs: books, invoices,
//            contracts, commission, the sales pipeline. The DEFAULT, so every
//            instance that predates this flag keeps behaving exactly as before.
//   public — orangesmiley.is: the company site plus the seller area, which is a
//            read-only copy published ONE WAY from ops. Only this role accepts
//            the signed publish (/api/v1/seller-publish) and serves
//            /api/v1/seller/*.
//
// Read per call, not cached, so a test can flip it. An unknown value falls back
// to `ops` — i.e. closed: the ingest route and the seller API stay 404.
const ROLES = ['ops', 'public'];

function instanceRole() {
  const v = String(process.env.INSTANCE_ROLE || 'ops').trim().toLowerCase();
  return ROLES.includes(v) ? v : 'ops';
}

const isPublicInstance = () => instanceRole() === 'public';

module.exports = { instanceRole, isPublicInstance, ROLES };
