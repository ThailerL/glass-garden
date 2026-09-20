import { toast } from 'svelte-sonner';
import { confirmDelete } from '$lib/components/ui/confirm-delete-dialog';
import { messageOf } from './errors';
import { documentKind, documentName, parseDocument, type GardenDocument } from './project-document';
import { importProject, openProject } from './projects.svelte';
import { decodeShareLink, hasSharedProject } from './share-link';
import { tour } from './tour.svelte';

// Cleared on read, so neither a reload nor a cancel repeats the offer
export async function offerSharedProject() {
	const hash = location.hash;
	if (!hasSharedProject(hash)) return;
	tour.hold();
	history.replaceState(null, '', location.pathname);
	let doc: GardenDocument;
	try {
		doc = parseDocument(await decodeShareLink(hash));
	} catch (error) {
		toast.error(messageOf(error));
		return;
	}
	const kind = documentKind(doc);
	confirmDelete({
		title: `Import ${kind === 'challenge' ? 'the challenge ' : ''}"${documentName(doc)}"?`,
		description: `Someone shared this ${kind} with you. It will be added to your ${kind}s.`,
		confirm: { text: 'Import', variant: 'default' },
		onConfirm: async () => {
			try {
				openProject(importProject(doc).id);
			} catch (error) {
				toast.error(messageOf(error));
			}
		}
	});
}
