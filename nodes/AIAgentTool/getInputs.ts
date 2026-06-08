// ⚠️  EXPRESSION-SAFE FILE — READ BEFORE EDITING ⚠️
//
// This function is serialised into an n8n frontend expression via .toString().
// The expression evaluator has no access to the module system, so the function
// body MUST be entirely self-contained:
//
//   ✅  Type-only imports are fine — TypeScript erases them before .toString()
//   ❌  Value imports (e.g. `import { NodeConnectionTypes } from 'n8n-workflow'`)
//       will NOT be available at expression runtime and will cause silent failures
//   ❌  References to variables or functions defined outside this function body
//
// If you need to share logic with other files, duplicate it here rather than
// importing it.

import type {
	INodeInputConfiguration,
	INodeFilter,
	NodeConnectionType,
} from 'n8n-workflow';

/* istanbul ignore next */
export function getInputs(
	hasMainInput?: boolean,
	hasOutputParser?: boolean,
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

	// Note: cannot use NodeConnectionType.Main here — it is a value import and
	// would not be available when this function runs inside the frontend expression.
	const mainInputs = hasMainInput ? ['main' as NodeConnectionType] : [];
	return [...mainInputs, ...getInputData(specialInputs)];
}
