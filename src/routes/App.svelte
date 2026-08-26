<script lang="ts">
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
		type NodeTargetEventWithPointer,
		type OnConnect
	} from '@xyflow/svelte';
	import { droppable, type DragDropState } from '@thisux/sveltednd';
	import { resourceDefinitions, type ResourceType } from '$lib/resource-definitions';
	import ResourceSidebar from './ResourceSidebar.svelte';
	import InspectorSidebar from './InspectorSidebar.svelte';
	import { getGraphState } from '$lib/graph-state.svelte';
	import { getFileState } from '$lib/file-state.svelte';
	import { setOrchestrator } from '$lib/orchestrator.svelte';
	import OrchestratorControls from '$lib/components/OrchestratorControls.svelte';

	const graphState = getGraphState();
	const orchestrator = setOrchestrator(graphState, getFileState());
	const { screenToFlowPosition } = useSvelteFlow();

	function createNodeConfig(type: ResourceType) {
		return resourceDefinitions[type].configSchema.parse({});
	}

	if (graphState.nodes.length === 0) {
		graphState.addNode('instanceGroup', { x: 0, y: 0 }, createNodeConfig('instanceGroup'));
	}

	const nodeTypes = Object.fromEntries(
		Object.entries(resourceDefinitions).map(([resource, definition]) => [
			resource,
			definition.nodeComponent
		])
	);

	const onDelete: OnDelete = ({ nodes, edges }) => {
		nodes.forEach((node) => {
			orchestrator.remove(node.id);
			graphState.deleteNodeFromStorage(node.id);
		});
		edges.forEach((edge) => graphState.deleteEdgeFromStorage(edge.id));
	};

	let selectedNodes: Node[] = $state.raw([]);
	let selectedEdges: Edge[] = $state.raw([]);

	useOnSelectionChange(({ nodes, edges }) => {
		selectedNodes = nodes;
		selectedEdges = edges;
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

		graphState.addNode(draggedItem, position, createNodeConfig(draggedItem));
	}

	const onNodeDragStop: NodeTargetEventWithPointer<MouseEvent | TouchEvent, Node> = ({
		targetNode
	}) => {
		if (targetNode) graphState.setNodeInStorage(targetNode);
	};

	const onConnect: OnConnect = (connection) => {
		const edge = graphState.edges.find(
			(edge) =>
				edge.source === connection.source &&
				edge.target === connection.target &&
				edge.sourceHandle == connection.sourceHandle &&
				edge.targetHandle == connection.targetHandle
		);
		if (edge) graphState.setEdgeInStorage(edge);
	};
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="h-dvh w-screen" ondragover={trackPointer}>
	<OrchestratorControls />
	<ResourceSidebar />
	<div class="h-full w-full" use:droppable={{ container: 'canvas', callbacks: { onDrop } }}>
		<SvelteFlow
			bind:nodes={graphState.nodes}
			bind:edges={graphState.edges}
			{nodeTypes}
			ondelete={onDelete}
			onnodedragstop={onNodeDragStop}
			onconnect={onConnect}
			defaultEdgeOptions={{ markerEnd: { type: MarkerType.ArrowClosed } }}
			fitView
			colorMode="system"
		>
			<Controls />
			<Background />
		</SvelteFlow>
	</div>
	{#if selectedNodes.length === 1 && selectedEdges.length === 0}
		{#key selectedNodes[0].id}
			<!-- pass in a nodeId instead of node because selectedNodes is a snapshot that can get stale -->
			<InspectorSidebar nodeId={selectedNodes[0].id} />
		{/key}
	{/if}
</div>
