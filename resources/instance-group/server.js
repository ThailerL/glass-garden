import express from 'express';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL is not set. Connect this instance group to one database node.');
}

// Every instance of this server runs on the same machine, so each one needs a port of its
// own. In a real deployment they would sit on separate machines and could share one.
// Glass Garden sets PORT, which is unique across instances
const port = Number(process.env.PORT);
if (!port) {
  throw new Error('PORT is not set');
}

const pool = new pg.Pool({ connectionString: url });

// The database can restart while this server keeps running, which breaks any connection
// sitting idle. Without this handler, that would take the whole server down with it
pool.on('error', (error) => console.error('idle client error:', error.message));

const app = express();

app.get('/', async (req, res) => {
  try {
    // Done here so the server can start without a running database. 
    // Instances are identified by their assigned port
    await pool.query(`CREATE TABLE IF NOT EXISTS views (
      instance INTEGER PRIMARY KEY,
      hits INTEGER NOT NULL DEFAULT 0
    )`);

    // Every instance writes to the same database, so the total below is the whole group's
    // however the load balancer spread the requests
    await pool.query(
      `INSERT INTO views (instance, hits) VALUES ($1, 1)
       ON CONFLICT (instance) DO UPDATE SET hits = views.hits + 1`,
      [port]
    );
    const { rows } = await pool.query('SELECT instance, hits FROM views ORDER BY instance');

    const total = rows.reduce((sum, row) => sum + row.hits, 0);
    const perInstance = rows.map((row) => `:${row.instance}  ${row.hits}`).join('\n');

    res
      .type('text/plain')
      .send(`Page views: ${total}\nserved by instance on :${port}\n\n${perInstance}\n`);
  } catch (error) {
    // This server is fine, the database is not, so it answers with an error rather than
    // stopping. Printing it too means the problem shows up in the Logs tab
    console.error('database unavailable:', error.message);
    res.status(503).type('text/plain').send(`Database unavailable: ${error.message}\n`);
  }
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
