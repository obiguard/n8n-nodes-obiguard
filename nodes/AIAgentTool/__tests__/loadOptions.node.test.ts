/* eslint-disable n8n-nodes-base/node-param-display-name-miscased, n8n-nodes-base/node-param-display-name-untrimmed */
import { AiAgentTool } from '../AiAgentTool.node';
import { makeMockLoadOptions, DEFAULT_AGENT_DETAILS } from './helpers';

function getInstance() {
	return new AiAgentTool();
}

// ── loadAgents ────────────────────────────────────────────────────────────────

describe('loadOptions.loadAgents', () => {
	it('maps agents to dropdown options using "<id>:::<name>" values', async () => {
		const instance = getInstance();
		const ctx = makeMockLoadOptions({
			httpResponses: [
				{
					agents: [
						{ id: 'agent-1', name: 'First Agent' },
						{ id: 'agent-2', name: '' },
					],
				},
			],
		});

		const options = await instance.methods.loadOptions.loadAgents.call(ctx);

		expect(options).toEqual([
			{ name: 'First Agent', value: 'agent-1:::First Agent' },
			{ name: 'agent-2', value: 'agent-2:::agent-2' },
		]);
	});

	it('returns an empty list when the API returns no agents', async () => {
		const instance = getInstance();
		const ctx = makeMockLoadOptions({ httpResponses: [{}] });

		const options = await instance.methods.loadOptions.loadAgents.call(ctx);

		expect(options).toEqual([]);
	});

	it('throws a NodeOperationError when the request fails', async () => {
		const instance = getInstance();
		const ctx = makeMockLoadOptions({ httpError: new Error('network down') });

		await expect(instance.methods.loadOptions.loadAgents.call(ctx)).rejects.toThrow(
			/failed to load agents/i,
		);
	});
});

// ── loadPromptLabel ──────────────────────────────────────────────────────────

describe('loadOptions.loadPromptLabel', () => {
	it('returns a placeholder when no agent is selected', async () => {
		const instance = getInstance();
		const ctx = makeMockLoadOptions({ aiAgentId: '' });

		const options = await instance.methods.loadOptions.loadPromptLabel.call(ctx);

		expect(options).toEqual([{ name: '—', value: 'none' }]);
	});

	it('returns the prompt name and version label for the selected agent', async () => {
		const instance = getInstance();
		const ctx = makeMockLoadOptions({ httpResponses: [DEFAULT_AGENT_DETAILS] });

		const options = await instance.methods.loadOptions.loadPromptLabel.call(ctx);

		expect(options).toEqual([{ name: 'Test Prompt (v1)', value: 'promptLabel' }]);
	});

	it('renders an empty label when prompt details are missing', async () => {
		const instance = getInstance();
		const ctx = makeMockLoadOptions({
			httpResponses: [{ ...DEFAULT_AGENT_DETAILS, prompt: undefined, promptVersion: undefined }],
		});

		const options = await instance.methods.loadOptions.loadPromptLabel.call(ctx);

		expect(options).toEqual([{ name: ' ()', value: 'promptLabel' }]);
	});

	it('returns "(Failed to Load)" when the request fails', async () => {
		const instance = getInstance();
		const ctx = makeMockLoadOptions({ httpError: new Error('boom') });

		const options = await instance.methods.loadOptions.loadPromptLabel.call(ctx);

		expect(options).toEqual([{ name: '(Failed to Load)', value: 'none' }]);
	});

	it('resolves the agent id from the legacy JSON-encoded selection format', async () => {
		const instance = getInstance();
		const ctx = makeMockLoadOptions({
			aiAgentId: JSON.stringify({ id: 'agent-123', name: 'Legacy Agent' }),
			httpResponses: [DEFAULT_AGENT_DETAILS],
		});

		const options = await instance.methods.loadOptions.loadPromptLabel.call(ctx);

		expect(options).toEqual([{ name: 'Test Prompt (v1)', value: 'promptLabel' }]);
		expect(ctx.helpers.httpRequestWithAuthentication.call).toHaveBeenCalledWith(
			ctx,
			'obiguardApi',
			expect.objectContaining({ url: '/v1/ai-agents/agent-123' }),
		);
	});

	it('resolves the agent id from a raw id string (oldest saved format)', async () => {
		const instance = getInstance();
		const ctx = makeMockLoadOptions({
			aiAgentId: 'agent-123',
			httpResponses: [DEFAULT_AGENT_DETAILS],
		});

		const options = await instance.methods.loadOptions.loadPromptLabel.call(ctx);

		expect(options).toEqual([{ name: 'Test Prompt (v1)', value: 'promptLabel' }]);
	});
});

// ── loadAgentVariables ───────────────────────────────────────────────────────

describe('resourceMapping.loadAgentVariables', () => {
	it('returns an empty field list when no agent is selected', async () => {
		const instance = getInstance();
		const ctx = makeMockLoadOptions({ aiAgentId: '' });

		const result = await instance.methods.resourceMapping.loadAgentVariables.call(ctx);

		expect(result).toEqual({ fields: [] });
	});

	it('maps the prompt version variables to resource mapper fields', async () => {
		const instance = getInstance();
		const ctx = makeMockLoadOptions({ httpResponses: [DEFAULT_AGENT_DETAILS] });

		const result = await instance.methods.resourceMapping.loadAgentVariables.call(ctx);

		expect(result.fields).toEqual([
			{
				id: 'name',
				displayName: 'name',
				type: 'string',
				required: true,
				allowEmptyValues: true,
				defaultMatch: false,
				canBeUsedToMatch: false,
				display: true,
			},
		]);
	});

	it('returns an empty field list when the request fails', async () => {
		const instance = getInstance();
		const ctx = makeMockLoadOptions({ httpError: new Error('boom') });

		const result = await instance.methods.resourceMapping.loadAgentVariables.call(ctx);

		expect(result).toEqual({ fields: [] });
	});
});
