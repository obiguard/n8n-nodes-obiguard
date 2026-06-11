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
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { Agent, AgentDetails, AgentResponse } from './interfaces';
import { getInputs } from './getInputs';
import { substituteVariables } from './utils';

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

type SelectedAgent = {
	id: string;
	name?: string;
};

type ChatMessage = { role: string; content: string; tool_calls?: ToolCall[]; tool_call_id?: string };

function parseSelectedAgent(value: string): SelectedAgent {
	if (!value) return { id: '' };

	// New format: "<id>:::<name>"
	if (value.includes(':::')) {
		const [id, ...nameParts] = value.split(':::');
		return {
			id,
			name: nameParts.join(':::') || undefined,
		};
	}

	// Legacy format from earlier implementation: JSON string
	if (value.trim().startsWith('{')) {
		try {
			const parsed = JSON.parse(value) as Partial<SelectedAgent>;
			if (typeof parsed?.id === 'string' && parsed.id.length > 0) {
				return {
					id: parsed.id,
					name: typeof parsed.name === 'string' ? parsed.name : undefined,
				};
			}
		} catch {
			// Ignore parse failures and fall back to raw ID.
		}
	}

	// Backward compatibility: older saved nodes may only have a raw ID string.
	return { id: value };
}

function toSelectedAgentValue(agent: Agent): string {
	const name = agent.name || agent.id;
	return `${agent.id}:::${name}`;
}

function selectedAgentId(value: string): string {
	return parseSelectedAgent(value).id;
}

