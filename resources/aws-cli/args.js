import { SERVICE_NAMES, UsageError } from './errors.js';

export function pascalCase(name) {
	return name.replace(/(^|-)([a-z0-9])/g, (_, __, character) => character.toUpperCase());
}

export const kebabCase = (name) => name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

// String-typed in the SDK, and often JSON themselves, so they must not be parsed
const STRING_FLAGS = new Set(['MessageBody', 'Body', 'Payload']);

export function parseValue(key, raw) {
	if (STRING_FLAGS.has(key)) return raw;
	if (!/^[[{]|^-?\d|^true$|^false$|^null$/.test(raw)) return raw;
	try {
		return JSON.parse(raw);
	} catch {
		return raw;
	}
}

export function parseArgs(argv) {
	const [service, operation, ...rest] = argv;
	if (!service) throw new UsageError('no service given');
	// Before the operation check, so a typo is not linked to a reference page that does not exist
	if (!SERVICE_NAMES.includes(service)) throw new UsageError(`unknown service "${service}"`);
	if (!operation) throw new UsageError(`no operation given for "${service}"`, service);

	let params = {};
	for (let index = 0; index < rest.length; index += 1) {
		const flag = rest[index];
		if (!flag.startsWith('--')) throw new UsageError(`unexpected argument "${flag}"`, service);
		const key = pascalCase(flag.slice(2));
		const next = rest[index + 1];
		// A flag with no value is a boolean, as it is in the real CLI
		if (next === undefined || next.startsWith('--')) {
			params[key] = true;
			continue;
		}
		if (key === 'CliInputJson') {
			// Explicit flags win over the document, whichever side of it they are typed
			try {
				params = { ...JSON.parse(next), ...params };
			} catch (error) {
				throw new UsageError(`--cli-input-json is not valid JSON: ${error.message}`, service);
			}
		} else {
			params[key] = parseValue(key, next);
		}
		index += 1;
	}

	return { service, operation: pascalCase(operation), params };
}
