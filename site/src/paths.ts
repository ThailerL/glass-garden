// Every URL this site writes, in one place, so the layout, the pages and the cards cannot
// disagree about where anything lives
export { challengeAddress as startPath } from '../../src/lib/app-view';

export const aboutPath = '/about';
export const challengesPath = '/challenges';
export const challengePath = (id: string) => `${challengesPath}/${id}`;
