# Changelog

## 1.0.9

- Added prompt editing and retry controls, with retries starting from a new conversation branch.
- Added Revert to here, which opens a branch before the chosen prompt and preserves the original conversation.
- Added branch support for Codex, external API providers, and Claude sessions.
- Clarified that conversation rewind does not undo project file changes.

## 1.0.8

- Added Codex Plan mode, with a read-only sandbox and an implementation plan preview.
- Added OpenRouter Free Auto Route, discovering zero-price, tool-capable models and ranking them by OpenRouter coding benchmarks.
- Added NVIDIA NIM fallback when OpenRouter free models are exhausted or unavailable.
- Added optional Codex usage-limit fallback that carries conversation context into a linked routing session.
- Added device-encrypted provider keys and real-time model selection/activity updates.
