<script lang="ts">
	import { untrack } from 'svelte';
	import {
		SvelteFlow,
		Controls,
		Background,
		useSvelteFlow,
		type Node,
		useOnSelectionChange,
		type Edge,
		type OnDelete,
		type OnBeforeDelete,
		type NodeTargetEventWithPointer,
		type NodeEventWithPointer,
		type OnConnect,
		type IsValidConnection,
		type XYPosition
	} from '@xyflow/svelte';
	import { droppable, type DragDropState } from '@thisux/sveltednd';
	import {
		canAddEdge,
		getResourceDefinition,
		ownsStoredData,
		resourceDefinitions,
		type ResourceType
	} from '$lib/resources';
	import { confirmDelete } from '$lib/components/ui/confirm-delete-dialog';
	import { askResourceName } from '$lib/components/ResourceNameDialog.svelte';
	import { buildNameValidator } from '$lib/resources/name-on-create';
	import SquareTerminalIcon from '@lucide/svelte/icons/square-terminal';
	import { Button } from '$lib/components/ui/button';
	import * as ContextMenu from '$lib/components/ui/context-menu';
	import ShellDock from '$lib/components/ShellDock.svelte';
	import { shellSessions } from '$lib/shell-sessions.svelte';
	import ResourceNode from './ResourceNode.svelte';
	import TrafficEdge from './TrafficEdge.svelte';
	import AppSidebar from '$lib/components/AppSidebar.svelte';
	import ResourcesGroup from './ResourcesGroup.svelte';
	import InspectorSidebar from '$lib/components/InspectorSidebar.svelte';
	import { inspectorState } from '$lib/inspector-state.svelte';
	import { getGraphState, nodeName } from '$lib/graph-state.svelte';
	import { getOrchestrator } from '$lib/orchestrator.svelte';
	import { getChallengeRun } from '$lib/challenge-run.svelte';
	import OrchestratorControls from './OrchestratorControls.svelte';
	import TourOverlay from '$lib/components/TourOverlay.svelte';
	import ChallengePanel from './ChallengePanel.svelte';
	import Workspace, { PANEL_FRACTION } from '$lib/components/Workspace.svelte';
	import { IsMobile } from '$lib/hooks/is-mobile.svelte';
	import { IsCompact } from '$lib/hooks/is-compact.svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import { tour } from '$lib/tour.svelte';

	const graphState = getGraphState();
	const orchestrator = getOrchestrator();
	// Nodes still move and select while it runs: those change nothing a run judges
	const run = getChallengeRun();
	const { screenToFlowPosition, setCenter, getViewport, getNodesBounds, deleteElements } =
		useSvelteFlow();

	// Drives the layout, never what the canvas can do
	const isMobile = new IsMobile();
	const isCompact = new IsCompact();
	// A touchscreen laptop drops a connection with the same finger at a desktop width
	const coarsePointer = new MediaQuery('pointer: coarse');

	// Offered once, on a first visit: the tour reads the canvas it is about to point at
	tour.begin(graphState.projectId, graphState.nodes);

	// Every resource type renders through the same component, which reads its icon and
	// handles from the node's own definition
	const nodeTypes = Object.fromEntries(
		Object.keys(resourceDefinitions).map((resource) => [resource, ResourceNode])
	);
	// Every edge fans into its target's instances and carries the dots in flight
	const edgeTypes = { default: TrafficEdge };

	// A node's directory goes with it, so the resources holding anything worth keeping ask
	// before the graph has parted with them. A node a challenge's goals or script name never
	// arrives here: it carries deletable: false, which the flow filters out before it asks
	const onBeforeDelete: OnBeforeDelete = ({ nodes }) => {
		if (run?.active) return Promise.resolve(false);
		const withContents = nodes.filter(
			(node) => ownsStoredData(node.type) || getResourceDefinition(node.type).hasEditableFiles
		);
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

		// Before remove, which deletes the node's directory: a shell must not be sitting in it
		nodes.forEach((node) => shellSessions.closeForNode(node.id));

		nodes.forEach((node) => orchestrator.remove(node));
		edges.forEach((edge) => orchestrator.refreshEdge(edge));
	};

	let shellDock = $state<ReturnType<typeof ShellDock>>();

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
	// A challenge's panel heads the sidebar with the inspector under it, so layout keeps nodes
	// clear of it. A phone's sidebar is a sheet over half the canvas, so there the panel floats
	const challengeInSidebar = $derived(!!run && !isMobile.current);

	// Once the panel is gone the next one is a fresh arrival rather than a swap, so it opens without the fade
	$effect(() => {
		if (!showsInspector) inspectorState.shownNodeId = undefined;
	});

	// A drag ends in a click on the node it moved, so the click is judged by what the gesture did
	let dragged = false;
	let selectedBeforeDrag: string | undefined;

	// xyflow drags every selected node, and clears the old one in the same tick it reads its
	// node lookup — a gesture early is what the lookup needs to catch up
	function onPointerDown(event: PointerEvent) {
		if (!isMobile.current) return;
		dragged = false;

		const pressed = (event.target as Element | null)?.closest('.svelte-flow__node');
		if (!pressed) return;

		selectedBeforeDrag = graphState.selectedNodeId;
		if (selectedBeforeDrag && selectedBeforeDrag !== pressed.getAttribute('data-id')) {
			graphState.select();
		}
	}

	// Every tap, not just an obscured node: with the panel open nothing tappable is obscured
	const onNodeClick: NodeEventWithPointer<MouseEvent | TouchEvent, Node> = ({ node }) => {
		if (!isMobile.current) return;

		// selectNodesOnDrag is off here, so this click is where xyflow selected the dragged node
		if (dragged) {
			graphState.select(selectedBeforeDrag);
			return;
		}

		const bounds = getNodesBounds([node.id]);
		if (!bounds.width) return;

		// Held sideways: a tap lands on something already in view, and recentring would push its
		// neighbours off the edge
		liftAbovePanel({
			x: screenToFlowPosition({ x: window.innerWidth / 2, y: 0 }).x,
			y: bounds.y + bounds.height / 2
		});
	};

	// The visible strip's middle is half the panel's height above the canvas's
	function liftAbovePanel(centre: XYPosition) {
		const { zoom } = getViewport();
		const lift = ((PANEL_FRACTION / 2) * window.innerHeight) / zoom;
		setCenter(centre.x, centre.y + lift, { zoom, duration: 300 });
	}

	let pointerPosition = { x: 0, y: 0 };
	function trackPointer(e: MouseEvent | PointerEvent) {
		pointerPosition = { x: e.clientX, y: e.clientY };
	}

	async function addResource(resource: ResourceType, position: XYPosition) {
		if (run?.active) return;
		// Named before it exists, so the node is only created once the values are settled
		const { namedOnCreate } = getResourceDefinition(resource);
		let config: Record<string, unknown> | undefined;
		if (namedOnCreate) {
			config = await askResourceName({
				...namedOnCreate,
				validate: buildNameValidator(resource, graphState.nodes)
			});
			// Backing out of the dialog is a decision not to add the node at all
			if (!config) return;
		}

		const node = graphState.addNode(resource, position, { config });
		void orchestrator.mountFiles(node.id);
		// Reserves the new node's ports before it first renders
		orchestrator.refresh(node.id);
		graphState.select(node.id);
		return node;
	}

	function onDrop({ draggedItem, sourceContainer, targetContainer }: DragDropState<ResourceType>) {
		if (sourceContainer !== 'component-sidebar' || targetContainer !== 'canvas') {
			return;
		}
		void addResource(draggedItem, screenToFlowPosition(pointerPosition));
	}

	// Tapped adds all aim at one spot, so a new node steps right until it is clear
	const NODE_SPACING = 140;

	function clearOf(nodes: readonly Node[], spot: XYPosition): XYPosition {
		const taken = nodes.some(
			({ position }) =>
				Math.abs(position.x - spot.x) < NODE_SPACING && Math.abs(position.y - spot.y) < NODE_SPACING
		);
		return taken ? clearOf(nodes, { x: spot.x + NODE_SPACING, y: spot.y }) : spot;
	}

	// The panel the selection opens covers the bottom, so the middle is the strip's not the window's
	async function addResourceAtCentre(resource: ResourceType) {
		const position = clearOf(
			graphState.nodes,
			screenToFlowPosition({
				x: window.innerWidth / 2,
				y: ((1 - PANEL_FRACTION) * window.innerHeight) / 2
			})
		);
		// Sideways too: a stepped-aside node can be off the edge entirely. Only moves when the
		// spot was taken, so an uncontested add arrives without any motion
		if (await addResource(resource, position)) liftAbovePanel(position);
	}

	const onNodeDragStop: NodeTargetEventWithPointer<MouseEvent | TouchEvent, Node> = ({
		targetNode
	}) => {
		dragged = true;
		if (targetNode) graphState.setNodeInStorage(targetNode);
	};

	// The only way to delete without a keyboard. deleteElements is the same path the Delete key
	// takes, so the confirm dialog and the cleanup in ondelete both still run
	let contextMenu = $state<{ at: XYPosition; subject: string; remove: () => void }>();

	// The flow reports a point, not an element, so the menu hangs off a zero-size rect there
	const anchor = $derived.by(() => {
		const at = contextMenu?.at;
		return at && { getBoundingClientRect: () => new DOMRect(at.x, at.y, 0, 0) };
	});

	// Delete is the menu's only item, so there is no menu while it would do nothing
	const onNodeContextMenu: NodeEventWithPointer<MouseEvent, Node> = ({ event, node }) => {
		event.preventDefault();
		if (run?.active || node.deletable === false) return;
		contextMenu = {
			at: { x: event.clientX, y: event.clientY },
			subject: `"${nodeName(node)}"`,
			remove: () => void deleteElements({ nodes: [{ id: node.id }] })
		};
	};

	function onEdgeContextMenu({ event, edge }: { event: MouseEvent; edge: Edge }) {
		event.preventDefault();
		if (run?.active) return;
		contextMenu = {
			at: { x: event.clientX, y: event.clientY },
			subject: 'connection',
			remove: () => void deleteElements({ edges: [{ id: edge.id }] })
		};
	}

	const isValidConnection: IsValidConnection = ({ source, target }) => {
		const sourceNode = graphState.getNode(source);
		const targetNode = graphState.getNode(target);
		return !!sourceNode && !!targetNode && canAddEdge(sourceNode, targetNode, graphState.edges);
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
			orchestrator.refreshEdge(edge);
			graphState.setEdgeInStorage(edge);
		}
	};
