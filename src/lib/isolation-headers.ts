// Vivari needs SharedArrayBuffer, which only a cross-origin isolated page gets. CORP is open so
// another site can frame the app. server.js and _headers carry their own copies
export const ISOLATION_HEADERS = {
	'Cross-Origin-Opener-Policy': 'same-origin',
	'Cross-Origin-Embedder-Policy': 'require-corp',
	'Cross-Origin-Resource-Policy': 'cross-origin'
};
