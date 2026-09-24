// One address per consumer, so a call names its caller. The canvas imports this: no Node built-ins
const CALLER = /^\/from\/([^/?#]+)/;

export const callerPath = (nodeId) => `/from/${encodeURIComponent(nodeId)}`;

// Who sent a request, and its path as if this API were the whole host
export function callerIn(url) {
  const match = CALLER.exec(url);
  if (!match) return { node: undefined, path: url };
  const rest = url.slice(match[0].length);
  return { node: decodeURIComponent(match[1]), path: rest.startsWith('/') ? rest : `/${rest}` };
}
