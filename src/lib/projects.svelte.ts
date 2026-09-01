import { nanoid } from 'nanoid';
import { templates, type TemplateId } from './templates';
import { onContainerBoot, projectDirectory, PROJECTS_ROOT, removeProjectFiles } from './container';
import { GRAPH_PREFIX, GraphState, graphKeyPrefix } from './graph-state.svelte';
import { keysWithPrefix, readByPrefix } from './storage';

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
