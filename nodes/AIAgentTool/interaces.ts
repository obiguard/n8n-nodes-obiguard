export interface Agent {
	id: string;
	name?: string;
}

export interface AgentResponse {
	agents?: Agent[];
}

export interface AgentDetails {
	id: string;
	nid: string;
	name?: string;
	description?: string;
	project?: {
		id: string;
		projectName: string;
		projectDescription: string;
	};
	promptVersion: {
		id: string;
		nid: string;
		label: string;
		systemPrompt: string;
		messages: string[];
		temperature: number;
		maxTokens: number;
		stopSequences: string[];
		variables: string[];
	};
	variables: string[];
}
