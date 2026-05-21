import { randomUUID } from 'crypto';
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
import { Agent, AgentDetails, AgentResponse } from './interafaces';
import { getInputs, substituteVariables } from './utils';

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
		builderHint: {
			inputs: {
				ai_memory: { required: false },
				ai_tool: { required: false },
				ai_outputParser: {
					required: false,
					displayOptions: { show: { hasOutputParser: [true] } },
				},
			},
		},
		properties: [
			{
				displayName: 'Description',
				name: 'toolDescription',
				type: 'string',
				default: 'AI Agent that can call other tools',
				required: true,
				typeOptions: { rows: 2 },
				description:
					'Explain to the LLM what this tool does, a good, specific description would allow LLMs to produce expected results much more often',
			},
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
				displayName: 'Prompt',
				name: 'promptLabel',
				type: 'options',
				default: 'promptLabel',
				noDataExpression: true,
				typeOptions: {
					loadOptionsDependsOn: ['aiAgentId'],
					loadOptionsMethod: 'loadPromptLabel',
				},
				displayOptions: {
					hide: {
						aiAgentId: [''],
					},
				},
				description: 'The active prompt version for the selected agent',
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

			async loadPromptLabel(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const agentId = this.getCurrentNodeParameter('aiAgentId') as string;
				if (!agentId) return [{ name: '—', value: 'none' }];

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
					const summaryName = details.promptSummary?.name ?? '';
					const versionLabel = details.promptVersion?.label ?? '';
					const label = `${summaryName} (${versionLabel})`;
					return [{ name: label || '(No prompt configured)', value: 'promptLabel' }];
				} catch (error) {
					return [{ name: '(Failed to load)', value: 'none' }];
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
				const hasOutputParser = this.getNodeParameter('hasOutputParser', i, false) as boolean;
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

				const agentDetails = await this.helpers.httpRequestWithAuthentication.call(
					this,
					'obiguardApi',
					{
						method: 'GET',
						url: `/v1/ai-agents/${aiAgentId}`,
						baseURL: hostUrl,
						returnFullResponse: false,
					},
				) as AgentDetails;
				console.log('>>> agentDetails: ', agentDetails);

				// Construct messages using promptVersion.
				const messages: Array<{ role: string; content: string }> = [];
				if (agentDetails.promptVersion?.systemPrompt) {
					messages.push({
						role: 'system',
						content: substituteVariables(agentDetails.promptVersion.systemPrompt, variables),
					});
				}
				for (const msg of agentDetails.promptVersion?.messages ?? []) {
					messages.push({ role: msg.role, content: substituteVariables(msg.content, variables) });
				}


				// Read from memory and populate the chatHistory.
				const memoryRaw = await this.getInputConnectionData(NodeConnectionTypes.AiMemory, i);
				const memory =
					memoryRaw !== null &&
					typeof memoryRaw === 'object' &&
					'chatHistory' in memoryRaw &&
					'saveContext' in memoryRaw
						? (memoryRaw as {
								chatHistory: {
									getMessages(): Promise<
										Array<{
											_getType(): string;
											content: string | Array<{ type: string; text?: string }>;
										}>
									>;
								};
								saveContext(
									input: Record<string, string>,
									output: Record<string, string>,
								): Promise<void>;
							})
						: undefined;

				let chatHistory: Array<{ role: string; content: string }> = [];
				if (memory) {
					const lcMessages = await memory.chatHistory.getMessages();
					const roleMap: Record<string, string> = { human: 'user', ai: 'assistant' };
					chatHistory = lcMessages.map((lcMsg) => ({
						role: roleMap[lcMsg._getType()] ?? lcMsg._getType(),
						content:
							typeof lcMsg.content === 'string'
								? lcMsg.content
								: lcMsg.content
										.filter((c) => c.type === 'text')
										.map((c) => c.text ?? '')
										.join(''),
					}));
				}

				// Populate the output schema in the request
				let outputSchema: object | undefined;
				let parser: any | undefined;
				if (hasOutputParser) {
					const outputParser = await this.getInputConnectionData(
						NodeConnectionTypes.AiOutputParser,
						i,
					);
					if (outputParser) {
						parser = outputParser as any;
						if (parser.schema) {
							outputSchema = toJsonSchema(parser.schema);
						} else {
							// Fallback: extract JSON schema from the markdown code block in
							// formattingInstructions (LangChain embeds it there as ```json ... ```)
							const instructions: string = parser.getFormatInstructions();
							const match = instructions.match(/```json\n([\s\S]*?)\n```/);
							if (match) {
								try {
									const parsed = JSON.parse(match[1]) as Record<string, unknown>;
									delete parsed['$schema'];
									outputSchema = parsed;
								} catch {
									// schema not extractable — proceed without structured output
								}
							}
						}
					}
				}

				// Fetch all connected tools — single call returns all connections on the ai_tool port
				const toolRaw = await this.getInputConnectionData(NodeConnectionTypes.AiTool, i);
				const lcTools: any[] = Array.isArray(toolRaw) ? toolRaw : toolRaw ? [toolRaw] : [];
				const openAiTools = lcTools.map((t: any) => ({
					type: 'function' as const,
					function: {
						name: t.name as string,
						description: t.description as string,
						parameters: t.schema
							? toJsonSchema(t.schema)
							: { type: 'object', properties: {}, additionalProperties: false },
					},
				}));

				// Merge chatHistory into messages upfront so the loop stays self-contained
				const sysMessages = messages.filter((m) => m.role === 'system');
				const nonSysMessages = messages.filter((m) => m.role !== 'system');
				const currentMessages: any[] = [...sysMessages, ...chatHistory, ...nonSysMessages];

				const requestId = randomUUID();
				const traceId = requestId.replace(/-/g, '');
				const traceparent = `00-${traceId}-${traceId.slice(0, 16)}-01`;
				let content = '';
				const MAX_TOOL_ITERATIONS = 10;

				for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
					const body: Record<string, any> = {
						messages: currentMessages,
						...(openAiTools.length > 0 ? { tools: openAiTools, tool_choice: 'auto' } : {}),
						...(outputSchema ? { outputSchema } : {}),
					};
					const response = await this.helpers.httpRequestWithAuthentication.call(
						this,
						'obiguardApi',
						{
							method: 'POST',
							url: `/v1/ai-agents/${aiAgentId}`,
							baseURL: hostUrl,
							headers: { 'x-request-id': requestId, traceparent },
							body,
							json: true,
							returnFullResponse: false,
						},
					);
					const completion = Array.isArray(response) ? response[0] : response;
					const choice = completion?.choices?.[0];

					if (choice?.finish_reason === 'tool_calls' && choice.message?.tool_calls?.length) {
						currentMessages.push(choice.message);
						for (const toolCall of choice.message.tool_calls as any[]) {
							const tool = lcTools.find((t: any) => t.name === toolCall.function.name);
							let toolResult: string;
							if (tool) {
								try {
									const args = JSON.parse(toolCall.function.arguments ?? '{}') as unknown;
									const result: unknown = tool.invoke
									? await tool.invoke(args)
									: await tool.call(typeof args === 'object' ? JSON.stringify(args) : args as string);
									toolResult = typeof result === 'string' ? result : JSON.stringify(result);
								} catch (e) {
									toolResult = `Error: ${(e as Error).message}`;
								}
							} else {
								toolResult = `Unknown tool: ${toolCall.function.name}`;
							}
							currentMessages.push({
								role: 'tool',
								content: toolResult,
								tool_call_id: toolCall.id,
							});
						}
					} else {
						content = choice?.message?.content ?? '';
						break;
					}
				}

				const json = parser ? await parser.parse(content) : { output: content };

				if (memory) {
					try {
						const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
						const inputSummary = lastUserMsg?.content ?? '(no input)';
						await memory.saveContext({ input: inputSummary }, { output: content });
					} catch (memErr) {
						console.error('>>> memory.saveContext failed:', memErr);
					}
				}

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