function selectedAgentNameOrId(value: string): string {
	const selected = parseSelectedAgent(value);
	return selected.name || selected.id;
}

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
		group: ['transform'],
		version: 1,
		description: 'Invoke an Obiguard AI agent and return its response',
		subtitle:
			'={{ $parameter.aiAgentId && $parameter.aiAgentId.includes(":::") ? $parameter.aiAgentId.split(":::").slice(1).join(":::") : ($parameter.aiAgentId && $parameter.aiAgentId[0] === "{" ? ($parameter.aiAgentId.match(/"name":"([^"]+)"/)?.[1] || $parameter.aiAgentId.match(/"id":"([^"]+)"/)?.[1] || $parameter.aiAgentId) : $parameter.aiAgentId) }}',
		defaults: {
			name: 'Obiguard AI Agent',
		},
		inputs: `={{
				((hasOutputParser) => {
					${getInputs.toString()};
					return getInputs(true, hasOutputParser)
				})($parameter.hasOutputParser === undefined || $parameter.hasOutputParser === true)
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
				default: 'Invokes an Obiguard AI agent with the given prompt and returns its response',
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
				description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
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
				default: '',
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
						addAllFields: false,
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
				displayName: 'Custom Request Timeout',
				name: 'useCustomTimeout',
				type: 'boolean',
				default: false,
				noDataExpression: true,
				description: 'Whether to override the default 300-second request timeout',
			},
			{
				displayName: 'Request Timeout (Seconds)',
				name: 'requestTimeout',
				type: 'number',
				default: 300,
				description: 'Maximum time in seconds to wait for a response from the agent API. Each tool-call iteration counts as a separate request.',
				typeOptions: { minValue: 1 },
				displayOptions: {
					show: {
						useCustomTimeout: [true],
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
						name: selectedAgentNameOrId(toSelectedAgentValue(agent)),
						value: toSelectedAgentValue(agent),
					}));
					return options;
				} catch (error) {
					throw new NodeOperationError(this.getNode(), error as Error, {
						message: 'Failed to load agents',
					});
				}
			},

			async loadPromptLabel(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const selectedAgent = this.getCurrentNodeParameter('aiAgentId') as string;
				const agentId = selectedAgentId(selectedAgent);
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
					const promptName = details.prompt?.name ?? '';
					const versionLabel = details.promptVersion?.label ?? '';
					const label = `${promptName} (${versionLabel})`;
					return [{ name: label || '(No prompt configured)', value: 'promptLabel' }];
				} catch {
					return [{ name: '(Failed to Load)', value: 'none' }];
				}
			},
		},

		resourceMapping: {
			async loadAgentVariables(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
				const selectedAgent = this.getCurrentNodeParameter('aiAgentId') as string;
				const agentId = selectedAgentId(selectedAgent);
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
				const selectedAgent = this.getNodeParameter('aiAgentId', i) as string;
				const aiAgentId = selectedAgentId(selectedAgent);
				const hasOutputParser = this.getNodeParameter('hasOutputParser', i, false) as boolean;
				const useCustomTimeout = this.getNodeParameter('useCustomTimeout', i, false) as boolean;
				const requestTimeout = (useCustomTimeout
					? (this.getNodeParameter('requestTimeout', i, 300) as number)
					: 300) * 1000;
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

				const agentDetails = (await this.helpers.httpRequestWithAuthentication.call(
					this,
					'obiguardApi',
					{
						method: 'GET',
						url: `/v1/ai-agents/${aiAgentId}`,
						baseURL: hostUrl,
						returnFullResponse: false,
						timeout: requestTimeout,
					},
				)) as AgentDetails;

				if (!agentDetails.promptVersion) {
					throw new NodeOperationError(
						this.getNode(),
						`Agent "${aiAgentId}" has no configured prompt version. Configure a prompt in the Obiguard portal before using this agent.`,
						{ itemIndex: i },
					);
				}

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

				type LcMessage = {
					_getType(): string;
					content: string | Array<{ type: string; text?: string }>;
					additional_kwargs?: {
						tool_calls?: Array<{
							id: string;
							function: { name: string; arguments: string };
						}>;
					};
					tool_call_id?: string;
				};
				type Memory = {
					chatHistory: {
						getMessages(): Promise<LcMessage[]>;
						addMessages(messages: unknown[]): Promise<void>;
					};
					saveContext(input: Record<string, string>, output: Record<string, string>): Promise<void>;
				};

				const memory =
					memoryRaw !== null &&
					typeof memoryRaw === 'object' &&
					'chatHistory' in memoryRaw &&
					'saveContext' in memoryRaw
						? (memoryRaw as Memory)
						: undefined;

				let chatHistory: ChatMessage[] = [];
				if (memory) {
					// Load directly from the storage backend to preserve tool_calls and
					// tool role messages. Apply the window (k) manually so limits configured
					// on the memory node are still respected.
					const allMessages = await memory.chatHistory.getMessages();
					const k = (memoryRaw as { k?: number }).k;
					let lcMessages = k !== undefined ? allMessages.slice(-(k * 2)) : allMessages;
					// If a previous run errored mid-turn the history may have an odd number of
					// messages, leaving a non-human message at the start after slicing. Drop it
					// so the context always begins on a clean human turn.
					if (lcMessages.length > 0 && lcMessages[0]._getType() !== 'human') {
						lcMessages = lcMessages.slice(1);
					}

					const roleMap: Record<string, string> = { human: 'user', ai: 'assistant' };
					chatHistory = lcMessages.map((lcMsg) => {
						const role = roleMap[lcMsg._getType()] ?? lcMsg._getType();
						const content =
							typeof lcMsg.content === 'string'
								? lcMsg.content
								: lcMsg.content
										.filter((c) => c.type === 'text')
										.map((c) => c.text ?? '')
										.join('');
						const msg: ChatMessage = { role, content };
						if (lcMsg.additional_kwargs?.tool_calls?.length) {
							msg.tool_calls = lcMsg.additional_kwargs.tool_calls;
						}
						if (lcMsg.tool_call_id) {
							msg.tool_call_id = lcMsg.tool_call_id;
						}
						return msg;
					});
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

				// Fetch all connected tools — single call returns all connections on the ai_tool port.
				// Each item may be a plain LcTool or a StructuredToolkit (e.g. from mcpClientTool),
				// which wraps multiple tools behind getTools()/tools[]. Expand toolkits inline.
				const toolRaw = await this.getInputConnectionData(NodeConnectionTypes.AiTool, i);
				const rawArray: unknown[] = Array.isArray(toolRaw) ? toolRaw : toolRaw ? [toolRaw] : [];
				const lcTools: LcTool[] = rawArray.flatMap((item) => {
					if (item && typeof item === 'object') {
						const asToolkit = item as { getTools?: () => LcTool[]; tools?: LcTool[] };
						if (typeof asToolkit.getTools === 'function') {
							return asToolkit.getTools();
						}
						if (Array.isArray(asToolkit.tools)) {
							return asToolkit.tools;
						}
					}
					return [item as LcTool];
				});
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

				const traceId = randomUUID().replace(/-/g, '');
				const parentId = randomUUID().replace(/-/g, '').slice(0, 16);
				const traceparent = `00-${traceId}-${parentId}-01`;
				let content = '';
				let reachedFinalResponse = false;
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
							headers: { 'x-request-id': randomUUID(), traceparent },
							body,
							json: true,
							returnFullResponse: false,
							timeout: requestTimeout,
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
								const args = JSON.parse(toolCall.function.arguments ?? '{}') as unknown;
								const result: unknown = tool.invoke
									? await tool.invoke(args)
									: tool.call
										? await tool.call(
												typeof args === 'object' ? JSON.stringify(args) : (args as string),
											)
										: (() => { throw new NodeOperationError(this.getNode(), `Tool "${toolCall.function.name}" does not expose an invoke or call method`, { itemIndex: i }); })();
								toolResult = typeof result === 'string' ? result : JSON.stringify(result);
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
						if (!choice) {
							throw new NodeOperationError(
								this.getNode(),
								'Agent API returned no choices in response',
								{ itemIndex: i },
							);
						}
						content = choice.message?.content ?? '';
						currentMessages.push({ role: 'assistant', content });
						reachedFinalResponse = true;
						break;
					}
				}

				if (!reachedFinalResponse) {
					throw new NodeOperationError(
						this.getNode(),
						`Agent did not produce a final response after ${MAX_TOOL_ITERATIONS} tool call iterations`,
						{ itemIndex: i },
					);
				}

				const json = parser ? await parser.parse(content) : { output: content };

				if (memory) {
					try {
						// Save the full turn — user message + all tool call/result pairs +
						// final assistant response — so the model sees the correct pattern
						// when this history is replayed next turn.
						const newTurnMessages = currentMessages.slice(
							sysMessages.length + chatHistory.length,
						);
						const lcNewMessages = newTurnMessages.map((msg) => {
							if (msg.role === 'user') {
								const data = { content: msg.content };
								return {
									_getType: (): string => 'human',
									...data,
									toDict: () => ({ type: 'human', data }),
								};
							}
							if (msg.role === 'tool') {
								const data = { content: msg.content, tool_call_id: msg.tool_call_id ?? '' };
								return {
									_getType: (): string => 'tool',
									...data,
									toDict: () => ({ type: 'tool', data }),
								};
							}
							// assistant message — may carry tool_calls
							const data = {
								content: msg.content ?? '',
								additional_kwargs: msg.tool_calls?.length
									? { tool_calls: msg.tool_calls }
									: {},
							};
							return {
								_getType: (): string => 'ai',
								...data,
								toDict: () => ({ type: 'ai', data }),
							};
						});
						await memory.chatHistory.addMessages(lcNewMessages);
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
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}

		return [returnData];
	}
}
