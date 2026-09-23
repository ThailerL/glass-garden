import { toast } from 'svelte-sonner';
import { messageOf } from './errors';
import { offerImport } from './document-transfer';
import { parseDocument } from './project-document';
import { decodeShareLink, hasSharedProject } from './share-link';
import { tour } from './tour.svelte';

// Cleared on read, so neither a reload nor a cancel repeats the offer
export async function offerSharedProject() {
	const hash = location.hash;
	if (!hasSharedProject(hash)) return;
	tour.hold();
	history.replaceState(null, '', location.pathname);
	try {
		offerImport(parseDocument(await decodeShareLink(hash)), 'link');
	} catch (error) {
		toast.error(messageOf(error));
	}
}
