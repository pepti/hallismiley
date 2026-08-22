'use strict';

// One memory reading, shared by /ready and the periodic alert.
//
// These used to be two separate calculations, and neither was right here:
// both divided heapUsed by heapTotal — but heapTotal is only the heap V8 has
// grown SO FAR. It expands on demand, so the ratio sits near the top of its
// range on any healthy process. In icelandicstore that fired a
// `severity: critical, security: true` "High memory usage" alert every 60
// seconds on production for a 44 MB process. Ported from its fix (#180).
//
// Both callers now read from here so they cannot drift apart again.
//
// ⚠️ heap_size_limit is V8's ceiling (~4 GB on 64-bit unless
// --max-old-space-size says otherwise), NOT the container's memory limit — a B1
// App Service instance caps around 1.75 GB. heapRatio therefore only predicts an
// OOM when the V8 heap is the binding constraint; a leak that grows RSS can still
// get the container killed with this reading green. rssMb is returned so the real
// figure stays visible, but nothing alerts on it yet — that needs a known
// container limit, which the process cannot discover reliably on its own.
const v8 = require('v8');

function readMemory() {
  const mem       = process.memoryUsage();
  const heapLimit = v8.getHeapStatistics().heap_size_limit;
  const heapRatio = heapLimit > 0 ? mem.heapUsed / heapLimit : 0;

  return {
    heapRatio,
    heapUsedMb:  Math.round(mem.heapUsed  / 1024 / 1024),
    heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
    heapLimitMb: Math.round(heapLimit     / 1024 / 1024),
    rssMb:       Math.round(mem.rss       / 1024 / 1024),
    ratioPct:    `${(heapRatio * 100).toFixed(1)}%`,
  };
}

module.exports = { readMemory };
