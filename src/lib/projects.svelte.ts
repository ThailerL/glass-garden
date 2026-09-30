import { nanoid } from 'nanoid';
import { resolve } from '$app/paths';
import { buildTourCanvas } from './tour.svelte';
import {
	getContainer,
	nodeDirectory,
	onContainerBoot,
	projectDirectory,
	PROJECTS_ROOT,
	removeProjectFiles
} from './container';
import { deleteGraph, GraphState, readGraph } from './graph-state.svelte';
import { readByPrefix } from './storage';
import { getResourceDefinition } from './resources';
import { nodeFiles } from './files/node-files';
import { storeNodeFiles } from './files/imported-files';
import { mergeStartingCanvas } from './challenge-merge';
import {
	applyCanvasDocument,
	buildProjectDocument,
	CHALLENGE_FORMAT,
	documentName,
	goalsJudgedAlike,
	readNodeFiles,
	sameRunScript,
	treeFiles,
	type ChallengeDocument,
	type GardenDocument,
	type NodeFiles
} from './project-document';

export type Project = {
	id: string;
	name: string;
	createdAt: number;
	// The challenge as it was written: it names its nodes, so it runs this canvas as it stands
	challenge?: ChallengeDocument;
	// Which catalogue entry it was started from, where it was not imported
	builtIn?: string;
	// The embed link this is the reader's copy of, so the same link finds it again. A reset
	// carries it to the project it puts in place
	embedHash?: string;
	// The goals the best scored run met
	bestRun?: string[];
};

// What a new project carries beyond the id, name and time every project is given
type ProjectFields = Omit<Project, 'id' | 'name' | 'createdAt'>;

const PROJECT_PREFIX = 'project:';
const LAST_PROJECT_KEY = 'lastProjectId';

let projects = $state<Project[]>(readProjects());

// Oldest first, so the list reads in the order the projects were made
function readProjects(): Project[] {
	return readByPrefix<Project>(PROJECT_PREFIX).sort((a, b) => a.createdAt - b.createdAt);
}

// A challenge is stored as a project but is never called one: it belongs to the catalogue
export function listProjects(): readonly Project[] {
	return projects.filter((project) => !project.challenge);
}

// The record of a started challenge, which always carries the document it was started from
export type ChallengeProject = Project & { challenge: ChallengeDocument };

export function listChallenges(): readonly ChallengeProject[] {
	return projects.filter((project): project is ChallengeProject => !!project.challenge);
}

// A frame holds one reader's copy, so anything else carrying a link is left over from another
export function listEmbedded(): readonly Project[] {
	return projects.filter((project) => project.embedHash);
}

export function getProject(id: string): Project | undefined {
	return projects.find((project) => project.id === id);
}

export function getLastProjectId(): string | undefined {
	return localStorage.getItem(LAST_PROJECT_KEY) ?? undefined;
}

export function setLastProjectId(id: string) {
	localStorage.setItem(LAST_PROJECT_KEY, id);
}

// A full load rather than switching in place: the container, the region, the shells and much
// of the page's state all belong to the open project, and nothing tears them down. To the
// canvas, not back to where we are: the catalogue would otherwise just reload itself
export function openProject(id: string) {
	setLastProjectId(id);
	location.assign(resolve('/'));
}

function writeProject(project: Project) {
	localStorage.setItem(`${PROJECT_PREFIX}${project.id}`, JSON.stringify(project));
}

export function renameProject(id: string, name: string) {
	const project = getProject(id);
	if (!project) return;
	project.name = name;
	writeProject(project);
}

// A run that met more goals than any before it becomes the best, and says so
export function recordRun(id: string, met: readonly string[]): boolean {
	const project = getProject(id);
	if (!project || met.length <= (project.bestRun?.length ?? 0)) return false;
	project.bestRun = [...met];
	writeProject(project);
	return true;
}

export function createProject(
	name: string,
	build: (graph: GraphState) => void,
	fields: ProjectFields = {}
): Project {
	const project: Project = { id: nanoid(8), name, createdAt: Date.now(), ...fields };
	try {
		build(new GraphState(project.id));
		// Last, so nothing lists a half-built project
		writeProject(project);
	} catch (error) {
		deleteProject(project.id);
		throw error;
	}
	projects = [...projects, project];
	return project;
}

// The app always has a project open, so one is made when none exist yet or the last is deleted
export function ensureProject(): Project {
	return listProjects().at(-1) ?? createProject('My first project', buildTourCanvas);
}

