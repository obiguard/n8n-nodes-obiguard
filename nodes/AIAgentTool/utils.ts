export function substituteVariables(template: string, variables: Record<string, string>): string {
	return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => variables[key] ?? '');
}

// Function used in the inputs expression to figure out which inputs to
import {
	type INodeInputConfiguration,
	type INodeFilter,
	type NodeConnectionType,
} from 'n8n-workflow';



// display based on the agent type
/* istanbul ignore next */
export function getInputs(
	hasMainInput?: boolean,
	hasOutputParser?: boolean,
	needsFallback?: boolean,
): Array<NodeConnectionType | INodeInputConfiguration> {

	interface SpecialInput {
		type: NodeConnectionType;
		filter?: INodeFilter;
		displayName: string;
		required?: boolean;
	}

	const getInputData = (
		inputs: SpecialInput[],
	): Array<NodeConnectionType | INodeInputConfiguration> => {
		return inputs.map(({ type, filter, displayName, required }) => {
			const input: INodeInputConfiguration = {
				type,
				displayName,
				required,
				maxConnections: ['ai_memory', 'ai_outputParser'].includes(type) ? 1 : undefined,
			};

			if (filter) {
				input.filter = filter;
			}

			return input;
		});
	};

	let specialInputs: SpecialInput[] = [
		{
			displayName: 'Memory',
			type: 'ai_memory',
		},
		{
			displayName: 'Tool',
			type: 'ai_tool',
		},
		{
			displayName: 'Output Parser',
			type: 'ai_outputParser',
		},
	];

	if (hasOutputParser === false) {
		specialInputs = specialInputs.filter((input) => input.type !== 'ai_outputParser');
	}

	// Note cannot use NodeConnectionType.Main
	// otherwise expression won't evaluate correctly on the FE
	const mainInputs: NodeConnectionType[] = hasMainInput ? ['main' as NodeConnectionType] : [];
	if (needsFallback) {
		mainInputs.push('main' as NodeConnectionType);
	}
	return [...mainInputs, ...getInputData(specialInputs)];
}
