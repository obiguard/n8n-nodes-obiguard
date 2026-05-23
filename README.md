# n8n-nodes-obiguard

This is an n8n community node. It lets you use [Obiguard](https://obiguard.com) in your n8n workflows.

Obiguard is an AI risk governance platform that lets you deploy, manage, and invoke AI agents with built-in prompt versioning, variable substitution, and observability.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

[Installation](#installation)
[Operations](#operations)
[Credentials](#credentials)
[Compatibility](#compatibility)
[Resources](#resources)
[Version history](#version-history)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation.

The package name is `n8n-nodes-obiguard`.

## Operations

### Get Resources

Retrieves the list of available AI agents from your Obiguard instance. Returns the full agent catalogue so you can inspect which agents are available without invoking them.

### Obiguard AI Agent

Invokes a selected AI agent and returns its response. Supports:

- **Variable substitution** — map n8n data to prompt variables defined in the agent's active prompt version
- **Conversation memory** — connect an n8n Memory node to maintain chat history across executions
- **Tool calling** — connect n8n Tool nodes so the agent can call back into n8n mid-run
- **Structured output** — connect an n8n Output Parser node to enforce a typed response schema

## Credentials

You will need an Obiguard account and an API access key.

1. Log in to your Obiguard instance
2. Create an **Organization** and a **Project**.
3. In your **Organization**, set up your **Environment** and **AI Providers**.
3. In your **Project**, set up your **AI Use Case**, **Prompt**, and ** AI Agent**.
2. Navigate to **Access Keys** and create a new access key.
3. In n8n, create a new **Obiguard API** credential and fill in:
   - **Host URL** — the base URL of your Obiguard gateway, e.g. `https://gateway.obiguard.com`
   - **Access Key** — the API key you generated above

The credential sends the key as the `x-obiguard-api-key` request header on every call.

## Compatibility

Tested against n8n version 1.x. Requires `n8nNodesApiVersion: 1`.

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [Obiguard documentation](https://docs.obiguard.ai)

## Version history

See [CHANGELOG.md](CHANGELOG.md).
