// PGlite serves a single database over trust auth, so everything but the port is fixed. Every
// consumer is handed the same address: the canvas tells them apart by their connections
export function connectionUrl(port: number) {
	return `postgres://postgres@localhost:${port}/postgres`;
}
