// The `aws` command, bundled by scripts/vendor-aws-cli.mjs and installed at /bin/aws by
// src/lib/aws-cli.ts. The commands, the argument parsing and the s3 verbs are
// pocket-region's; this file is what makes them speak to a region in another process, as
// the caller the shell was given.
import { readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { awsCli } from 'pocket-region/cli';
// Bundled rather than imported on demand: the VM has no node_modules for a runtime import
// to resolve against, so every client the CLI can reach has to be named here
import * as s3 from '@aws-sdk/client-s3';
import * as sqs from '@aws-sdk/client-sqs';
import * as dynamodb from '@aws-sdk/client-dynamodb';
import * as lambda from '@aws-sdk/client-lambda';

// Endpoint, region and credentials all come from the environment the shell was given. The
// access key is the calling node's id, which is how the region knows who is asking
const endpoint = process.env.AWS_ENDPOINT_URL;
const target = new URL(endpoint);
const credentials = {
	accessKeyId: process.env.AWS_ACCESS_KEY_ID,
	secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
};

// The region is a process of its own, so a command is a request over its socket rather than
// an in-process call. Only the path travels from the SDK's request; the host is the endpoint's
function dispatch({ method, path, headers, body }) {
	return new Promise((resolve, reject) => {
		const request = http.request(
			{ host: target.hostname, port: target.port, path, method, headers },
			(response) => {
				const chunks = [];
				response.on('data', (chunk) => chunks.push(chunk));
				response.on('end', () =>
					resolve({
						status: response.statusCode,
						headers: response.headers,
						body: Buffer.concat(chunks)
					})
				);
			}
		);
		request.on('error', reject);
		request.end(body);
	});
}

// Given rather than found: pocket-region finds these itself through a runtime import, and
// every other import in this bundle is resolved at build time because the VM has no
// node_modules. Handing them over keeps that one rule for the whole file
const files = { read: readFile, write: writeFile };

// The usage text names the services this build has, from the modules above; the note is the
// part only Glass Garden can tell someone
const note = `Credentials, region and endpoint come from the environment, which the Config tab shows for shells
spawned from resources on the canvas. The admin shell has access to every resource on the canvas.`;

const aws = awsCli(
	{ dispatch },
	{ modules: { s3, sqs, dynamodb, lambda }, files, client: { endpoint, credentials }, note }
);

const { stdout, stderr, code } = await aws(process.argv.slice(2));
if (stdout) process.stdout.write(stdout);
if (stderr) process.stderr.write(stderr);
process.exitCode = code;
