# Changelog

## 1.0.23

- Added selectable question cards with option descriptions, custom answers, and explicit submission. Selections and input focus stay intact during streaming updates.
- Enabled Codex questions during ordinary coding tasks and connected Claude AskUserQuestion, including multiple selections. Questions wait for your answer even with permission prompts disabled.
- Send answers back to the running task, dismiss resolved requests, and support skipping questions or cancelling the task.

## 1.0.22

- Track active runtime items so reasoning and delayed completion events cannot replace live response writing, file edits, or terminal commands.
- Handle streamed plans, reasoning notifications, browser tool progress, and file output. Ignore activity from other chats and previous turns, and reset tracking between tasks.
- Distinguish file writes, edits, and removals; use a neutral thinking label only while reasoning is the current observed activity.

## 1.0.21

- Made live completion updates describe the actual command, file change, search, browser operation, tool call, or delegated agent task, including useful targets and command exit codes.

## 1.0.20

- Set Anthropic Sans as the default interface and conversation font, loading the variable font from Anthropic's CDN with system-font fallbacks.

## 1.0.16

- Bundled Chromium and Playwright browser tools for Codex, Claude, and external provider sessions. Agents can open local web apps, inspect pages, click, type, drag, take screenshots, and check console and network activity without installing a separate browser.
- Enabled browser tools for new, resumed, and branched sessions, using isolated browser profiles. Added browser activity cards to the conversation and saved session history.

## 1.0.15

- Added explicit file creation and exact-text edit tools for NVIDIA and other routed models whose runtime lacks a native patch tool. File operations use the existing runtime sandbox and approval controls, and custom patch calls now emit complete input events.
- Fixed NVIDIA GPT-OSS tool names containing a Harmony channel suffix; verified file creation and editing against the live NVIDIA API.
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
