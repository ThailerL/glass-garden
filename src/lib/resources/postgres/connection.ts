// PGlite serves a single database over trust auth, so everything but the port is fixed
export function connectionUrl(port: number) {
	return `postgres://postgres@localhost:${port}/postgres`;
}
