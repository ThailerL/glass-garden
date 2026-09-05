import express from 'express';
import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3';
import { readFile } from 'node:fs/promises';

const bucket = process.env.S3_BUCKET;
if (!bucket) {
  throw new Error('S3_BUCKET is not set. Connect this instance group to one bucket node.');
}

// Glass Garden gives every instance its own PORT, because they all share one machine here.
// In a real deployment they would each be on their own machine, and could all listen on the same port.
const port = Number(process.env.PORT);
if (!port) {
  throw new Error('PORT is not set');
}

// The real AWS SDK against the local AWS region. AWS_ENDPOINT_URL, AWS_REGION and the
// credentials all arrive in the environment (you can see them in the Config tab), so
// there is nothing to configure here.
// forcePathStyle puts the bucket in the URL path - localhost:52700/notes/key. Without it the
// SDK puts it in the hostname, notes.localhost, which nothing here resolves
const s3 = new S3Client({ forcePathStyle: true });

// What the load balancer's health checks call themselves. AWS gives them a user agent of
// their own precisely so an app can tell them apart from real traffic, and this app has to,
// because the path being checked and the page being served are the same "/"
const HEALTH_CHECKER = 'ELB-HealthChecker/2.0';

const page = await readFile('public/index.html', 'utf8');

function render(values) {
  return page.replace(/{{(\w+)}}/g, (_, name) => values[name]);
}

// Notes are typed by whoever visits, so they are escaped before landing in the page's HTML
function escape(text) {
  return text.replace(/[<>&"]/g, (character) => `&#${character.charCodeAt(0)};`);
}

const app = express();

// Serves style.css. index.html is read above instead, since it has holes to fill
app.use(express.static('public', { index: false }));
app.use(express.urlencoded({ extended: false }));

app.get('/', async (req, res) => {
  // The balancer requests this same path on every instance every few seconds. Building the
  // page for those would keep the bucket's Metrics tab busy with nobody visiting. Answering
  // early is the trade a real health check makes too: it says the server is up, not that the
  // bucket behind it still is
  if (req.get('user-agent') === HEALTH_CHECKER) {
    return res.type('text/plain').send('ok');
  }

  // The bucket is the whole store: every note is one object in it. Keys are listed in order,
  // and these are named by time, so reversing puts the newest first
  const { Contents = [] } = await s3.send(new ListObjectsV2Command({ Bucket: bucket }));
  Contents.reverse();

  // Listing gives keys, not contents, so each note is one more call. Every page view is 1 + N
  // requests to the bucket, which its own Metrics tab counts
  const notes = await Promise.all(
    Contents.map(async ({ Key }) => {
      const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key }));
      // A body arrives as a stream, and the SDK gives it this helper rather than a string
      const text = await object.Body.transformToString();
      return `<li><p>${escape(text)}</p><span>${Key}</span></li>`;
    })
  );

  res.type('html').send(
    render({
      bucket,
      count: Contents.length,
      notes: notes.join('') || '<li class="empty">Nothing in the bucket yet.</li>'
    })
  );
});

app.post('/', async (req, res) => {
  const text = (req.body.note ?? '').trim();
  if (text) {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: `note-${Date.now()}.txt`,
        Body: text,
        ContentType: 'text/plain'
      })
    );
  }
  // Relative, because the preview serves this app under a path prefix, the way an app behind a
  // path-routing proxy is. A redirect to '/' would leave the app entirely
  res.redirect('./');
});

// Express hands a rejected handler here. This server is fine, the bucket is not: an edge may
// have been removed, which the region answers with a message saying so
app.use((error, req, res, next) => {
  console.error('bucket unavailable:', error.message);
  res.status(503).type('text/plain').send(`Bucket unavailable: ${error.message}\n`);
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
