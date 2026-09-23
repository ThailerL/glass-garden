import { toast } from 'svelte-sonner';
import { confirmDelete } from '$lib/components/ui/confirm-delete-dialog';
import { messageOf } from '$lib/errors';
import {
	documentKind,
	documentName,
	importOffer,
	parseDocument,
	serializeDocument,
	type GardenDocument,
	type ImportSource
} from '$lib/project-document';
import { importProject, openProject } from '$lib/projects.svelte';
import { encodeShareLink } from '$lib/share-link';

type Exported = GardenDocument | Promise<GardenDocument>;

export async function downloadDocument(exported: Exported): Promise<void> {
	let doc: GardenDocument | undefined;
	try {
		doc = await exported;
		const url = URL.createObjectURL(
			new Blob([serializeDocument(doc)], { type: 'application/json' })
		);
		const link = Object.assign(document.createElement('a'), {
			href: url,
			download: `${documentName(doc)}.gg.json`
		});
		link.click();
		URL.revokeObjectURL(url);
	} catch (error) {
		toast.error(`Could not export the ${kindOf(doc)}: ${messageOf(error)}`);
	}
}

export async function shareDocument(exported: Exported): Promise<void> {
	let doc: GardenDocument | undefined;
	try {
		doc = await exported;
		const link = await encodeShareLink(serializeDocument(doc), location.origin);
		await navigator.clipboard.writeText(link);
		toast.success('Link copied');
	} catch (error) {
		toast.error(`Could not share the ${kindOf(doc)}: ${messageOf(error)}`);
	}
}

// Undefined where the export itself failed, which leaves nothing but the general word
function kindOf(doc: GardenDocument | undefined): string {
	return doc ? documentKind(doc) : 'document';
}

export function offerImport(doc: GardenDocument, source: ImportSource): void {
	confirmDelete({
		...importOffer(doc, source),
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

// Its own input rather than one per surface, so a new place to import from costs one call
export function offerFileImport(): void {
	const input = Object.assign(document.createElement('input'), {
		type: 'file',
		accept: '.json,application/json'
	});
	input.addEventListener('change', () => {
		const file = input.files?.[0];
		if (file) void readOffer(file);
	});
	input.click();
}

async function readOffer(file: File): Promise<void> {
	try {
		offerImport(parseDocument(await file.text()), 'file');
	} catch (error) {
		toast.error(messageOf(error));
	}
}
