// Which tab the inspector has open is about the reader rather than the node, and the panel
// is built again from scratch on every selection, so this outlives any one of them
class InspectorTab {
	value = $state('config');
}

export const inspectorTab = new InspectorTab();
