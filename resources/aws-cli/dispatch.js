import * as s3 from '@aws-sdk/client-s3';
import * as sqs from '@aws-sdk/client-sqs';
import * as dynamodb from '@aws-sdk/client-dynamodb';
import * as lambda from '@aws-sdk/client-lambda';
import { kebabCase } from './args.js';
import { UsageError } from './errors.js';

// SDK v3 input shapes are the CLI's --cli-input-json shapes, so this table is the whole
// dispatcher; a new service is one line here and one client in scripts/vendor-aws-cli.mjs.
// forcePathStyle keeps the bucket in the URL path, where the local region expects it
const SERVICES = {
	s3api: { module: s3, Client: s3.S3Client, options: { forcePathStyle: true } },
	sqs: { module: sqs, Client: sqs.SQSClient },
	dynamodb: { module: dynamodb, Client: dynamodb.DynamoDBClient },
	lambda: { module: lambda, Client: lambda.LambdaClient }
};

// Endpoint, region and credentials all come from the environment the shell was given
export function clientFor(service) {
	const { Client, options } = SERVICES[service];
	return new Client(options);
}

export function commandFor(service, operation) {
	const Command = SERVICES[service].module[`${operation}Command`];
	if (typeof Command !== 'function') {
		throw new UsageError(`unknown operation "${kebabCase(operation)}" for "${service}"`, service);
	}
	return Command;
}

export async function dispatch({ service, operation, params }) {
	const Command = commandFor(service, operation);
	const { $metadata, ...rest } = await clientFor(service).send(new Command(params));

	// A streamed payload is what the caller asked for, so it goes to stdout as itself
	const stream = Object.keys(rest).find((key) => typeof rest[key]?.transformToByteArray === 'function');
	if (stream) {
		process.stdout.write(await rest[stream].transformToByteArray());
		delete rest[stream];
	}
	if (Object.keys(rest).length > 0) process.stdout.write(`${JSON.stringify(decoded(rest), null, 2)}\n`);
}

// A byte field is text the other side wrote - an Invoke's Payload - shown as it was written
export function decoded(output) {
	for (const [key, value] of Object.entries(output)) {
		if (!(value instanceof Uint8Array)) continue;
		const text = new TextDecoder().decode(value);
		try {
			output[key] = JSON.parse(text);
		} catch {
			output[key] = text;
		}
	}
	return output;
}
