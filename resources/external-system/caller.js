// Shared with the canvas, so no Node built-ins
const CALLER = /^\/from\/([^/?#]+)/;

export function callerPath(nodeId) {
  return `/from/${encodeURIComponent(nodeId)}`;
}

// Who sent a request, and its path as if this service were the whole host
export function callerIn(url) {
  const match = CALLER.exec(url);
  if (!match) return { node: undefined, path: url };
  const rest = url.slice(match[0].length);
  return { node: decodeURIComponent(match[1]), path: rest.startsWith('/') ? rest : `/${rest}` };
}
