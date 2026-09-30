# Changelog

## 1.0.12

- Kept the OpenAI mark for the welcome screen and live activity spinner, with no background tile behind the welcome mark.

## 1.0.11

- Matched the desktop app, welcome screen, activity indicator, and Windows app icon to the Forge website logo.

## 1.0.10

- Fixed current Codex permission request methods so external-model requests show actionable Accept and Decline controls.
- Added a persistent Settings toggle for external-model approval prompts; turning it off grants full access without prompts.
- Configured official Codex Code mode for full file-system and network access without approval prompts. Ask and Plan remain read-only.

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
