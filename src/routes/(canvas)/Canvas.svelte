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
		type OnConnect,
		type IsValidConnection
	} from '@xyflow/svelte';
	import { droppable, type DragDropState } from '@thisux/sveltednd';
	import { canConnect, resourceDefinitions, type ResourceType } from '$lib/resources';
	import ResourceNode from './ResourceNode.svelte';
	import ResourceSidebar from './ResourceSidebar.svelte';
	import InspectorSidebar from '$lib/components/InspectorSidebar.svelte';
	import { getGraphState } from '$lib/graph-state.svelte';
	import { getOrchestrator } from '$lib/orchestrator.svelte';
	import OrchestratorControls from './OrchestratorControls.svelte';
	import Workspace from '$lib/components/Workspace.svelte';

	const graphState = getGraphState();
	const orchestrator = getOrchestrator();
	const { screenToFlowPosition } = useSvelteFlow();

	if (graphState.nodes.length === 0) {
		const httpLoadBalancer = graphState.addNode('httpLoadBalancer', { x: -200, y: 0 });
		const instanceGroup = graphState.addNode('instanceGroup', { x: 0, y: 0 });
		const postgres = graphState.addNode('postgres', { x: 200, y: 0 });
		graphState.addEdge(httpLoadBalancer.id, instanceGroup.id);
		graphState.addEdge(instanceGroup.id, postgres.id);
	}

	// Every resource type renders through the same component, which reads its icon and
	// handles from the node's own definition
	const nodeTypes = Object.fromEntries(
		Object.keys(resourceDefinitions).map((resource) => [resource, ResourceNode])
	);

	const onDelete: OnDelete = ({ nodes, edges }) => {
		nodes.forEach((node) => graphState.deleteNodeFromStorage(node.id));
		edges.forEach((edge) => graphState.deleteEdgeFromStorage(edge.id));

		nodes.forEach((node) => orchestrator.remove(node.id));
		// A deleted edge changes what its source routes to
		edges.forEach((edge) => orchestrator.refresh(edge.source));
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

		graphState.addNode(draggedItem, position);
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
	<ResourceSidebar />
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
			ondelete={onDelete}
			onnodedragstop={onNodeDragStop}
			onconnect={onConnect}
			{isValidConnection}
			defaultEdgeOptions={{ markerEnd: { type: MarkerType.ArrowClosed } }}
			fitView
			colorMode="system"
		>
			<Controls />
			<Background />
		</SvelteFlow>
	</div>
{/snippet}

{#snippet inspector()}
	{#key selectedNodes[0].id}
		<!-- pass in a nodeId instead of node because selectedNodes is a snapshot that can get stale -->
		<InspectorSidebar nodeId={selectedNodes[0].id} />
	{/key}
{/snippet}

<OrchestratorControls />

<Workspace
	{leftSidebar}
	{mainContent}
	rightSidebar={selectedNodes.length === 1 && selectedEdges.length === 0 ? inspector : undefined}
/>
