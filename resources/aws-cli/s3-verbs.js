import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import {
	CopyObjectCommand,
	CreateBucketCommand,
	DeleteObjectCommand,
	GetObjectCommand,
	ListBucketsCommand,
	ListObjectsV2Command,
	PutObjectCommand
} from '@aws-sdk/client-s3';
import { clientFor } from './dispatch.js';
import { UsageError } from './errors.js';

// Conveniences over s3api operations, as they are in the real CLI

export function parseS3Uri(value) {
	if (!value?.startsWith('s3://')) return undefined;
	const rest = value.slice('s3://'.length);
	const slash = rest.indexOf('/');
	if (slash === -1) return { Bucket: rest, Key: '' };
	return { Bucket: rest.slice(0, slash), Key: rest.slice(slash + 1) };
}

const stamp = (date) => (date ? new Date(date).toISOString().slice(0, 19).replace('T', ' ') : '');

export function formatBuckets(buckets = []) {
	return buckets.map((bucket) => `${stamp(bucket.CreationDate)} ${bucket.Name}`);
}

export function formatObjects({ CommonPrefixes = [], Contents = [] }) {
	return [
		...CommonPrefixes.map((prefix) => `${' '.repeat(27)}PRE ${prefix.Prefix}`),
		...Contents.map((object) => `${stamp(object.LastModified)} ${String(object.Size).padStart(10)} ${object.Key}`)
	];
}

const print = (lines) => lines.forEach((line) => process.stdout.write(`${line}\n`));

async function list(client, target) {
	if (!target) {
		const { Buckets } = await client.send(new ListBucketsCommand({}));
		return print(formatBuckets(Buckets));
	}
	const uri = parseS3Uri(target);
	if (!uri) throw new UsageError(`"${target}" is not an s3:// URI`, 's3');
	const response = await client.send(
		new ListObjectsV2Command({ Bucket: uri.Bucket, Prefix: uri.Key, Delimiter: '/' })
	);
	print(formatObjects(response));
}

async function copy(client, from, to) {
	if (!from || !to) throw new UsageError('cp needs a source and a destination', 's3');
	const source = parseS3Uri(from);
	const destination = parseS3Uri(to);
	if (!source && !destination) throw new UsageError('cp needs at least one s3:// path', 's3');

	if (destination) {
		// A destination naming only a bucket, or ending in /, keeps the source's file name
		const Key = destination.Key && !destination.Key.endsWith('/')
			? destination.Key
			: `${destination.Key}${basename(from)}`;
		const target = `s3://${destination.Bucket}/${Key}`;
		if (source) {
			const CopySource = `${source.Bucket}/${source.Key}`;
			await client.send(new CopyObjectCommand({ Bucket: destination.Bucket, Key, CopySource }));
			return process.stdout.write(`copy: ${from} to ${target}\n`);
		}
		await client.send(
			new PutObjectCommand({ Bucket: destination.Bucket, Key, Body: await readFile(from) })
		);
		return process.stdout.write(`upload: ${from} to ${target}\n`);
	}

	const { Body } = await client.send(new GetObjectCommand(source));
	await writeFile(to, await Body.transformToByteArray());
	process.stdout.write(`download: ${from} to ${to}\n`);
}

async function remove(client, target) {
	const uri = parseS3Uri(target);
	if (!uri?.Key) throw new UsageError('rm needs an s3://bucket/key path', 's3');
	await client.send(new DeleteObjectCommand(uri));
	process.stdout.write(`delete: ${target}\n`);
}

async function makeBucket(client, target) {
	const uri = parseS3Uri(target);
	if (!uri?.Bucket) throw new UsageError('mb needs an s3://bucket path', 's3');
	await client.send(new CreateBucketCommand({ Bucket: uri.Bucket }));
	process.stdout.write(`make_bucket: ${uri.Bucket}\n`);
}

const VERBS = { cp: copy, ls: list, mb: makeBucket, rm: remove };

export async function runS3Verb([verb, ...rest]) {
	const run = VERBS[verb];
	if (!run) {
		throw new UsageError(
			`unknown s3 command "${verb ?? ''}" - s3 takes ${Object.keys(VERBS).join(', ')}`,
			's3'
		);
	}
	await run(clientFor('s3api'), ...rest);
}
