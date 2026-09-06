import { callerUser } from '../../../../resources/postgres/caller.js';

// PGlite serves a single database over trust auth, so everything but the port and the user is
// fixed. Each consumer connects as its own user, which is how the database tells them apart
export function connectionUrl(port: number, consumerId?: string) {
	const user = consumerId === undefined ? 'postgres' : callerUser(consumerId);
	return `postgres://${user}@localhost:${port}/postgres`;
}
