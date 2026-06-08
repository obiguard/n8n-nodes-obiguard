import { AiAgentTool } from '../AiAgentTool.node';
import {
	makeMockExecute,
	makeMockMemory,
	makeCompletion,
	makeToolCallCompletion,
	DEFAULT_AGENT_DETAILS,
	AGENT_ID,
} from './helpers';

function getInstance() {
	return new AiAgentTool();
}

// Helper — run execute and return the first output item's json
async function runNode(
	instance: AiAgentTool,
	options: Parameters<typeof makeMockExecute>[0],
) {
	const ctx = makeMockExecute(options);
	const [[result]] = await instance.execute.call(ctx);
	return result?.json;
}

// ── promptVersion guard ───────────────────────────────────────────────────────

describe('promptVersion guard', () => {
	it('throws a descriptive error when promptVersion is null', async () => {
		const instance = getInstance();
		const agentWithoutPrompt = { ...DEFAULT_AGENT_DETAILS, promptVersion: null };
		const ctx = makeMockExecute({
			httpResponses: [agentWithoutPrompt],
		});
		await expect(instance.execute.call(ctx)).rejects.toThrow(
			/no configured prompt version/i,
		);
	});
});

// ── Basic execution ───────────────────────────────────────────────────────────

describe('basic execution', () => {
	it('returns the assistant response as output', async () => {
		const instance = getInstance();
		const result = await runNode(instance, {
			httpResponses: [DEFAULT_AGENT_DETAILS, makeCompletion('Hello world')],
		});
		expect(result).toEqual({ output: 'Hello world' });
	});

	it('substitutes variables into the prompt before sending', async () => {
		const instance = getInstance();
		const ctx = makeMockExecute({
			parameters: { aiAgentId: AGENT_ID, variables: { value: { name: 'Alice' } } },
			httpResponses: [DEFAULT_AGENT_DETAILS, makeCompletion('Hi Alice')],
		});
		await instance.execute.call(ctx);

		const postCall = (ctx.helpers.httpRequestWithAuthentication.call as jest.Mock).mock.calls[1][2];
		const userMsg = postCall.body.messages.find((m: { role: string }) => m.role === 'user');
		expect(userMsg.content).toBe('Hello Alice');
	});

	it('applies the requestTimeout to every HTTP call', async () => {
		const instance = getInstance();
		const ctx = makeMockExecute({
			parameters: { aiAgentId: AGENT_ID, requestTimeout: 60 },
			httpResponses: [DEFAULT_AGENT_DETAILS, makeCompletion('ok')],
		});
		await instance.execute.call(ctx);

		const calls = (ctx.helpers.httpRequestWithAuthentication.call as jest.Mock).mock.calls;
		for (const call of calls) {
			expect(call[2].timeout).toBe(60_000);
		}
	});
});

// ── Memory ────────────────────────────────────────────────────────────────────

describe('memory', () => {
	it('prepends chat history from memory before the current user turn', async () => {
		const instance = getInstance();
		const memory = makeMockMemory([
			{ type: 'human', content: 'Previous question' },
			{ type: 'ai', content: 'Previous answer' },
		]);
		const ctx = makeMockExecute({
			memory,
			httpResponses: [DEFAULT_AGENT_DETAILS, makeCompletion('New answer')],
		});
		await instance.execute.call(ctx);

		const postCall = (ctx.helpers.httpRequestWithAuthentication.call as jest.Mock).mock.calls[1][2];
		const msgs: Array<{ role: string; content: string }> = postCall.body.messages;

		const historyIndex = msgs.findIndex((m) => m.content === 'Previous question');
		const currentIndex = msgs.findIndex((m) => m.content === 'Hello ');
		expect(historyIndex).toBeGreaterThanOrEqual(0);
		expect(historyIndex).toBeLessThan(currentIndex);
	});

	it('saves the user turn and assistant response to memory after execution', async () => {
		const instance = getInstance();
		const memory = makeMockMemory();
		await runNode(instance, {
			memory,
			httpResponses: [DEFAULT_AGENT_DETAILS, makeCompletion('The answer')],
		});

		expect(memory.chatHistory.addMessages).toHaveBeenCalledTimes(1);
		const saved: Array<{ _getType: () => string; content: string }> =
			memory.chatHistory.addMessages.mock.calls[0][0];

		const types = saved.map((m) => m._getType());
		expect(types).toContain('human'); // user turn was saved
		expect(types).toContain('ai');    // assistant response was saved
	});

	it('drops an orphaned leading message after the k-window slice', async () => {
		const instance = getInstance();
		// Odd history: ai message without a preceding human — simulates a mid-turn failure
		const memory = makeMockMemory([
			{ type: 'ai', content: 'Orphaned assistant message' },
			{ type: 'human', content: 'Clean turn' },
			{ type: 'ai', content: 'Clean answer' },
		]);
		const ctx = makeMockExecute({
			memory,
			httpResponses: [DEFAULT_AGENT_DETAILS, makeCompletion('ok')],
		});
		await instance.execute.call(ctx);

		const postCall = (ctx.helpers.httpRequestWithAuthentication.call as jest.Mock).mock.calls[1][2];
		const msgs: Array<{ role: string; content: string }> = postCall.body.messages;
		expect(msgs.some((m) => m.content === 'Orphaned assistant message')).toBe(false);
		expect(msgs.some((m) => m.content === 'Clean turn')).toBe(true);
	});

	it('does not save nonSysMessages multiple times across turns', async () => {
		const instance = getInstance();
		const memory = makeMockMemory();

		// Turn 1
		await runNode(instance, {
			memory,
			httpResponses: [DEFAULT_AGENT_DETAILS, makeCompletion('Answer 1')],
		});

		// Turn 2 — memory now contains turn 1's messages
		await runNode(instance, {
			memory,
			httpResponses: [DEFAULT_AGENT_DETAILS, makeCompletion('Answer 2')],
		});

		// addMessages should have been called once per turn, each call saving
		// only the new messages — not re-saving the prompt template messages.
		const allSaved: Array<{ _getType: () => string }> =
			memory.chatHistory.addMessages.mock.calls.flat(2);
		const humanMessages = allSaved.filter((m) => m._getType() === 'human');
		// Exactly 2 human messages saved across 2 turns (one per turn)
		expect(humanMessages).toHaveLength(2);
	});
});

