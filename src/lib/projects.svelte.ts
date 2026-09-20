import { nanoid } from 'nanoid';
import { buildTourCanvas } from './tour.svelte';
import type { Edge, Node } from '@xyflow/svelte';
import {
	getContainer,
	nodeDirectory,
	onContainerBoot,
	projectDirectory,
	PROJECTS_ROOT,
	removeProjectFiles
} from './container';
import { GRAPH_PREFIX, GraphState, graphKeyPrefix, loadNode } from './graph-state.svelte';
import { keysWithPrefix, readByPrefix } from './storage';
import { getResourceDefinition } from './resources';
import { nodeFiles } from './files/node-files';
import { fileTree } from './files/file-tree';
import {
	applyCanvasDocument,
	buildProjectDocument,
	CHALLENGE_FORMAT,
	documentName,
	readNodeFiles,
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
	// The goals the best scored run met
	bestRun?: string[];
};

const PROJECT_PREFIX = 'project:';
const LAST_PROJECT_KEY = 'lastProjectId';

let projects = $state<Project[]>(readProjects());

// Oldest first, so the list reads in the order the projects were made
function readProjects(): Project[] {
	return readByPrefix<Project>(PROJECT_PREFIX).sort((a, b) => a.createdAt - b.createdAt);
}

export function listProjects(): readonly Project[] {
	return projects;
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

// Reloads rather than switching in place: the container, the region, the shells and much of
// the page's state all belong to the open project, and nothing tears them down
export function openProject(id: string) {
	setLastProjectId(id);
	location.reload();
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

// A run that met more goals than any before it becomes the best
export function recordRun(id: string, met: readonly string[]) {
	const project = getProject(id);
	if (!project || met.length <= (project.bestRun?.length ?? 0)) return;
	project.bestRun = [...met];
	writeProject(project);
}

export function createProject(
	name: string,
	build: (graph: GraphState) => void,
	challenge?: ChallengeDocument
): Project {
	const project: Project = { id: nanoid(8), name, createdAt: Date.now(), challenge };
	writeProject(project);
	projects = [...projects, project];
	build(new GraphState(project.id));
	return project;
}

// The app always has a project open, so one is made when none exist yet or the last is deleted
export function ensureProject(): Project {
	return projects.at(-1) ?? createProject('My first project', buildTourCanvas);
}

export function deleteProject(id: string) {
	const prefix = graphKeyPrefix(id);
	const nodePrefix = `${prefix}node:`;
	const keys = keysWithPrefix(prefix);

	// Read before the keys go, since nothing else records which nodes were this project's
	const nodeIds = keys
		.filter((key) => key.startsWith(nodePrefix))
		.map((key) => key.slice(nodePrefix.length));

	for (const key of keys) localStorage.removeItem(key);
	localStorage.removeItem(`${PROJECT_PREFIX}${id}`);
	projects = projects.filter((project) => project.id !== id);

	void removeProjectFiles(id, nodeIds);
}

// Read from storage rather than a GraphState, so any project exports, not just the open one.
// Only files the user can edit travel; the rest are re-laid from the resource on start
export async function exportProject(project: Project): Promise<string> {
	// The challenge as written, so passing it on never hands out the reader's progress
	if (project.challenge) return JSON.stringify(project.challenge, null, '\t');
	const prefix = graphKeyPrefix(project.id);
	const nodes = readByPrefix<Node>(`${prefix}node:`).flatMap((node) => loadNode(node) ?? []);
	const edges = readByPrefix<Edge>(`${prefix}edge:`);
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

// The record goes down before the files, so a boot in between cannot sweep them; like the
// create dialog, this leaves the ambient project pointed at the new one, so callers reload
export async function importProject(doc: GardenDocument): Promise<Project> {
	const challenge = doc.format === CHALLENGE_FORMAT ? doc : undefined;
	const canvas = doc.format === CHALLENGE_FORMAT ? doc.startingCanvas : doc;
	let ids!: Map<string, string>;
	const project = createProject(
		documentName(doc),
		(graph) => {
			ids = applyCanvasDocument(graph, canvas, challenge !== undefined);
		},
		challenge
	);
	const files = Object.entries(canvas.nodeFiles).flatMap(([oldId, files]) => {
		const nodeId = ids.get(oldId);
		if (!nodeId) return [];
		return Object.entries(files).map(([path, contents]) => [`nodes/${nodeId}/${path}`, contents]);
	});
	try {
		const container = await getContainer();
		await container.mount(fileTree(Object.fromEntries(files)), {
			mountPoint: projectDirectory(project.id)
		});
	} catch (error) {
		deleteProject(project.id);
		throw error;
	}
	return project;
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

// The editor route carries a node id and nothing else, so the project it belongs to is read
// back off the key holding it
export function findProjectIdForNode(nodeId: string): string | undefined {
	const suffix = `:node:${nodeId}`;
	const key = keysWithPrefix(GRAPH_PREFIX).find((key) => key.endsWith(suffix));
	return key?.slice(GRAPH_PREFIX.length, key.length - suffix.length);
}
