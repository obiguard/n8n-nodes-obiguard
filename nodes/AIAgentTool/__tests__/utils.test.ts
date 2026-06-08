import { substituteVariables } from '../utils';
import { getInputs } from '../getInputs';

describe('substituteVariables', () => {
	it('replaces a single variable', () => {
		expect(substituteVariables('Hello {{name}}', { name: 'Alice' })).toBe('Hello Alice');
	});

	it('replaces multiple variables', () => {
		expect(
			substituteVariables('{{greeting}} {{name}}', { greeting: 'Hi', name: 'Bob' }),
		).toBe('Hi Bob');
	});

	it('replaces the same variable used more than once', () => {
		expect(substituteVariables('{{x}} and {{x}}', { x: 'foo' })).toBe('foo and foo');
	});

	it('replaces variables with whitespace inside braces', () => {
		expect(substituteVariables('{{ name }}', { name: 'Charlie' })).toBe('Charlie');
	});

	it('replaces an unknown variable with an empty string', () => {
		expect(substituteVariables('Hello {{unknown}}', {})).toBe('Hello ');
	});

	it('leaves text without variables unchanged', () => {
		expect(substituteVariables('No variables here', {})).toBe('No variables here');
	});
});

describe('getInputs', () => {
	it('includes a main input when hasMainInput is true', () => {
		const inputs = getInputs(true);
		expect(inputs[0]).toBe('main');
	});

	it('omits the main input when hasMainInput is false', () => {
		const inputs = getInputs(false);
		expect(inputs.every((i) => i !== 'main')).toBe(true);
	});

	it('includes memory, tool, and output-parser inputs by default', () => {
		const inputs = getInputs(true, true);
		const types = inputs.map((i) => (typeof i === 'object' ? i.type : i));
		expect(types).toContain('ai_memory');
		expect(types).toContain('ai_tool');
		expect(types).toContain('ai_outputParser');
	});

	it('excludes output-parser input when hasOutputParser is false', () => {
		const inputs = getInputs(true, false);
		const types = inputs.map((i) => (typeof i === 'object' ? i.type : i));
		expect(types).not.toContain('ai_outputParser');
	});

	it('limits memory and output-parser to 1 connection', () => {
		const inputs = getInputs(true, true);
		for (const input of inputs) {
			if (typeof input === 'object') {
				if (input.type === 'ai_memory' || input.type === 'ai_outputParser') {
					expect(input.maxConnections).toBe(1);
				}
			}
		}
	});
});
