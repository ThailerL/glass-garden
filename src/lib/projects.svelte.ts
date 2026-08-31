import { nanoid } from 'nanoid';
import { templates, type TemplateId } from './templates';
import { removeNodeFiles } from './container';
import { GRAPH_PREFIX, GraphState, graphKeyPrefix } from './graph-state.svelte';

export type Project = { id: string; name: string; createdAt: number };

const PROJECT_PREFIX = 'project:';
const LAST_PROJECT_KEY = 'lastProjectId';

let projects = $state<Project[]>(readProjects());

function readProjects(): Project[] {
	return Object.keys(localStorage)
		.filter((key) => key.startsWith(PROJECT_PREFIX))
		.flatMap((key) => {
			// An unreadable entry is skipped and left in storage, the way stored nodes are
			try {
				return [JSON.parse(localStorage[key]) as Project];
			} catch {
				return [];
			}
		})
		.sort((a, b) => a.createdAt - b.createdAt);
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

export function createProject(name: string, templateId: TemplateId): Project {
	const project: Project = { id: nanoid(8), name, createdAt: Date.now() };
	writeProject(project);
	projects = [...projects, project];
	templates[templateId].build(new GraphState(project.id));
	return project;
}

// The app always has a project open, so one is made when none exist yet or the last is deleted
export function ensureProject(): Project {
	return projects.at(-1) ?? createProject('My first project', 'loadBalancedApp');
}

export function deleteProject(id: string) {
	const prefix = graphKeyPrefix(id);
	const nodePrefix = `${prefix}node:`;
	const keys = Object.keys(localStorage).filter((key) => key.startsWith(prefix));

	// Read before the keys go, since nothing else records which nodes were this project's
	const nodeIds = keys
		.filter((key) => key.startsWith(nodePrefix))
		.map((key) => key.slice(nodePrefix.length));

	for (const key of keys) localStorage.removeItem(key);
	localStorage.removeItem(`${PROJECT_PREFIX}${id}`);
	projects = projects.filter((project) => project.id !== id);

	for (const nodeId of nodeIds) void removeNodeFiles(nodeId);
}

// The editor route carries a node id and nothing else, so the project it belongs to is read
// back off the key holding it
export function findProjectIdForNode(nodeId: string): string | undefined {
	const suffix = `:node:${nodeId}`;
	const key = Object.keys(localStorage).find(
		(key) => key.startsWith(GRAPH_PREFIX) && key.endsWith(suffix)
	);
	return key?.slice(GRAPH_PREFIX.length, key.length - suffix.length);
}
