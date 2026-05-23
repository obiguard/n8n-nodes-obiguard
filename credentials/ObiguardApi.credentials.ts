import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
	Icon,
} from 'n8n-workflow';

export class ObiguardApi implements ICredentialType {
	name = 'obiguardApi';
	displayName = 'Obiguard API';
	icon: Icon = 'file:obiguard.svg';
	documentationUrl = 'https://docs.obiguard.ai';

	properties: INodeProperties[] = [
		{
			displayName: 'Host URL',
			name: 'hostUrl',
			type: 'string',
			default: 'https://gateway.obiguard.ai',
		},
		{
			displayName: 'Access Key',
			name: 'accessKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'x-obiguard-api-key': '={{$credentials.accessKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.hostUrl}}',
			url: '/v1/auth',
			method: 'GET',
		},
	};
}
