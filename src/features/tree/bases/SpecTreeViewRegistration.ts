import { App } from 'obsidian';
import { SpecTreeBasesView, QueryController } from './SpecTreeBasesView';
import { MasterHistoryEngine } from '../../history/MasterHistoryEngine';

export interface BasesViewRegistration {
	name: string;
	icon: string;
	factory: (...args: unknown[]) => unknown;
	options?: (...args: unknown[]) => unknown[];
}

export const createSpecTreeViewRegistration = (
	id: string,
	name: string,
	app: App,
	historyEngine: MasterHistoryEngine
): [string, BasesViewRegistration] => [
	id,
	{
		name,
		icon: 'folder-tree',
		factory: (controller: unknown, parentEl: unknown) =>
			new SpecTreeBasesView(
				controller as QueryController,
				parentEl as HTMLElement,
				app,
				historyEngine
			),
	},
];

export const TreeViewRegistrationBuilder = (
	app: App,
	historyEngine: MasterHistoryEngine
): [string, BasesViewRegistration] => createSpecTreeViewRegistration('tree', 'Tree View', app, historyEngine);
