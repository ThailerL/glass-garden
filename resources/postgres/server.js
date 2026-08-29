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
