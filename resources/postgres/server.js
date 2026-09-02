import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const port = Number(process.env.PORT);
if (!port) {
  throw new Error('PORT is not set');
}

const maxConnections = Number(process.env.MAX_CONNECTIONS);
if (!maxConnections) {
  throw new Error('MAX_CONNECTIONS is not set');
}

const db = await PGlite.create('./pgdata');

// Speaks the Postgres wire protocol, so clients connect with a real driver. Connections
// past the limit are refused, standing in for Postgres's own max_connections
const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1', maxConnections });
await server.start();

console.log(`Postgres running on localhost:${port}`);

function putMetric(name, value) {
  console.log(`gg:metric/1 ${JSON.stringify({ name, value })}`);
}

// Sampled on a timer rather than reported per event: these describe the database as it
// stands, and there is no event to hang them off
let sampleFailed = false;
setInterval(async () => {
  try {
    putMetric('connections', server.getStats().activeConnections);
    const size = await db.query('SELECT pg_database_size(current_database()) AS bytes');
    putMetric('database size (MB)', Number(size.rows[0].bytes) / 1e6);
    sampleFailed = false;
  } catch (error) {
    // Once rather than every second, so a lasting failure does not bury the log
    if (!sampleFailed) console.error(`Cannot read database metrics: ${error.message}`);
    sampleFailed = true;
  }
}, 1000);
