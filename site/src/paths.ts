// Every URL this site writes, in one place, so the layout, the pages and the cards cannot
// disagree about where anything lives
const base = import.meta.env.BASE_URL.replace(/\/$/, '');

export const aboutPath = base;
export const challengesPath = `${base}/challenges`;
export const challengePath = (id: string) => `${challengesPath}/${id}`;

// Where the button lands: the app's own catalogue, which is what starts a challenge. Links run
// site to app only, so nothing in the app points back here
export const startPath = (id: string) => `/challenges?start=${encodeURIComponent(id)}`;
