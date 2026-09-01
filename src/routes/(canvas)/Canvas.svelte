<script lang="ts">
	import { untrack } from 'svelte';
	import {
		SvelteFlow,
		Controls,
		Background,
		MarkerType,
		useSvelteFlow,
		type Node,
		useOnSelectionChange,
		type Edge,
		type OnDelete,
		type OnBeforeDelete,
		type NodeTargetEventWithPointer,
		type OnConnect,
		type IsValidConnection
	} from '@xyflow/svelte';
	import { droppable, type DragDropState } from '@thisux/sveltednd';
	import {
		canConnect,
		getResourceDefinition,
		resourceDefinitions,
		type ResourceType
	} from '$lib/resources';
	import { confirmDelete } from '$lib/components/ui/confirm-delete-dialog';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import ResourceNode from './ResourceNode.svelte';
	import ProjectsGroup from './ProjectsGroup.svelte';
	import ResourcesGroup from './ResourcesGroup.svelte';
	import InspectorSidebar from '$lib/components/InspectorSidebar.svelte';
	import { inspectorState } from '$lib/inspector-state.svelte';
	import { getGraphState, nodeName } from '$lib/graph-state.svelte';
	import { getOrchestrator } from '$lib/orchestrator.svelte';
	import OrchestratorControls from './OrchestratorControls.svelte';
	import TourOverlay from '$lib/components/TourOverlay.svelte';
	import Workspace from '$lib/components/Workspace.svelte';
	import { tour } from '$lib/tour.svelte';

	const graphState = getGraphState();
	const orchestrator = getOrchestrator();
	const { screenToFlowPosition } = useSvelteFlow();

	// Offered once, on a first visit: the tour reads the canvas it is about to point at
	tour.begin(graphState.nodes);

	// Every resource type renders through the same component, which reads its icon and
	// handles from the node's own definition
	const nodeTypes = Object.fromEntries(
		Object.keys(resourceDefinitions).map((resource) => [resource, ResourceNode])
	);

	// A node's directory goes with it, so the resources holding anything worth keeping ask
	// before the graph has parted with them
	const onBeforeDelete: OnBeforeDelete = ({ nodes }) => {
		const withContents = nodes.filter((node) => {
			const { ownsStoredData, hasEditableFiles } = getResourceDefinition(node.type);
			return ownsStoredData || hasEditableFiles;
		});
		if (withContents.length === 0) return Promise.resolve(true);

		const names = withContents.map(nodeName);
		return new Promise((resolve) => {
			confirmDelete({
				title: nodes.length === 1 ? `Delete "${names[0]}"?` : `Delete ${nodes.length} resources?`,
				description: `The files and data in ${names.join(', ')} are deleted too, and cannot be recovered.`,
				onConfirm: async () => resolve(true),
				onCancel: () => resolve(false)
			});
		});
	};

	const onDelete: OnDelete = ({ nodes, edges }) => {
		nodes.forEach((node) => graphState.deleteNodeFromStorage(node.id));
		edges.forEach((edge) => graphState.deleteEdgeFromStorage(edge.id));

		nodes.forEach((node) => orchestrator.remove(node.id));
		// A deleted edge changes what its source routes to
		edges.forEach((edge) => orchestrator.refresh(edge.source));
	};

	let selectedEdges: Edge[] = $state.raw([]);

	useOnSelectionChange(({ nodes, edges }) => {
		selectedEdges = edges;
		graphState.selectedNodeId = nodes.length === 1 ? nodes[0].id : undefined;
	});

	const restoredNodeId = untrack(() => graphState.selectedNodeId);
	const savedViewport = untrack(() => graphState.viewport);
	if (restoredNodeId) graphState.select(restoredNodeId);

	// Read from the restored id rather than from the selection callback, which announces changes
	// only: a return from the editor mounts the flow with its node already selected
	const showsInspector = $derived(!!graphState.selectedNodeId && selectedEdges.length === 0);

	// Once the panel is gone the next one is a fresh arrival rather than a swap, so it opens without the fade
	$effect(() => {
		if (!showsInspector) inspectorState.shownNodeId = undefined;
	});

	let pointerPosition = { x: 0, y: 0 };
	function trackPointer(e: MouseEvent | PointerEvent) {
		pointerPosition = { x: e.clientX, y: e.clientY };
	}

	function onDrop({ draggedItem, sourceContainer, targetContainer }: DragDropState<ResourceType>) {
		if (sourceContainer !== 'component-sidebar' || targetContainer !== 'canvas') {
			return;
		}

		const position = screenToFlowPosition({
			x: pointerPosition.x,
			y: pointerPosition.y
		});

		const node = graphState.addNode(draggedItem, position);
		// Reserves the new node's ports before it first renders
		orchestrator.refresh(node.id);
	}

	const onNodeDragStop: NodeTargetEventWithPointer<MouseEvent | TouchEvent, Node> = ({
		targetNode
	}) => {
		if (targetNode) graphState.setNodeInStorage(targetNode);
	};

	const isValidConnection: IsValidConnection = ({ source, target }) => {
		const sourceNode = graphState.getNode(source);
		const targetNode = graphState.getNode(target);
		return !!sourceNode && !!targetNode && canConnect(sourceNode, targetNode);
	};

	const onConnect: OnConnect = (connection) => {
		const edge = graphState.edges.find(
			(edge) =>
				edge.source === connection.source &&
				edge.target === connection.target &&
				edge.sourceHandle == connection.sourceHandle &&
				edge.targetHandle == connection.targetHandle
		);
		if (edge) {
			orchestrator.refresh(edge.source);
			graphState.setEdgeInStorage(edge);
		}
	};
</script>

{#snippet leftSidebar()}
	<Sidebar.Root collapsible="none" class="w-full!">
		<Sidebar.Content class="gap-0 pt-2">
			<ProjectsGroup />
			<Sidebar.Separator class="my-2" />
			<ResourcesGroup />
		</Sidebar.Content>
	</Sidebar.Root>
{/snippet}

{#snippet mainContent()}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="h-full w-full"
		ondragover={trackPointer}
		use:droppable={{ container: 'canvas', callbacks: { onDrop } }}
	>
		<SvelteFlow
			bind:nodes={graphState.nodes}
			bind:edges={graphState.edges}
			{nodeTypes}
			onbeforedelete={onBeforeDelete}
			ondelete={onDelete}
			onnodedragstop={onNodeDragStop}
			onconnect={onConnect}
			{isValidConnection}
			defaultEdgeOptions={{ markerEnd: { type: MarkerType.ArrowClosed } }}
			onmoveend={(_, viewport) => (graphState.viewport = viewport)}
			initialViewport={savedViewport}
			fitView={!savedViewport}
			colorMode="system"
		>
			<Controls />
			<Background />
		</SvelteFlow>
	</div>
{/snippet}

{#snippet inspector()}
	{#if graphState.selectedNodeId}
		{#key graphState.selectedNodeId}
			<InspectorSidebar nodeId={graphState.selectedNodeId} />
		{/key}
	{/if}
{/snippet}

<OrchestratorControls />

<TourOverlay />

<Workspace {leftSidebar} {mainContent} rightSidebar={showsInspector ? inspector : undefined} />
