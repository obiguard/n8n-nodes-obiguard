import { randomUUID } from 'crypto';
import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	ResourceMapperFields,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { Agent, AgentDetails, AgentResponse } from './interfaces';
import { getInputs, substituteVariables } from './utils';

interface OutputParser {
	schema?: unknown;
	getFormatInstructions(): string;
	parse(content: string): Promise<Record<string, unknown>>;
}

interface LcTool {
	name: string;
	description: string;
	schema?: unknown;
	invoke?(args: unknown): Promise<unknown>;
	call?(args: string): Promise<unknown>;
}

interface ToolCall {
	id: string;
	function: { name: string; arguments: string };
}

interface CompletionChoice {
	finish_reason: string;
	message: { content?: string; tool_calls?: ToolCall[] };
}

type ChatMessage = { role: string; content: string; tool_calls?: ToolCall[]; tool_call_id?: string };

function zodToJsonSchemaInline(schema: unknown): Record<string, unknown> {
	if (!schema || typeof schema !== 'object') return {};
	const s = schema as {
		_def?: {
			typeName?: string;
			shape?: () => Record<string, unknown>;
			type?: unknown;
			innerType?: unknown;
			options?: unknown[];
			description?: string;
			value?: unknown;
		};
	};
	if (!s._def?.typeName) return schema as Record<string, unknown>;
	const base: Record<string, unknown> = s._def.description ? { description: s._def.description } : {};
	switch (s._def.typeName) {
		case 'ZodObject': {
			const shape = s._def.shape?.() ?? {};
			const properties: Record<string, unknown> = {};
			const required: string[] = [];
			for (const [key, val] of Object.entries(shape)) {
				properties[key] = zodToJsonSchemaInline(val);
				const v = val as { _def?: { typeName?: string } };
				if (v._def?.typeName !== 'ZodOptional' && v._def?.typeName !== 'ZodNullable') {
					required.push(key);
				}
			}
			return { ...base, type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false };
		}
		case 'ZodString':
			return { ...base, type: 'string' };
		case 'ZodNumber':
			return { ...base, type: 'number' };
		case 'ZodBoolean':
			return { ...base, type: 'boolean' };
		case 'ZodArray':
			return { ...base, type: 'array', items: zodToJsonSchemaInline(s._def.type) };
		case 'ZodOptional':
		case 'ZodNullable':
			return zodToJsonSchemaInline(s._def.innerType ?? s._def.type);
		case 'ZodEnum':
			return { ...base, type: 'string', enum: s._def.options };
		case 'ZodLiteral':
			return { type: typeof s._def.value, enum: [s._def.value] };
		default:
			return base;
	}
}

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
				displayName: 'AI Agent Name or ID',
				name: 'aiAgentId',
				type: 'options',
				required: true,
				description: 'Select an AI agent from the list. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
				typeOptions: {
					loadOptionsMethod: 'loadAgents',
				},
				default: '',
				noDataExpression: true,
			},
			{
				displayName: 'Prompt Name or ID',
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
				description: 'The active prompt version for the selected agent. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
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
				} catch {
					return [{ name: '(Failed to Load)', value: 'none' }];
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
				} catch {
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

				// Construct messages using promptVersion.
				const messages: ChatMessage[] = [];
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

				let chatHistory: ChatMessage[] = [];
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
				let outputSchema: Record<string, unknown> | undefined;
				let parser: OutputParser | undefined;
				if (hasOutputParser) {
					const outputParser = await this.getInputConnectionData(
						NodeConnectionTypes.AiOutputParser,
						i,
					);
					if (outputParser) {
						parser = outputParser as OutputParser;
						if (parser.schema) {
							outputSchema = zodToJsonSchemaInline(parser.schema);
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
				const lcTools: LcTool[] = Array.isArray(toolRaw) ? toolRaw as LcTool[] : toolRaw ? [toolRaw as LcTool] : [];
				const openAiTools = lcTools.map((t: LcTool) => ({
					type: 'function' as const,
					function: {
						name: t.name,
						description: t.description,
						parameters: t.schema
							? zodToJsonSchemaInline(t.schema)
							: { type: 'object', properties: {}, additionalProperties: false },
					},
				}));

				// Merge chatHistory into messages upfront so the loop stays self-contained
				const sysMessages = messages.filter((m) => m.role === 'system');
				const nonSysMessages = messages.filter((m) => m.role !== 'system');
				const currentMessages: ChatMessage[] = [...sysMessages, ...chatHistory, ...nonSysMessages];

				const requestId = randomUUID();
				const traceId = requestId.replace(/-/g, '');
				const traceparent = `00-${traceId}-${traceId.slice(0, 16)}-01`;
				let content = '';
				const MAX_TOOL_ITERATIONS = 10;

				for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
					const body: Record<string, unknown> = {
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
					const completion = Array.isArray(response)
						? (response as CompletionChoice[][])[0]
						: (response as { choices?: CompletionChoice[] });
					const choice: CompletionChoice | undefined = Array.isArray(completion)
						? (completion as CompletionChoice[])[0]
						: (completion as { choices?: CompletionChoice[] }).choices?.[0];

					if (choice?.finish_reason === 'tool_calls' && choice.message?.tool_calls?.length) {
						currentMessages.push(choice.message as ChatMessage);
						for (const toolCall of choice.message.tool_calls) {
							const tool = lcTools.find((t: LcTool) => t.name === toolCall.function.name);
							let toolResult: string;
							if (tool) {
								try {
									const args = JSON.parse(toolCall.function.arguments ?? '{}') as unknown;
									const result: unknown = tool.invoke
									? await tool.invoke(args)
									: tool.call
									? await tool.call(typeof args === 'object' ? JSON.stringify(args) : args as string)
									: 'Tool invocation not supported';
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
					} catch {
						// memory persistence is best-effort
					}
				}

				returnData.push({
					json: json as IDataObject,
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
