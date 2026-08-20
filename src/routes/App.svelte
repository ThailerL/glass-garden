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
	import { v4 as uuidv4 } from 'uuid';
	import { droppable, type DragDropState } from '@thisux/sveltednd';
	import ComponentSidebar from './ComponentSidebar.svelte';
	import LoadBalancerNode from '$lib/components/nodeTypes/LoadBalancerNode.svelte';
	import FunctionNode from '$lib/components/nodeTypes/FunctionNode.svelte';
	import ServiceNode from '$lib/components/nodeTypes/ServiceNode.svelte';
	import FunctionSettings from '$lib/components/settings/FunctionSettings.svelte';
	import LoadBalancerSettings from '$lib/components/settings/LoadBalancerSettings.svelte';
	import ServiceSettings from '$lib/components/settings/ServiceSettings.svelte';
	import { defaultNodeData } from '$lib/schemas';
	import InspectorSidebar from './InspectorSidebar.svelte';
	import {
		loadEdgesFromLocalStorage,
		loadNodesFromLocalStorage,
		removeEdgeFromLocalStorage,
		removeNodeFromLocalStorage,
		setEdgeInLocalStorage,
		setNodeInLocalStorage
	} from '$lib/localStorageUtils';

	const nodeTypes = {
		loadBalancer: LoadBalancerNode,
		function: FunctionNode,
		service: ServiceNode
	};

	const settingsTypes = {
		loadBalancer: LoadBalancerSettings,
		function: FunctionSettings,
		service: ServiceSettings
	};

	let nodes: Node[] = $state.raw([]);
	let edges: Edge[] = $state.raw([]);
	if (loadNodesFromLocalStorage().length === 0) {
		nodes = [
			{ id: uuidv4(), position: { x: 0, y: 0 }, type: 'service', data: defaultNodeData.service }
		];
		nodes.forEach((node) => setNodeInLocalStorage(node));
	} else {
		nodes = loadNodesFromLocalStorage();
		edges = loadEdgesFromLocalStorage();
	}

	const onDelete: OnDelete = ({ nodes, edges }) => {
		nodes.forEach((node) => removeNodeFromLocalStorage(node.id));
		edges.forEach((edge) => removeEdgeFromLocalStorage(edge.id));
	};

	let selectedNodes: Node[] = $state.raw([]);
	let selectedEdges: Edge[] = $state.raw([]);

	useOnSelectionChange(({ nodes, edges }) => {
		selectedNodes = nodes;
		selectedEdges = edges;
	});

	const { screenToFlowPosition } = useSvelteFlow();

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

		const newNode = {
			id: uuidv4(),
			type: draggedItem,
			position,
			data: defaultNodeData[draggedItem],
			origin: [0.5, 0.5]
		} satisfies Node;

		nodes = [...nodes, newNode];
		setNodeInLocalStorage(newNode);
	}

	const onNodeDragStop: NodeTargetEventWithPointer<MouseEvent | TouchEvent, Node> = ({
		targetNode
	}) => setNodeInLocalStorage(targetNode);

	const onConnect: OnConnect = (connection) =>
		setEdgeInLocalStorage(
			edges.find(
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
			bind:nodes
			bind:edges
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
				InspectorComponent={settingsTypes[selectedNodes[0].type]}
			/>
		{/key}
	{/if}
</div>
