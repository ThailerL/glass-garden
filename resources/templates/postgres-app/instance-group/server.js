import express from 'express';
import pg from 'pg';
import { readFile } from 'node:fs/promises';

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

// Read once rather than per request. Editing it takes a restart, same as editing this file
const page = await readFile('public/index.html', 'utf8');

function render(values) {
  return page.replace(/{{(\w+)}}/g, (_, name) => values[name]);
}

const app = express();

// Serves style.css. index.html is read above instead, since it has holes to fill
app.use(express.static('public', { index: false }));

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
    // The only markup built here, because it is the one part that varies in length
    const bars = rows
      .map(
        (row) => `<li${row.instance === port ? ' class="serving"' : ''}>
          <span class="port">:${row.instance}</span>
          <span class="bar" style="width: ${(row.hits / total) * 100}%"></span>
          <span class="hits">${row.hits}</span>
        </li>`
      )
      .join('');

    res.type('html').send(render({ port, total, bars }));
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
