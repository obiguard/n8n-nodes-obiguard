import type {
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	ResourceMapperFields,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { toJsonSchema } from '@langchain/core/utils/json_schema';
import { Agent, AgentDetails, AgentResponse } from './interaces';
import { getInputs } from './utils';

export class AiAgentTool implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Obiguard AI Agent',
		name: 'aiAgentTool',
		icon: 'file:obiguard.svg',
		group: ['input'],
		version: [1],
		description: 'Retrieve details for a selected AI agent',
		defaults: {
			name: 'Obiguard AI Agent',
		},
		// inputs: [NodeConnectionTypes.Main],
		inputs: `={{
				((hasOutputParser, needsFallback) => {
					${getInputs.toString()};
					return getInputs(true, hasOutputParser, needsFallback)
				})($parameter.hasOutputParser === undefined || $parameter.hasOutputParser === true, $parameter.needsFallback !== undefined && $parameter.needsFallback === true)
			}}`,
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'obiguardApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'AI Agent Name',
				name: 'aiAgentId',
				type: 'options',
				required: true,
				description: 'Select an AI agent from the list.',
				typeOptions: {
					loadOptionsMethod: 'loadAgents',
				},
				default: '',
				noDataExpression: true,
			},
			{
				displayName: 'Variables',
				name: 'variables',
				type: 'resourceMapper',
				default: {
					mappingMode: 'defineBelow',
					value: {},
				},
				noDataExpression: true,
				hint: 'Click the refresh button above to load the variable fields for the selected agent.',
				typeOptions: {
					loadOptionsDependsOn: ['aiAgentId'],
					resourceMapper: {
						resourceMapperMethod: 'loadAgentVariables',
						mode: 'add',
						fieldWords: {
							singular: 'variable',
							plural: 'variables',
						},
						supportAutoMap: false,
						hideNoDataError: true,
						allowEmptyValues: true,
					},
				},
				displayOptions: {
					hide: {
						aiAgentId: [''],
					},
				},
			},
			{
				displayName: 'Require Specific Output Format',
				name: 'hasOutputParser',
				type: 'boolean',
				default: false,
				noDataExpression: true,
			},
			{
				displayName: `Connect an <a data-action='openSelectiveNodeCreator' data-action-parameter-connectiontype='${NodeConnectionTypes.AiOutputParser}'>output parser</a> on the canvas to specify the output format you require`,
				name: 'notice',
				type: 'notice',
				default: '',
				displayOptions: {
					show: {
						hasOutputParser: [true],
					},
				},
			},
		],
	};

	methods = {
		loadOptions: {
			async loadAgents(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				try {
					const credentials = await this.getCredentials('obiguardApi');
					const hostUrl = credentials.hostUrl as string;

					const response = await this.helpers.httpRequestWithAuthentication.call(
						this,
						'obiguardApi',
						{
							method: 'GET',
							url: '/v1/resources',
							baseURL: hostUrl,
							returnFullResponse: false,
						},
					);

					const agents: Agent[] = (response as AgentResponse).agents || [];

					const options = agents.map((agent: Agent) => ({
						name: agent.name || agent.id,
						value: agent.id,
					}));
					return options;
				} catch (error) {
					throw new NodeOperationError(this.getNode(), error as Error, {
						message: 'Failed to load agents',
					});
				}
			},

			async loadAgentSystemPrompt(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const agentId = this.getCurrentNodeParameter('aiAgentId') as string;
				if (!agentId) return [];

				try {
					const credentials = await this.getCredentials('obiguardApi');
					const hostUrl = credentials.hostUrl as string;

					const response = await this.helpers.httpRequestWithAuthentication.call(
						this,
						'obiguardApi',
						{
							method: 'GET',
							url: `/v1/ai-agents/${agentId}`,
							baseURL: hostUrl,
							returnFullResponse: false,
						},
					);

					const details = response as AgentDetails;
					const prompt = details.promptVersion?.systemPrompt ?? '';
					// Fixed value so the field always shows as selected; name carries the actual text
					return [{ name: prompt || '(No prompt configured)', value: 'systemPrompt' }];
				} catch (error) {
					throw new NodeOperationError(this.getNode(), error as Error, {
						message: 'Failed to load agent details',
					});
				}
			},
		},

		resourceMapping: {
			async loadAgentVariables(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
				const agentId = this.getCurrentNodeParameter('aiAgentId') as string;
				if (!agentId) return { fields: [] };

				try {
					const credentials = await this.getCredentials('obiguardApi');
					const hostUrl = credentials.hostUrl as string;

					const response = await this.helpers.httpRequestWithAuthentication.call(
						this,
						'obiguardApi',
						{
							method: 'GET',
							url: `/v1/ai-agents/${agentId}`,
							baseURL: hostUrl,
							returnFullResponse: false,
						},
					);

					const details = response as AgentDetails;
					const variables: string[] = details.promptVersion?.variables || [];

					return {
						fields: variables.map((varName) => ({
							id: varName,
							displayName: varName,
							type: 'string' as const,
							required: true,
							allowEmptyValues: true,
							defaultMatch: false,
							canBeUsedToMatch: false,
							display: true,
						})),
					};
				} catch (error) {
					return { fields: [] };
				}
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const aiAgentId = this.getNodeParameter('aiAgentId', i) as string;
				// const text = this.getNodeParameter('text', i) as string;
				const hasOutputParser = this.getNodeParameter('hasOutputParser', i, true) as boolean;
				const credentials = await this.getCredentials('obiguardApi');
				const hostUrl = credentials.hostUrl as string;

				const variablesParam = this.getNodeParameter('variables', i, { value: null }) as {
					value: Record<string, string | null> | null;
				};
				const variables: Record<string, string> = {};
				if (variablesParam.value) {
					for (const [key, val] of Object.entries(variablesParam.value)) {
						if (val !== null && val !== undefined) {
							variables[key] = String(val);
						}
					}
				}

				let outputSchema: object | undefined;
				let formattingInstructions: string | undefined;
				let parser: any | undefined;
				if (hasOutputParser) {
					const outputParser = await this.getInputConnectionData(
						NodeConnectionTypes.AiOutputParser,
						i,
					);
					if (outputParser) {
						parser = outputParser as any;
						formattingInstructions = parser.getFormatInstructions() as string;
						if (parser.schema) {
							outputSchema = toJsonSchema(parser.schema);
						}
					}
				}

				const body = {
					...(Object.keys(variables).length > 0 ? { variables } : {}),
					...(outputSchema ? { outputSchema } : {}),
					...(formattingInstructions ? { formattingInstructions } : {}),
				};
				const response = await this.helpers.httpRequestWithAuthentication.call(
					this,
					'obiguardApi',
					{
						method: 'POST',
						url: `/v1/ai-agents/${aiAgentId}`,
						baseURL: hostUrl,
						body,
						json: true,
						returnFullResponse: false,
					},
				);

				const completion = Array.isArray(response) ? response[0] : response;
				const content = completion?.choices?.[0]?.message?.content ?? '';
				const json = parser ? await parser.parse(content) : { output: content };

				returnData.push({
					json,
					pairedItem: { item: i },
				});
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				throw new NodeApiError(this.getNode(), error, { itemIndex: i });
			}
		}

		return [returnData];
	}
}
