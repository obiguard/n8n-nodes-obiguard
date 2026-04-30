import type {
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeApiError, NodeOperationError } from 'n8n-workflow';
import { Agent, AgentResponse } from './interaces';

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
		inputs: [NodeConnectionTypes.Main],
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
				displayName: 'AI Agent Name or ID',
				name: 'aiAgentId',
				type: 'options',
				required: true,
				description: 'Select an AI agent. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
				typeOptions: {
					loadOptionsMethod: 'loadAgents',
				},
				default: '',
			},
			{
				displayName: 'Prompt (User Message)',
				name: 'prompt',
				type: 'string',
				typeOptions: {
					rows: 4,
				},
				default: '',
				description: 'The prompt to send to the AI agent',
			},
		],
	};

	methods = {
		loadOptions: {
			async loadAgents(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				try {
					const credentials = await this.getCredentials('obiguardApi');
					const hostUrl = credentials.hostUrl as string;

					const response = await this.helpers.httpRequestWithAuthentication.call(this, 'obiguardApi', {
						method: 'GET',
						url: '/v1/resources',
						baseURL: hostUrl,
						returnFullResponse: false,
					});

					const agents: Agent[] = (response as AgentResponse).agents || [];

					const options = agents.map((agent: Agent) => ({
						name: agent.name || agent.id,
						value: agent.id,
					}));
					return options;
				} catch (error) {
					throw new NodeOperationError(this.getNode(), error as Error, { message: 'Failed to load agents' });
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
				const prompt = this.getNodeParameter('prompt', i) as string;
				const credentials = await this.getCredentials('obiguardApi');
				const hostUrl = credentials.hostUrl as string;

				const response = await this.helpers.httpRequestWithAuthentication.call(this, 'obiguardApi', {
					method: 'POST',
					url: `/v1/ai-agents/${aiAgentId}`,
					baseURL: hostUrl,
					body: { prompt },
					json: true,
					returnFullResponse: true,
				});
				console.log('>>. response:', response);
				returnData.push({
					json: response,
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