</script>

{#snippet leftSidebar(dismiss: () => void)}
	<AppSidebar>
		{#snippet resources()}
			<ResourcesGroup
				onTap={(resource) => {
					// Before the dialog a named resource opens, so the two are never up together
					dismiss();
					addResourceAtCentre(resource);
				}}
			/>
		{/snippet}
	</AppSidebar>
{/snippet}

{#snippet flow()}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="relative h-full w-full"
		ondragover={trackPointer}
		onpointerdowncapture={onPointerDown}
		use:droppable={{ container: 'canvas', callbacks: { onDrop } }}
	>
		<SvelteFlow
			bind:nodes={graphState.nodes}
			bind:edges={graphState.edges}
			{nodeTypes}
			{edgeTypes}
			deleteKey="Delete"
			nodesConnectable={!run?.active}
			onbeforedelete={onBeforeDelete}
			ondelete={onDelete}
			selectNodesOnDrag={!isMobile.current}
			onnodedragstop={onNodeDragStop}
			onnodeclick={onNodeClick}
			onnodecontextmenu={onNodeContextMenu}
			onedgecontextmenu={onEdgeContextMenu}
			onconnect={onConnect}
			{isValidConnection}
			onmoveend={(_, viewport) => (graphState.viewport = viewport)}
			initialViewport={savedViewport}
			fitView={!savedViewport}
			connectionRadius={coarsePointer.current ? 44 : 20}
			nodeDragThreshold={coarsePointer.current ? 8 : 1}
			colorMode="system"
			attributionPosition={isMobile.current ? 'bottom-right' : 'top-left'}
		>
			<Controls />
			<Background />
		</SvelteFlow>
		{#if run && !challengeInSidebar}
			<ChallengePanel {run} placement="floating" />
		{/if}

		<!-- As in the editor, a compact surface has no terminal -->
		{#if !isCompact.current}
			<Button
				variant="outline"
				size="sm"
				class="absolute right-0 bottom-0 z-40 rounded-none rounded-tl-md border-r-0 border-b-0 shadow-none"
				onclick={() => shellDock?.toggle()}
			>
				<SquareTerminalIcon />
				Terminal
				{#if shellSessions.shells.length}
					<span class="text-muted-foreground tabular-nums">{shellSessions.shells.length}</span>
				{/if}
			</Button>
		{/if}
	</div>
{/snippet}

{#snippet mainContent()}
	<ShellDock bind:this={shellDock} owner={{ kind: 'admin' }} main={flow} />
{/snippet}

{#snippet challengeSidebar()}
	{#if run}
		<ChallengePanel {run} placement="sidebar" inspector={showsInspector ? inspector : undefined} />
	{/if}
{/snippet}

{#snippet inspector()}
	{#if graphState.selectedNodeId}
		{#key graphState.selectedNodeId}
			<InspectorSidebar nodeId={graphState.selectedNodeId} />
		{/key}
	{/if}
{/snippet}

<OrchestratorControls panelOpen={showsInspector} />

<ContextMenu.Root open={!!contextMenu} onOpenChange={(open) => open || (contextMenu = undefined)}>
	{#if contextMenu}
		<ContextMenu.Content customAnchor={anchor}>
			<ContextMenu.Item onSelect={contextMenu.remove}>
				Delete {contextMenu.subject}
			</ContextMenu.Item>
		</ContextMenu.Content>
	{/if}
</ContextMenu.Root>

<TourOverlay />

<Workspace
	{leftSidebar}
	{mainContent}
	rightSidebar={challengeInSidebar ? challengeSidebar : showsInspector ? inspector : undefined}
	onDismissRightSidebar={() => graphState.select()}
/>
