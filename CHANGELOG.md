# Changelog

## [0.2.0] — 2026-05-23

### Changed

- Removed **Get Resources** node (functionality is available inside the AI Agent node's agent dropdown)
- Renamed package to `@obiguard/n8n-nodes-obiguard` (scoped under the Obiguard org)
- Node group changed from `input` to `transform`
- Improved node and property descriptions

## [0.1.0] — 2026-05-23

### Added

- **Obiguard AI Agent** node — invokes an AI agent with support for variable substitution, conversation memory, tool calling, and structured output via an output parser
- **Obiguard API** credential — authenticates via Host URL and Access Key (`x-obiguard-api-key` header)
