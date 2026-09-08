// The `aws` command, bundled by scripts/vendor-aws-cli.mjs and installed at /bin/aws by
// src/lib/aws-cli.ts. Credentials come from the environment only: the shell cannot expand $VARS
import { parseArgs } from './args.js';
import { dispatch } from './dispatch.js';
import { runS3Verb } from './s3-verbs.js';
import { reportError, USAGE } from './errors.js';

const argv = process.argv.slice(2);

try {
	if (argv.length === 0 || argv[0] === 'help' || argv.includes('--help')) {
		process.stdout.write(USAGE);
	} else if (argv[0] === 's3') {
		await runS3Verb(argv.slice(1));
	} else {
		await dispatch(parseArgs(argv));
	}
} catch (error) {
	reportError(error);
}
