/**
 * Preloaded into the API process by the page benchmark (node -r). Counts every
 * SQL statement the embedded database runs and reports the total on a side
 * port, so the benchmark can say how many queries one page render costs.
 * Nothing in the app loads this.
 */
const http = require('node:http');
const path = require('node:path');
const { createRequire } = require('node:module');

const apiRequire = createRequire(path.resolve(__dirname, '../../api/package.json'));
const { PGlite } = apiRequire('@electric-sql/pglite');

let queries = 0;
for (const method of ['query', 'exec']) {
  const original = PGlite.prototype[method];
  PGlite.prototype[method] = function (...args) {
    queries++;
    return original.apply(this, args);
  };
}
const originalTx = PGlite.prototype.transaction;
PGlite.prototype.transaction = function (fn) {
  return originalTx.call(this, async (tx) => {
    for (const method of ['query', 'exec']) {
      const inner = tx[method].bind(tx);
      tx[method] = (...args) => {
        queries++;
        return inner(...args);
      };
    }
    return fn(tx);
  });
};

http
  .createServer((_req, res) => res.end(String(queries)))
  .listen(Number(process.env.BENCH_COUNTER_PORT), '127.0.0.1')
  .unref();
