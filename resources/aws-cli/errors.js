// Every key of dispatch.js's SERVICES, plus s3, whose verbs are hand-written over s3api
export const SERVICE_NAMES = ['dynamodb', 's3', 's3api', 'sqs'];

export const USAGE = `usage: aws <service> <operation> [--flag value ...]

  services: ${SERVICE_NAMES.join(', ')}

Operations and flags are the real AWS CLI's: --kebab-case names the SDK input key, so
--queue-url is QueueUrl. A flag value that looks like JSON is passed as JSON; pass a whole
input document with --cli-input-json instead when a value's type is ambiguous.

Credentials, region and endpoint come from the environment, which the Config tab shows for shells
spawned from resources on the canvas. The admin shell has access to every resource on the canvas.
`;

// Carries the service it is about, if any, so reportError can link its reference page
export class UsageError extends Error {
	constructor(message, service) {
		super(message);
		this.service = service;
	}
}

const referenceUrl = (service) =>
	`\noperations and their flags: https://docs.aws.amazon.com/cli/latest/reference/${service}/`;

// A region denial arrives as an ordinary SDK error, so its signpost message needs no special case
export function reportError(error) {
	if (error instanceof UsageError) {
		const reference = error.service ? referenceUrl(error.service) : '';
		process.stderr.write(`aws: ${error.message}${reference}\n\n${USAGE}`);
		process.exit(2);
	}
	process.stderr.write(`aws: ${describe(error)}\n`);
	process.exit(1);
}

// A refused connection is an empty AggregateError; the reason is only in its causes
function describe(error) {
	if (error?.errors?.length) return describe(error.errors[0]);
	const name = error?.name && error.name !== 'Error' ? `${error.name}: ` : '';
	return `${name}${error?.message || error}`;
}
