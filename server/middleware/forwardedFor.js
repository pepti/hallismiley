// Azure App Service forwards the client address as `X-Forwarded-For: ip:port`
// (IPv4) or `[ip]:port` (IPv6). With `trust proxy` on, Express hands that
// string straight through as `req.ip`, and express-rate-limit's key generator
// returns any non-IPv6 string verbatim — so on Azure every TCP connection got
// its own rate-limit bucket. Measured on icelandicstore TEST and PROD 2026-09-12
// (ported here 2026-09-22 after orangesmiley.is logged ERR_ERL_INVALID_IP_ADDRESS
// on its first day): three fresh connections, three `RateLimit-Remaining: 49`.
// Every IP-keyed limiter (global, writes, login, contact, MCP pre-auth) and the
// brute-force tracker were keyed per connection, not per client.
//
// This strips the port from each forwarded entry BEFORE Express reads the
// header, so req.ip is a bare address everywhere downstream. It only touches
// values that are unambiguously `ipv4:port` or `[ipv6]:port`; a bare IPv6
// (colons, no brackets) and anything unrecognised pass through untouched.
const net = require('net');

const V4_PORT = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/;
const V6_PORT = /^\[([0-9a-fA-F:.]+)\]:\d{1,5}$/;

function stripPort(entry) {
  const s = String(entry || '').trim();
  if (!s || net.isIP(s)) return s;
  const v4 = V4_PORT.exec(s);
  if (v4) return v4[1];
  const v6 = V6_PORT.exec(s);
  if (v6 && net.isIP(v6[1])) return v6[1];
  return s;
}

function normalizeForwardedFor(req, _res, next) {
  const raw = req.headers['x-forwarded-for'];
  if (typeof raw === 'string' && raw.length) {
    const cleaned = raw.split(',').map(stripPort).join(', ');
    if (cleaned !== raw) req.headers['x-forwarded-for'] = cleaned;
  }
  next();
}

module.exports = { normalizeForwardedFor, stripPort };
