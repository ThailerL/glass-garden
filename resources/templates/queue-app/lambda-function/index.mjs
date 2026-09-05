import { randomBytes, scryptSync } from 'node:crypto';

// Real work, not a sleep. scrypt is a password hash: it is deliberately expensive, and it is
// meant to be tuned so that one hash costs about as much as you can afford. p is the knob that
// buys time without buying memory - N would need 128 MB per execution environment for this
// cost, p keeps it at 16 MB - and the right number depends on the machine. Around 500 ms here
// on the machine this template was measured on. Try halving or doubling p and watch what it
// does to the queue
const COST = { N: 16384, r: 8, p: 8 };

// A queue delivers up to ten messages per invocation, and this handler works through the whole
// batch, so one invocation is up to ten hashes - about five seconds. That is why this function
// ships with a timeout of 30 rather than Lambda's default of 3: at the default, every full
// batch would fail with "Task timed out" and go back on the queue to be delivered again.
//
// Glass Garden polls the queue on the function's behalf, exactly as the Lambda service does,
// and deletes the batch only when the handler returns. How many batches it runs at once is
// max concurrency in the Config tab - one, to begin with, which is why the backlog grows.
// Raise it and the Logs tab fills with new execution environments, each a real thread.
export async function handler(event) {
  for (const record of event.Records) {
    const { email, password } = JSON.parse(record.body);
    const salt = randomBytes(16);
    const hash = scryptSync(password, salt, 64, COST);
    console.log(`hashed ${email}: ${hash.toString('base64').slice(0, 22)}`);
  }
}
