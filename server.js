import http from 'node:http';
import { handler } from './build/handler.js';

// Vivari needs SharedArrayBuffer, so every response has to be cross-origin isolated - not
// just the documents a SvelteKit hook would see. adapter-node serves build/client through sirv
// before the SvelteKit handler runs, and a dedicated worker script served without COEP is
// blocked outright (ERR_BLOCKED_BY_RESPONSE) when the page that spawns it is isolated,
// which is exactly how the kernel worker is loaded
const port = Number(process.env.PORT ?? 3000);

http
	.createServer((request, response) => {
		response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
		response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
		response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
		handler(request, response);
	})
	.listen(port, () => console.log(`Glass Garden listening on ${port}`));
