import { toast } from 'svelte-sonner';
import { confirmDelete } from '$lib/components/ui/confirm-delete-dialog';
import { messageOf } from './errors';
import { parseProjectDocument, type ProjectDocument } from './project-document';
import { importProject, openProject } from './projects.svelte';
import { decodeShareLink, hasSharedProject } from './share-link';
import { tour } from './tour.svelte';

// Cleared on read, so neither a reload nor a cancel repeats the offer
export async function offerSharedProject() {
	const hash = location.hash;
	if (!hasSharedProject(hash)) return;
	tour.hold();
	history.replaceState(null, '', location.pathname);
	let doc: ProjectDocument;
	try {
		doc = parseProjectDocument(await decodeShareLink(hash));
	} catch (error) {
		toast.error(messageOf(error));
		return;
	}
	confirmDelete({
		title: `Import "${doc.name}"?`,
		description:
			'Someone shared this project with you. It is added beside your own projects, and nothing starts until you start it.',
		confirm: { text: 'Import', variant: 'default' },
		onConfirm: async () => {
			try {
				openProject((await importProject(doc)).id);
			} catch (error) {
				toast.error(messageOf(error));
			}
		}
	});
}
