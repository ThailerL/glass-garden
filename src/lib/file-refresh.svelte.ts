import { createContext } from './context';

// Each directory in the editor reads its own listing, but Vivari has no fs.watch and a drag
// moves a file between two directories at once. Everything that writes to the container
// bumps this instead, and every listing on screen re-reads itself
export class FileRefresh {
	revision = $state(0);

	bump() {
		this.revision++;
	}
}

const fileRefreshContext = createContext<FileRefresh>('FILE_REFRESH');

export function setFileRefresh() {
	return fileRefreshContext.set(new FileRefresh());
}

export const getFileRefresh = fileRefreshContext.get;
