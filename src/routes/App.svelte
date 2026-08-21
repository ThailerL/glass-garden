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
	import { nodeTypes } from '$lib/components/node-types';
	import { settingsTypes } from '$lib/components/node-settings';
	import { defaultNodeData } from '$lib/schemas';
	import ComponentSidebar from './ComponentSidebar.svelte';
	import InspectorSidebar from './InspectorSidebar.svelte';
	import { getInfrastructueState } from '$lib/infrastructure-state.svelte';

	const infraState = getInfrastructueState();
	const { screenToFlowPosition } = useSvelteFlow();

	if (infraState.nodes.length === 0) {
		infraState.addNode('service', { x: 0, y: 0 }, defaultNodeData.service);
	}

	const onDelete: OnDelete = ({ nodes, edges }) => {
		nodes.forEach((node) => infraState.deleteNodeFromStorage(node.id));
		edges.forEach((edge) => infraState.deleteEdgeFromStorage(edge.id));
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

	function onDrop({ draggedItem, sourceContainer, targetContainer }: DragDropState<string>) {
		if (sourceContainer !== 'component-sidebar' || targetContainer !== 'canvas') {
			return;
		}

		const position = screenToFlowPosition({
			x: pointerPosition.x,
			y: pointerPosition.y
		});

		infraState.addNode(draggedItem, position, defaultNodeData[draggedItem]);
	}

	const onNodeDragStop: NodeTargetEventWithPointer<MouseEvent | TouchEvent, Node> = ({
		targetNode
	}) => infraState.saveNodeInStorage(targetNode.id);

	const onConnect: OnConnect = (connection) =>
		infraState.saveEdgeInStorage(
			infraState.edges.find(
				(edge) =>
					edge.source === connection.source &&
					edge.target === connection.target &&
					edge.sourceHandle == connection.sourceHandle &&
					edge.targetHandle == connection.targetHandle
			)
		);
</script>

<div class="h-dvh w-screen" ondragover={trackPointer}>
	<ComponentSidebar />
	<div class="h-full w-full" use:droppable={{ container: 'canvas', callbacks: { onDrop } }}>
		<SvelteFlow
			bind:nodes={infraState.nodes}
			bind:edges={infraState.edges}
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
			<InspectorSidebar
				node={selectedNodes[0]}
				SettingsComponent={settingsTypes[selectedNodes[0].type]}
			/>
		{/key}
	{/if}
</div>
