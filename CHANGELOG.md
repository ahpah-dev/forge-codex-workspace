# Changelog

## 1.0.15

- Increased routed model output budgets and added up to two automatic recovery attempts for length-limited responses. Incomplete tool calls are discarded and regenerated; completed tools are not replayed.
- Fixed NVIDIA NIM and other Chat Completions providers with a local API adapter, automatic NVIDIA/OpenRouter detection, and provider API format selection. Existing provider sessions reconnect with the current configuration.
- Added a draggable chatbox height grip and saved Rounded, Pill, and Square shapes in Appearance settings, with subtle interface refinements.

## 1.0.14

- Added live code previews for provider file-edit events, with line numbers, additions/removals, and optional automatic scrolling. Claude Write/Edit inputs appear as they stream; Codex patches appear as the runtime exposes them.
- Matched the desktop, Start menu, pinned taskbar, and running-window icons to the same transparent Forge logo; installation refreshes existing shortcuts.
- Added image attachments to the composer, including paste-from-clipboard, previews, and removal controls.
- Send up to four PNG, JPEG, WebP, or GIF images to Codex, Claude, and compatible providers (up to 9 MB per message).

## 1.0.13

- Restored the OpenAI mark's theme colors in the welcome screen and activity spinner.
- Rebuilt the Windows icon in multiple sizes with transparent corners for clearer taskbar and desktop shortcut display.

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
