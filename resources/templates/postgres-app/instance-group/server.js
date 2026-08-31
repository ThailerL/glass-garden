import express from 'express';
import pg from 'pg';
import { readFile } from 'node:fs/promises';

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL is not set. Connect this instance group to one database node.');
}

// Glass Garden gives every instance its own PORT, because they all share one machine here.
// In a real deployment they would each be on their own machine, and could all listen on the same port.
const port = Number(process.env.PORT);
if (!port) {
  throw new Error('PORT is not set');
}

const pool = new pg.Pool({ connectionString: url });

// An idle connection breaks when the database restarts; unhandled, that error stops the server
pool.on('error', (error) => console.error('idle client error:', error.message));

// Read once, so editing index.html takes a restart, same as editing this file
const page = await readFile('public/index.html', 'utf8');

function render(values) {
  return page.replace(/{{(\w+)}}/g, (_, name) => values[name]);
}

const app = express();

// Serves style.css. index.html is read above instead, since it has holes to fill
app.use(express.static('public', { index: false }));

app.get('/', async (req, res) => {
  try {
    // Done here so the server can start without a running database
    await pool.query(`CREATE TABLE IF NOT EXISTS views (
      instance INTEGER PRIMARY KEY,
      count INTEGER NOT NULL DEFAULT 0
    )`);

    // Every instance writes to the same database, so the total below is the whole group's
    await pool.query(
      `INSERT INTO views (instance, count) VALUES ($1, 1)
       ON CONFLICT (instance) DO UPDATE SET count = views.count + 1`,
      [port]
    );
    const { rows } = await pool.query('SELECT instance, count FROM views ORDER BY instance');

    const total = rows.reduce((sum, row) => sum + row.count, 0);
    // The only markup built here, because it is the one part that varies in length
    const bars = rows
      .map(
        (row) => `<li class="${row.instance === port ? 'serving' : ''}">
          <span>:${row.instance}</span>
          <span class="bar" style="width: ${(row.count / total) * 100}%"></span>
          <span class="count">${row.count}</span>
        </li>`
      )
      .join('');

    res.type('html').send(render({ port, total, bars }));
  } catch (error) {
    // This server is fine, the database is not, so it answers 503 rather than stopping
    console.error('database unavailable:', error.message);
    res.status(503).type('text/plain').send(`Database unavailable: ${error.message}\n`);
  }
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
