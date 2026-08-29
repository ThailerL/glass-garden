import express from 'express';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL is not set. Connect this instance group to one database node.');
}

// PORT is set by Glass Garden's orchestrator
const port = Number(process.env.PORT);
if (!port) {
  throw new Error('PORT is not set');
}

const pool = new pg.Pool({ connectionString: url });

// Without this, an idle connection dropped by a restarting database takes the process
// down with it instead of being replaced
pool.on('error', (error) => console.error('idle client error:', error.message));

// Keyed by port: ports are reserved per instance, so a restart keeps the same row
await pool.query(`CREATE TABLE IF NOT EXISTS views (
  port INTEGER PRIMARY KEY,
  hits INTEGER NOT NULL DEFAULT 0
)`);

const app = express();

app.get('/', async (req, res) => {
  try {
    // Every instance counts into the same table, so the total is shared however the load
    // balancer routes this request
    await pool.query(
      `INSERT INTO views (port, hits) VALUES ($1, 1)
       ON CONFLICT (port) DO UPDATE SET hits = views.hits + 1`,
      [port]
    );
    const { rows } = await pool.query('SELECT port, hits FROM views ORDER BY port');

    const total = rows.reduce((sum, row) => sum + row.hits, 0);
    const perInstance = rows.map((row) => `:${row.port}  ${row.hits}`).join('\n');

    res.type('text/plain').send(`Page views: ${total}\nserved by :${port}\n\n${perInstance}\n`);
  } catch (error) {
    res.status(500).type('text/plain').send(error.message);
  }
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
