import { createContext } from './context';

// Which of the open node's settings the challenge owns, so a field renders as a value rather
// than an input. Set by the config form, read by the fields inside it; every project without a
// challenge leaves it unset, and nothing is fixed
const fixedContext = createContext<((setting: string) => boolean) | undefined>('FIXED_SETTINGS');

const NOTHING_FIXED = () => false;

export const setFixedSettings = fixedContext.set;

// Read in a component's setup, as any context is
export function getFixedSettings(): (setting: string) => boolean {
	return fixedContext.get() ?? NOTHING_FIXED;
}
