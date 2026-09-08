import type { Vivari } from '@vivari/core';

// Already on every shell's PATH, and rebuilt from the runtime image on each boot - so this is
// written each time rather than mounted, and PATH is never touched
const INSTALL_DIRECTORY = '/bin';

export async function installAwsCli(container: Vivari) {
	const response = await fetch('/vendor/aws-cli/aws.js');
	if (!response.ok) {
		throw new Error('The vendored aws command is missing - run npm run vendor');
	}
	// Not writeFile, which silently drops a payload of 1 MiB or more
	const bytes = new Uint8Array(await response.arrayBuffer());
	await container.fs.writeTree(INSTALL_DIRECTORY, [{ path: 'aws', bytes }]);
}
