# Changelog

## 1.0.42

- Open the OmniRoute dashboard through the desktop's Windows browser integration, including loopback HTTP links and custom local gateway ports.
- Start an installed gateway when opening its dashboard and show actionable startup errors in the provider panel.
- Recover OmniRoute free auto routes from OpenCode-only access restrictions, invalid credentials, quota limits, unavailable upstreams, and errors before streaming begins.
- Try compatible Kilo, OpenRouter, Groq, and NVIDIA integrations using keys already saved in Forge; OpenRouter fallback discovers zero-price models with tool support.
- Remember a responding route, cool down rejected routes, display the selected fallback in chat, and reset routing when provider settings change.
- Preserve Codex tool execution and project instructions across fallback; never replay partial output or switch providers during output-limit continuation.
- Add desktop-link, routing, dashboard, and live file-operation regression coverage.

## 1.0.41

- Add native local OmniRoute setup with an in-app installer, startup/status feedback, dashboard access, optional gateway key, and persisted provider configuration.
- Install the pinned gateway into Forge's data folder using a bundled npm runtime; no global Node or npm installation is required in the desktop app.
- Default to auto/coding:free and auto/fast:free, bind the managed gateway to localhost, and disable empty-free-pool fallback to paid models.
- Automatically start an installed local gateway for inference and shut down Forge-owned processes on desktop exit; preserve separately running gateways.
- Give Groq concise base instructions while preserving project rules, user input, developer messages, permissions, and tool history.
- Normalize GPT-OSS tool names with local validation and retry one provider-rejected malformed inference before any output or tool execution.
- Cover local gateway ownership/authentication, provider setup, tool repair, and real Groq file operations with regression checks.


## 1.0.40

- Prevent Groq, Kilo, and other Chat Completions providers from receiving more than 128 tool definitions.
- Keep file and shell functions visible, prioritize relevant and recent tools, and discover remaining plugin functions on demand.
- Handle discovery inside Forge while retaining Codex execution, permissions, original namespaces, and complete schemas.
- Reduce Groq tool-schema overhead, adjust oversized output reserves once, and respect short free-plan cooldowns before streaming.
- Add catalog, discovery, permission, output recovery, and opt-in live provider file-operation checks.

## 1.0.39

- Fix Manage providers failing to open when Free Auto Route is enabled: derived routing entries have no API base URL.
- Render Free Auto Route as a managed routing entry with a Configure button that opens its settings.
- Keep Edit and Remove actions for saved API providers and guard missing endpoint/model metadata.
- Extend the provider UI regression check with persisted Free Auto Route and NVIDIA configuration.

## 1.0.38

- Keep the model menu and Manage providers button inside the window, including short windows, pill composers, and long catalogs.
- Allow provider setup when no models are loaded and preserve search, keyboard navigation, and outside-click behavior.
- Correct NVIDIA GPT-OSS function names that contain channel/JSON metadata while validating every call against advertised tools.
- Normalize NVIDIA system instructions, respect GPT-OSS output limits, forward supported reasoning effort settings, and retry temporary HTTP server failures once before any output.
- Preserve original file-helper calls in conversation history so models can track multi-step writes and edits.
- Start the NVIDIA preset with GPT-OSS 20B; preserve the Codex executor for actual file writes and edits.
- Add provider UI and NVIDIA request/tool translation regression checks.

## 1.0.37

- Add native Kilo Gateway Auto Free routing with a single Kilo API key and guided setup.
- Restrict the native preset to the official gateway and kilo-auto/free, including saved configuration and inference requests.
- Validate the free route against live pricing/tool support during discovery; preserve server-side dynamic model selection.
- Add Kilo branding, quota/unavailability errors, and upstream data-handling guidance.

## 1.0.36

- Add a native Groq Free provider preset with key setup links, coding model defaults, and free-plan limits guidance.
- Discover supported active coding models from the authenticated Groq catalog.
- Add Groq Chat Completions compatibility, sequential GPT-OSS tools, bounded completion size, and useful quota errors.
- Keep ChatGPT connected while Groq uses its own account and quota.

