export interface Agent {
	id: string;
	name?: string;
}

export interface AgentResponse {
	agents?: Agent[];
}
