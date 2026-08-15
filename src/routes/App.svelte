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
	import ComponentSidebar from './ComponentSidebar.svelte';
	import LoadBalancerNode from '$lib/components/nodes/LoadBalancerNode.svelte';
	import FunctionNode from '$lib/components/nodes/FunctionNode.svelte';
	import ServiceNode from '$lib/components/nodes/ServiceNode.svelte';
	import FunctionSettings from '$lib/components/settings/FunctionSettings.svelte';
	import LoadBalancerSettings from '$lib/components/settings/LoadBalancerSettings.svelte';
	import ServiceSettings from '$lib/components/settings/ServiceSettings.svelte';
	import { defaultNodeData } from '$lib/schemas';
	import InspectorSidebar from './InspectorSidebar.svelte';
	import { useDnD } from './DnDProvider.svelte';
	import {
		loadEdgesFromLocalStorage,
		loadNodesFromLocalStorage,
		removeEdgeFromLocalStorage,
		removeNodeFromLocalStorage,
		setEdgeInLocalStorage,
		setNodeInLocalStorage
	} from '$lib/utils';

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

	const type = useDnD();

	const onDragOver = (event: DragEvent) => {
		event.preventDefault();

		if (event.dataTransfer) {
			event.dataTransfer.dropEffect = 'move';
		}
	};

	const onDrop = (event: DragEvent) => {
		event.preventDefault();

		if (!type.current) {
			return;
		}

		const position = screenToFlowPosition({
			x: event.clientX,
			y: event.clientY
		});

		const newNode = {
			id: uuidv4(),
			type: type.current,
			position,
			data: defaultNodeData[type.current],
			origin: [0.5, 0.5]
		} satisfies Node;

		nodes = [...nodes, newNode];
		setNodeInLocalStorage(newNode);
	};

	const onNodeDragStop: NodeTargetEventWithPointer<MouseEvent | TouchEvent, Node> = ({
		targetNode
	}) => setNodeInLocalStorage(targetNode);

	const onConnect: OnConnect = (connection) =>
		setEdgeInLocalStorage(
			edges.find(
				(edge) =>
					edge.source == connection.source &&
					edge.target == connection.target &&
					edge.sourceHandle == connection.sourceHandle &&
					edge.targetHandle == connection.targetHandle
			)
		);
</script>

<ComponentSidebar />
<div style:width="100vw" style:height="100vh">
	<SvelteFlow
		bind:nodes
		bind:edges
		{nodeTypes}
		ondelete={onDelete}
		onnodedragstop={onNodeDragStop}
		onconnect={onConnect}
		ondragover={onDragOver}
		ondrop={onDrop}
		defaultEdgeOptions={{ markerEnd: { type: MarkerType.ArrowClosed } }}
		fitView
		colorMode="system"
	>
		<Controls />
		<Background />
	</SvelteFlow>
</div>
{#if selectedNodes.length == 1 && selectedEdges.length == 0}
	{#key selectedNodes[0].id}
		<InspectorSidebar
			node={selectedNodes[0]}
			InspectorComponent={settingsTypes[selectedNodes[0].type]}
		/>
	{/key}
{/if}
