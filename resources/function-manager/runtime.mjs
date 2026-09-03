// One execution environment: loads the handler once, then takes invocations from the
// manager through the Lambda Runtime API until it is stopped. The same loop a real
// Lambda runtime runs, against the same paths
import http from 'node:http';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const [host, apiPort] = (process.env.AWS_LAMBDA_RUNTIME_API ?? '').split(':');
if (!host || !apiPort) {
  throw new Error('AWS_LAMBDA_RUNTIME_API is not set');
}
const environmentId = process.env.AWS_LAMBDA_LOG_STREAM_NAME ?? '';
const [handlerFile, handlerName] = (process.env._HANDLER || 'index.handler').split('.');

function request(method, route, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host,
        port: Number(apiPort),
        path: `/2018-06-01/runtime/${route}`,
        method,
        headers: {
          'content-type': 'application/json',
          'x-gg-environment': environmentId,
          ...(body !== undefined && { 'content-length': Buffer.byteLength(body) }),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

const errorPayload = (error) => ({
  errorType: error?.name ?? 'Error',
  errorMessage: error?.message ?? String(error),
  stackTrace: typeof error?.stack === 'string' ? error.stack.split('\n') : [],
});

// Loaded from the working directory, which is the node's own, so the handler resolves its
// dependencies from the node's node_modules rather than from here. Either extension, as
// Lambda's own runtime takes .mjs or .js for the same handler setting
const handlerPath = ['.mjs', '.js']
  .map((extension) => path.resolve(handlerFile + extension))
  .find((candidate) => existsSync(candidate));

let handler;
try {
  if (!handlerPath) throw new Error(`There is no ${handlerFile}.mjs or ${handlerFile}.js`);
  const module = await import(pathToFileURL(handlerPath).href);
  handler = module[handlerName];
  if (typeof handler !== 'function') {
    throw new Error(
      `${path.basename(handlerPath)} does not export a function named "${handlerName}"`,
    );
  }
} catch (error) {
  console.error(`Could not load the handler: ${error.stack ?? error.message}`);
  await request('POST', 'init/error', JSON.stringify(errorPayload(error)));
  process.exit(1);
}

for (;;) {
  const next = await request('GET', 'invocation/next');
  // The manager is the only reason to be running
  if (next.status !== 200) process.exit(0);

  const requestId = next.headers['lambda-runtime-aws-request-id'];
  const context = {
    awsRequestId: requestId,
    functionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
    invokedFunctionArn: next.headers['lambda-runtime-invoked-function-arn'],
    logStreamName: environmentId,
  };

  try {
    const result = await handler(JSON.parse(next.body), context);
    await request('POST', `invocation/${requestId}/response`, JSON.stringify(result ?? null));
  } catch (error) {
    console.error(`${requestId}\tERROR\tInvoke Error\t${error?.stack ?? error}`);
    await request('POST', `invocation/${requestId}/error`, JSON.stringify(errorPayload(error)));
  }
}
