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
import {
	applyProjectDocument,
	buildProjectDocument,
	parseProjectDocument,
	readNodeFiles,
	type NodeFiles
} from './project-document';

export type Project = { id: string; name: string; createdAt: number };

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

function writeProject(project: Project) {
	localStorage.setItem(`${PROJECT_PREFIX}${project.id}`, JSON.stringify(project));
}

export function renameProject(id: string, name: string) {
	const project = getProject(id);
	if (!project) return;
	project.name = name;
	writeProject(project);
}

export function createProject(name: string, build: (graph: GraphState) => void): Project {
	const project: Project = { id: nanoid(8), name, createdAt: Date.now() };
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
	const prefix = graphKeyPrefix(project.id);
	const nodes = readByPrefix<Node>(`${prefix}node:`).flatMap((node) => loadNode(node) ?? []);
	const edges = readByPrefix<Edge>(`${prefix}edge:`);
	const editable = nodes.filter((node) => getResourceDefinition(node.type).hasEditableFiles);
	const files: Record<string, NodeFiles> = {};
	if (editable.length) {
		const { fs } = await getContainer();
		await Promise.all(
			editable.map(async (node) => {
				files[node.id] = await readNodeFiles(fs, nodeDirectory(node.id, project.id));
			})
		);
	}
	return buildProjectDocument(project.name, nodes, edges, files);
}

// The record goes down before the files, so a boot in between cannot sweep them; like the
// create dialog, this leaves the ambient project pointed at the new one, so callers reload
export async function importProject(text: string): Promise<Project> {
	const doc = parseProjectDocument(text);
	let ids!: Map<string, string>;
	const project = createProject(doc.name, (graph) => {
		ids = applyProjectDocument(graph, doc);
	});
	const encoder = new TextEncoder();
	const files = Object.entries(doc.nodeFiles).flatMap(([oldId, files]) => {
		const nodeId = ids.get(oldId);
		if (!nodeId) return [];
		return Object.entries(files).map(([path, contents]) => ({
			path: `nodes/${nodeId}/${path}`,
			bytes: encoder.encode(contents)
		}));
	});
	try {
		const { fs } = await getContainer();
		await fs.writeTree(projectDirectory(project.id), files);
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
