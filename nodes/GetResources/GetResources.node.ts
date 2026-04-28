import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeApiError } from 'n8n-workflow';

export class GetResources implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Get Resources',
		name: 'getResources',
		icon: 'file:getresources.svg',
		group: ['input'],
		version: [1],
		description: 'Get resources from ObiGuard',
		defaults: {
			name: 'Get Resources',
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
		properties: [],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const credentials = await this.getCredentials('obiguardApi');
				const hostUrl = credentials.hostUrl as string;

				const response = await this.helpers.httpRequestWithAuthentication.call(this, 'obiguardApi', {
					method: 'GET',
					url: '/v1/resources',
					baseURL: hostUrl,
					returnFullResponse: false,
				});

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