## 1.0.35

- Added a native computer-use connection diagnostic with helper health, real window inventory, displays, embedded browser pages, and recovery guidance.
- Distinguish Forge desktop access from empty inventories in other Codex plugins. Models can open File Explorer or an embedded browser even when no app or tab is listed.
- Share desktop recovery instructions across Codex, Claude, and external providers.
- Report Windows enumeration failures instead of silently returning an empty list.

## 1.0.34

- Add a smooth browser-panel exit with a temporary native-page snapshot, chat-layout expansion, and an immediate reduced-motion path.
- Cancel pending closes when reopening the panel and keep completed navigation from overriding the user's decision to close it.
- Update the website's hero, social preview, and model-picker images with captures from the current desktop interface.

## 1.0.33

- Register Forge's computer/browser MCP tools at Codex runtime startup as well as thread start/resume; refresh resumed sessions after runtime or plugin reconnection.
- Add desktop window discovery, restore/focus, and app/file/system-browser opening tools.
- Correct native mouse coordinates on displays with different scaling; restart stalled desktop helpers and report their actual errors.
- Add explicit embedded-browser reopening, renderer recovery, usable-document navigation waits, and clear load failures.
- Preserve real browser login popups and their opener/session, with tools to list, select, and close pages.
- Cancel queued computer-use actions when their tool request is abandoned, without automatically replaying input.

## 1.0.32

- Fixed Windows file links beginning with `/C:/` so valid workspace files no longer resolve to a duplicated drive such as `C:\C:\`.
- Added file URI, encoded-space, UNC, and source-line handling shared by chat links and the workspace API.
- Archive, document, and media links open with their Windows application in the desktop app, with an authenticated download fallback in the browser.
- Source links now reveal the code preview panel when clicked.

## 1.0.31

- Fixed cached chat switching to resynchronize the server’s active workspace before file actions run, preventing valid project files from being rejected against a different chat’s folder.
- Made workspace boundary errors show the requested path and active workspace to make future path mismatches clear.

## 1.0.30

- Prevented custom providers from exposing text-form pseudo tool calls as assistant output; Forge reports a clear provider compatibility error and never executes unstructured tool text.
- Added provider guidance to use only advertised structured function calls.

## 1.0.29

- Improved custom Chat Completions tool calling by preserving strict schemas, named and restricted tool choices, and parallel-call settings. Added support for non-streaming responses and legacy function-call streams while keeping tool execution inside the Codex runtime.

## 1.0.28

- Added host-level Windows desktop controls for computer use, including screenshots, pointer movement and clicks, scrolling, keyboard input, and shortcuts across apps.
- Improved the Graphite and Midnight theme palettes and restored saved built-in themes from their canonical colors.

## 1.0.27

- Fixed welcome suggestion cards falling behind the composer after resizing or entering full screen by recalculating their position from live layout geometry.

## 1.0.26

- Added plugin setup panels with connected-app callable status, connection links, enablement, and MCP OAuth login.
- Added plugin form and URL sign-in requests, and connected-app mentions for Vercel and other Codex plugins, including external API sessions using the Codex runtime.
- Made the browser MCP configuration additive so existing MCP servers remain available.
- Added a browser panel alongside chat with resizing, expansion, live status, rounded native viewport, and smoother scrolling and dragging.
- Fixed browser startup, native wheel direction, drag button state, typing completion, and repeated forced switching away from chat.
- Checked real Electron clicks, typing, dragging, scrolling, screenshot sizing, browser visibility, Vercel connection status, and plugin form rendering.

## 1.0.25

- Added a visible in-app browser to the Windows desktop app with address bar, navigation controls, and a persistent browser profile.
- Connected Codex and Claude computer-use tools to that same browser so their navigation, screenshots, clicks, typing, and scrolling are visible in Forge.
- Kept isolated Chromium browser tools for the browser-based Forge workflow.

## 1.0.24

- Added a Codex-synced Plugins manager for installed plugins, discovery, enablement, and marketplace sources.
- Added `@` plugin suggestions in the composer and native Codex plugin mentions for enabled plugins.

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
