import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import type { AgentDetails } from '../interfaces';

// ── Default fixtures ──────────────────────────────────────────────────────────

export const AGENT_ID = 'agent-123:::Test Agent';
export const HOST_URL = 'http://localhost:4001';

export const DEFAULT_AGENT_DETAILS: AgentDetails = {
	id: 'agent-123',
	nid: 'nid-123',
	name: 'Test Agent',
	promptVersion: {
		id: 'pv-1',
		nid: 'pv-nid-1',
		label: 'v1',
		systemPrompt: 'You are a helpful assistant.',
		messages: [{ role: 'user', content: 'Hello {{name}}' }],
		temperature: 0.7,
		maxTokens: 1000,
		stopSequences: [],
		variables: ['name'],
	},
	prompt: { id: 'p-1', nid: 'p-nid-1', name: 'Test Prompt' },
	variables: ['name'],
};

/** A minimal completion response with a final assistant message. */
export function makeCompletion(content: string) {
	return { choices: [{ finish_reason: 'stop', message: { content } }] };
}

/** A completion response requesting a tool call. */
export function makeToolCallCompletion(toolName: string, args: Record<string, unknown>) {
	const toolCall = {
		id: 'tc-1',
		function: { name: toolName, arguments: JSON.stringify(args) },
	};
	return {
		choices: [
			{
				finish_reason: 'tool_calls',
				message: { content: undefined, tool_calls: [toolCall] },
			},
		],
	};
}

// ── Mock memory ───────────────────────────────────────────────────────────────

export function makeMockMemory(initialMessages: Array<{ type: string; content: string }> = []) {
	const stored: unknown[] = initialMessages.map((m) => ({
		_getType: () => m.type,
		content: m.content,
	}));

	return {
		k: 5,
		chatHistory: {
			getMessages: jest.fn().mockResolvedValue(stored),
			addMessages: jest.fn().mockImplementation((msgs: unknown[]) => {
				stored.push(...msgs);
				return Promise.resolve();
			}),
		},
		saveContext: jest.fn(),
	};
}

// ── IExecuteFunctions mock factory ────────────────────────────────────────────

type NodeParameters = {
	aiAgentId?: string;
	useCustomTimeout?: boolean;
	requestTimeout?: number;
	hasOutputParser?: boolean;
	variables?: { value: Record<string, string> | null };
};

export function makeMockExecute(options: {
	parameters?: NodeParameters;
	httpResponses?: unknown[];
	memory?: ReturnType<typeof makeMockMemory> | null;
	tools?: unknown[];
	items?: INodeExecutionData[];
}): IExecuteFunctions {
	const {
		parameters = {},
		httpResponses = [],
		memory = null,
		tools = [],
		items = [{ json: {} }],
	} = options;

	const params: NodeParameters = {
		aiAgentId: AGENT_ID,
		useCustomTimeout: false,
		requestTimeout: 300,
		hasOutputParser: false,
		variables: { value: {} },
		...parameters,
	};

	let httpCallIndex = 0;
	const httpMock = jest.fn().mockImplementation(() => {
		const response = httpResponses[httpCallIndex];
		httpCallIndex++;
		return Promise.resolve(response);
	});

	return {
		getInputData: jest.fn().mockReturnValue(items),
		getNode: jest.fn().mockReturnValue({
			name: 'Obiguard AI Agent',
			type: 'aiAgentTool',
			typeVersion: 1,
			position: [0, 0],
			id: 'node-1',
			parameters: {},
		}),
		getNodeParameter: jest.fn().mockImplementation((name: string) => {
			return (params as Record<string, unknown>)[name];
		}),
		getCredentials: jest.fn().mockResolvedValue({ hostUrl: HOST_URL }),
		helpers: {
			httpRequestWithAuthentication: { call: httpMock },
		},
		getInputConnectionData: jest.fn().mockImplementation((type: string) => {
			if (type === 'ai_memory') return Promise.resolve(memory);
			if (type === 'ai_tool') return Promise.resolve(tools);
			return Promise.resolve(null);
		}),
		continueOnFail: jest.fn().mockReturnValue(false),
	} as unknown as IExecuteFunctions;
}