// ── Tool calls ────────────────────────────────────────────────────────────────

describe('tool call loop', () => {
	it('invokes a tool and feeds the result back before the final response', async () => {
		const instance = getInstance();
		const toolInvoke = jest.fn().mockResolvedValue('tool result value');
		const mockTool = { name: 'myTool', description: 'does stuff', invoke: toolInvoke };

		const ctx = makeMockExecute({
			tools: [mockTool],
			httpResponses: [
				DEFAULT_AGENT_DETAILS,
				makeToolCallCompletion('myTool', { arg: 'value' }),
				makeCompletion('Final answer'),
			],
		});
		await instance.execute.call(ctx);

		expect(toolInvoke).toHaveBeenCalledWith({ arg: 'value' });

		const postCalls = (ctx.helpers.httpRequestWithAuthentication.call as jest.Mock).mock.calls.slice(1);
		// Second LLM request should include the tool result message
		const secondRequestMsgs = postCalls[1][2].body.messages;
		const toolMsg = secondRequestMsgs.find((m: { role: string }) => m.role === 'tool');
		expect(toolMsg?.content).toBe('tool result value');
	});

	it('throws after MAX_TOOL_ITERATIONS without a final response', async () => {
		const instance = getInstance();
		const mockTool = {
			name: 'loop',
			description: 'loops forever',
			invoke: jest.fn().mockResolvedValue('loop'),
		};
		// Return tool_calls indefinitely
		const toolCallResponse = makeToolCallCompletion('loop', {});
		const ctx = makeMockExecute({
			tools: [mockTool],
			httpResponses: [
				DEFAULT_AGENT_DETAILS,
				...Array(10).fill(toolCallResponse),
			],
		});
		await expect(instance.execute.call(ctx)).rejects.toThrow(
			/did not produce a final response/i,
		);
	});

	it('throws when the API returns no choices', async () => {
		const instance = getInstance();
		const ctx = makeMockExecute({
			httpResponses: [DEFAULT_AGENT_DETAILS, { choices: [] }],
		});
		await expect(instance.execute.call(ctx)).rejects.toThrow(
			/no choices/i,
		);
	});

	it('throws when a tool invocation fails', async () => {
		const instance = getInstance();
		const brokenTool = {
			name: 'brokenTool',
			description: 'fails',
			invoke: jest.fn().mockRejectedValue(new Error('tool exploded')),
		};
		const ctx = makeMockExecute({
			tools: [brokenTool],
			httpResponses: [
				DEFAULT_AGENT_DETAILS,
				makeToolCallCompletion('brokenTool', {}),
			],
		});
		await expect(instance.execute.call(ctx)).rejects.toThrow(/tool exploded/i);
	});
});

// ── Error handling ────────────────────────────────────────────────────────────

describe('error handling', () => {
	it('continues with an error json item when continueOnFail is true', async () => {
		const instance = getInstance();
		const ctx = makeMockExecute({
			httpResponses: [{ promptVersion: null, id: 'agent-123', nid: 'nid-123', variables: [], prompt: { id: 'p-1', nid: 'p-nid-1', name: 'Test' } }],
		});
		(ctx.continueOnFail as jest.Mock).mockReturnValue(true);
		const [[result]] = await instance.execute.call(ctx);
		expect(result?.json).toHaveProperty('error');
	});

	it('re-throws when continueOnFail is false', async () => {
		const instance = getInstance();
		const ctx = makeMockExecute({
			httpResponses: [{ promptVersion: null, id: 'agent-123', nid: 'nid-123', variables: [], prompt: { id: 'p-1', nid: 'p-nid-1', name: 'Test' } }],
		});
		(ctx.continueOnFail as jest.Mock).mockReturnValue(false);
		await expect(instance.execute.call(ctx)).rejects.toThrow();
	});
});