export function deleteProject(id: string) {
	// Read before the graph goes, since nothing else records which nodes were this project's
	const nodeIds = readGraph(id).nodes.map((node) => node.id);

	deleteGraph(id);
	localStorage.removeItem(`${PROJECT_PREFIX}${id}`);
	projects = projects.filter((project) => project.id !== id);

	void removeProjectFiles(id, nodeIds);
}

// Read from storage rather than a GraphState, so any project exports, not just the open one.
// Only files the user can edit travel; the rest are re-laid from the resource on start
export async function exportProject(project: Project): Promise<GardenDocument> {
	// The challenge as written, so passing it on never hands out the reader's progress
	if (project.challenge) return project.challenge;
	const { nodes, edges } = readGraph(project.id);
	const editable = nodes.filter((node) => getResourceDefinition(node.type).hasEditableFiles);
	const files: Record<string, NodeFiles> = {};
	if (editable.length) {
		const { fs } = await getContainer();
		await Promise.all(
			editable.map(async (node) => {
				const directory = nodeDirectory(node.id, project.id);
				// Not laid down yet while the VM boots, so the node still has its starting files
				files[node.id] = (await fs.exists(directory))
					? await readNodeFiles(fs, directory)
					: treeFiles(nodeFiles(node));
			})
		);
	}
	return buildProjectDocument(project.name, nodes, edges, files);
}

// Like the create dialog, this leaves the ambient project pointed at the new one, so callers
// reload. The code is stored rather than mounted, because that reload would lose the write
export function importProject(
	doc: GardenDocument,
	fields: Omit<ProjectFields, 'challenge'> = {}
): Project {
	const challenge = doc.format === CHALLENGE_FORMAT ? doc : undefined;
	const canvas = doc.format === CHALLENGE_FORMAT ? doc.startingCanvas : doc;
	return createProject(
		documentName(doc),
		(graph) => {
			const ids = applyCanvasDocument(graph, canvas, challenge);
			for (const node of canvas.nodes) {
				const nodeId = ids.get(node.id);
				if (nodeId) storeNodeFiles(nodeId, node.type, canvas.nodeFiles[node.id]);
			}
		},
		{ challenge, ...fields }
	);
}

// A fresh project rather than a cleared one: deleting one already clears the region's data too
export function resetChallenge(project: Project): Project {
	if (!project.challenge) throw new Error(`${project.name} is not a challenge`);
	// Imported before the old one goes, so a failure leaves what was there
	const { builtIn, embedHash, bestRun } = project;
	const fresh = importProject(project.challenge, { builtIn, embedHash, bestRun });
	deleteProject(project.id);
	return fresh;
}

// A newer version lands on the record the reader already has, its canvas brought up to date
// around their work. Every version can: a node the author dropped is handed to the reader
export function adoptNewVersion(project: Project, challenge: ChallengeDocument): void {
	const before = project.challenge;
	if (!before) return;
	const moved = mergeStartingCanvas(project.id, before, challenge);
	project.bestRun = keptRun(project, before, challenge, moved);
	project.challenge = challenge;
	project.name = documentName(challenge);
	writeProject(project);
}

// A run belongs to the conditions it was scored under. A canvas the merge moved, or a script or
// length that plays differently, leaves nothing comparable; otherwise each goal stands or falls
// on whether this version still judges it the same way
function keptRun(
	project: Project,
	before: ChallengeDocument,
	after: ChallengeDocument,
	moved: boolean
): string[] | undefined {
	if (moved || !sameRunScript(before, after)) return undefined;
	const alike = goalsJudgedAlike(before, after);
	return project.bestRun?.filter((id) => alike.has(id));
}

// Catches project dirs whose delete was skipped because the container wasn't booted
onContainerBoot(async (container) => {
	const keep = new Set(projects.map((project) => project.id));
	const entries = await container.fs
		.readdir(PROJECTS_ROOT, { withFileTypes: true })
		.catch(() => []);
	await Promise.all(
		entries
			.filter((entry) => entry.isDirectory() && !keep.has(entry.name))
			.map((entry) =>
				container.fs.rm(projectDirectory(entry.name), { recursive: true, force: true })
			)
	);
});

// The editor route carries a node id and nothing else, so the project holding it is searched for
export function findProjectIdForNode(nodeId: string): string | undefined {
	return projects.find((project) => readGraph(project.id).nodes.some((node) => node.id === nodeId))
		?.id;
}
