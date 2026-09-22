# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project is pre-1.0; versions may include breaking changes.

## [Unreleased]

### Added

- Open-source project docs: contributing guide, developer and maintenance guides, security policy, code of conduct, GitHub issue/PR templates, and CI.
- LLM provider plugins (`LlmProviderPlugin` + `registerLlmProvider`). A generic API key defaults to OpenCode Go, lists models from `GET /v1/models`, and routes chat / Responses / Anthropic Messages per model.
