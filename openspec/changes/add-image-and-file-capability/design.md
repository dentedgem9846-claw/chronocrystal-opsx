## Context

Kawa is a personal coding agent accessed through SimpleX Chat. The pi-coding-agent SDK (`@mariozechner/pi-coding-agent`) supports `ImageContent` in `session.prompt(text, { images })` and custom tools. The SimpleX Chat SDK exposes file transfer lifecycle (`apiReceiveFile`, `apiSendMessages` with `filePath`/`MsgContent.Image`/`MsgContent.File`) and file status events (`rcvFileStart`, `rcvFileComplete`, `sndFileComplete`, etc.). Currently Kawa's event loop only processes text content — `extractTextFromContent()` returns `undefined` for any `MsgContent` type other than `"text"`, and file-related events are silently ignored.

The Gemma 3 model (via Ollama) supports images natively through `ImageContent`. Video is handled by extracting frames with ffmpeg and sending the frames as images. Ollama's API has no native video field — the standard approach (used in Google's own Gemma tutorial) is `ffmpeg -i video.mp4 -vf fps=1 frames/%04d.jpg`.

## Goals / Non-Goals

**Goals:**
- Receive images from contacts and pass them to the agent as vision input
- Receive videos from contacts, extract key frames, and pass them to the agent as vision input
- Receive files from contacts and make them accessible to the agent via file path reference
- Send images from the agent to contacts as inline SimpleX images
- Send files from the agent to contacts as SimpleX file attachments
- Auto-accept all incoming file transfers (personal app, no confirmation needed)
- Buffer incoming messages with attachments until the file transfer completes before prompting the agent

**Non-Goals:**
- Group chat file sharing (only direct messages, matching current Kawa scope)
- Voice message transcription (no `MsgContent.Voice` handling)
- Inline image display during live message streaming (send as separate message instead)
- File size quotas or access frequency tracking (personal app, unlimited)
- Persistent file storage with retention policies (simple flat directory)
- Transcoding or format conversion of received files

## Decisions

### D1: Split storage layout under cwd

**Decision**: Files stored in `<cwd>/kawa-files/{images,videos,files}/` configurable via `KAWA_FILES_DIR`.

**Rationale**: Keeps everything under the project root (user explicitly said no home directory). Split subdirectories make it easy to differentiate file types at a glance and apply type-specific processing (image resize, video frame extraction).

**Alternatives considered**:
- Flat directory with filename prefixes → harder to manage, no clear separation
- Home directory (`~/.kawa/`) → explicitly rejected by user

### D2: Buffer-then-prompt for incoming files

**Decision**: When an incoming message has a file attachment (detected via `CIFile` on the `ChatItem`), hold the text and wait for the file transfer to complete before prompting the agent. If the transfer takes longer than a timeout (default 30s), prompt with text only plus a note like "[1 image attached, still downloading]".

**Rationale**: Vision models need the image data at prompt time — sending text without the image, then sending a follow-up with the image, means the model can't connect the text to the visual content. Buffering ensures the agent sees everything together. The timeout prevents blocked conversations on slow transfers.

**Key SDK insight**: Text captions arrive embedded in the `MsgContent` variant itself (`MsgContent.Image.text`, `MsgContent.File.text`), not as a separate event. A single `newChatItems` event carries both the caption text and the file reference (`ChatItem.file: CIFile`). The file transfer lifecycle (`rcvFileStart`, `rcvFileComplete`) is tracked via separate events with their own `AChatItem` fields. Kawa calls `apiReceiveFile(fileId)` when it sees a `CIFile` with `fileStatus === "rcvInvitation"`, then waits for `rcvFileComplete` before prompting.

**Alternatives considered**:
- Prompt immediately, follow up with image → model can't associate text with image context
- Block indefinitely until transfer completes → slow or stalled transfers block the conversation

### D3: Video → frames via ffmpeg

**Decision**: Extract key frames from video using `ffmpeg -i <video> -vf fps=1 <output_dir>/%04d.jpg`, resize each frame with `sharp` (the `sharp` npm package), then send all frames as `ImageContent[]` to the agent.

**Rationale**: No Ollama model supports native video input through the API. The Qwen video support PR for Ollama is still open after 6+ months. Google's own Gemma tutorial uses this exact approach. ffmpeg is the standard tool for frame extraction, and `fps=1` gives one frame per second which is sufficient for most conversations. `sharp` is used for frame resizing rather than the pi agent's internal `resizeImage` utility, which is not part of the public API and cannot be imported.

**Alternatives considered**:
- Subagent in tmux to research video handling → overkill for a deterministic problem; the answer is ffmpeg
- Wait for native Ollama video API → could be months away, PR #12962 is stalled
- Send whole video file to agent → no API supports this; ImageContent only accepts image data
- Use pi agent's `resizeImage` utility → not part of the public API (`@mariozechner/pi-coding-agent` does not export it from `index.d.ts`); also its interface takes `ImageContent` (base64) not a file path, which doesn't match our use case

### D4: Image auto-resize before sending to agent

**Decision**: Resize received images to max 2048px on the longest side before converting to `ImageContent`. Use the `sharp` npm package for resizing.

**Rationale**: Large images (4K+ screenshots) blow through LLM context windows. 2048px preserves detail while keeping token count manageable. `sharp` is a well-maintained, fast native image processing library for Node.js that handles resize, format conversion, and quality optimization. The pi agent has an internal `resizeImage` utility, but it is not exported from the public API and cannot be imported — additionally, its interface takes `ImageContent` (base64 string) rather than a file path, which doesn't match our pipeline that reads from disk.

**Alternatives considered**:
- No resize → LLM context overflow on large images
- Pi agent's `resizeImage` → not part of the public API (`@mariozechner/pi-coding-agent/dist/utils/image-resize` is an internal module not exported from `index.d.ts`); also takes `ImageContent` not file paths
- Convert to a fixed format → unnecessary complexity, sharp handles format selection

### D5: send_image and send_file as pi custom tools

**Decision**: Register `send_image` and `send_file` as custom tools via `createAgentSession`'s `customTools` option. The tools take a `path` parameter (relative to cwd or absolute), validate it's within allowed paths, read the file, and send it via `MessageSender`.

**Rationale**: The pi agent SDK's `CreateAgentSessionOptions` interface includes a `customTools?: ToolDefinition[]` field (confirmed in `@mariozechner/pi-coding-agent/dist/core/sdk.d.ts`). The package also exports a `defineTool` helper for constructing `ToolDefinition` objects. This is the cleanest integration — the tools appear in the agent's tool list naturally, and the agent decides when to use them based on conversation context.

**Alternatives considered**:
- Slash commands (`/send`) → requires user action, not agent-initiated
- Auto-detect file references in agent output → fragile, prone to false positives
- Separate HTTP endpoint → breaks the agent-driven interaction model
- `session.registerTool()` post-creation → not needed; `customTools` in `createAgentSession` is the correct API

### D6: File type routing based on MsgContent type

**Decision**: Route incoming content by `MsgContent` type:
- `MsgContent.Image` → save to `kawa-files/images/`, resize, send to agent as `ImageContent`
- `MsgContent.Video` → save to `kawa-files/videos/`, extract frames, send frames as `ImageContent[]`
- `MsgContent.File` → save to `kawa-files/files/`, tell agent "📎 Attached: filename at path"
- `MsgContent.Voice` → non-goal, log and skip
- `MsgContent.Link` → non-goal, extract text only (existing behavior)

**Rationale**: The SimpleX SDK provides clear type discrimination on `MsgContent`. Each type has different downstream processing needs. This maps cleanly to the user's requirement that "files and images should be differentiated."

### D7: Outgoing messages use apiSendMessages with filePath

**Decision**: Send images and files via `ChatClient.apiSendMessages()` with:
- Images: `ComposedMessage` with `msgContent: { type: "image", text: caption, image: base64 }` and `filePath`
- Files: `ComposedMessage` with `msgContent: { type: "file", text: filename }` and `filePath`

**Rationale**: The SDK's `ComposedMessage` type has a `filePath` optional field for sending files. Combined with the appropriate `MsgContent` type, this is the standard way to send files through SimpleX. The `filePath` points to the local file on disk.

**SDK note**: `ComposedMessage` structure is `{ fileSource?: CryptoFile, quotedItemId?: number, msgContent: MsgContent, mentions: { [key: string]: number } }`. The `filePath` is set via the `fileSource` field (as `CryptoFile`), not a direct `filePath` property on `ComposedMessage`. The `MsgContent.Image` variant for sending has `{ type: "image", text: string, image: string }` and `MsgContent.File` has `{ type: "file", text: string }`.

### D8: Prerequisite check for ffmpeg

**Decision**: Check for `ffmpeg` availability on startup (same pattern as `detectSimplexBin`). If ffmpeg is not found, log a warning and disable video frame extraction — images and files still work fine without it.

**Rationale**: ffmpeg is only needed for video. Images and files work without it. A hard requirement would break Kawa on systems without ffmpeg. A soft check matches the existing pattern for the `simplex-chat` CLI.

### D9: SimpleX setFilesFolder to KAWA_FILES_DIR

**Decision**: On startup, after connecting to SimpleX, send a `setFilesFolder` command pointing to `kawa-files/` so SimpleX stores received files in the same directory tree Kawa uses.

**Rationale**: The SimpleX CLI has a `setFilesFolder` command that controls where received files are saved. Setting this to Kawa's files directory ensures files land where Kawa expects them, eliminating the need to copy or move received files.

**SDK note**: `setFilesFolder` is not a typed method on `ChatClient`. It's a raw chat command that must be sent via `ChatClient.sendChatCmd()`. The command interface is `{ type: "setFilesFolder", filePath: string }` and the wire format is `/_files_folder <filePath>`. Send it as `chatClient.sendChatCmd(CC.SetFilesFolder.cmdString({ type: "setFilesFolder", filePath: config.filesDir }))` or as the raw string `/_files_folder /path/to/kawa-files`.

## Risks / Trade-offs

- **[Large images → context overflow]** → Mitigated by auto-resize to 2048px max dimension using `sharp`. Very large images may still consume significant tokens; could add a configurable byte limit in the future.
- **[ffmpeg not installed]** → Mitigated by soft prerequisite check. Video handling degrades gracefully; images and files still work.
- **[Video frame extraction latency]** → Mitigated by timeout on buffer. A 30-second video at 1fps generates 30 frames; extraction takes 2-5 seconds. Acceptable for a personal app.
- **[File transfer stall blocks conversation]** → Mitigated by 30s buffer timeout. If transfer doesn't complete, prompt with text-only plus a note. Agent can still help while file downloads in background.
- **[Disk space from received files]** → Accepted for a personal app. No automatic cleanup. Could add a `/cleanup` command or size-based eviction later.
- **[send_image/send_file path traversal]** → Mitigated by validating paths stay within cwd or KAWA_FILES_DIR. Do not allow sending arbitrary system files.
- **[sharp native dependency]** → `sharp` uses native libvips bindings. This adds a build-time dependency. Most Node.js environments handle this via prebuilt binaries. If this is a concern, `jimp` (pure JS) is a fallback but much slower.
- **[MsgContent.Image.text may be empty]** → The SimpleX SDK types show `text: string` on `MsgContent.Image`, `MsgContent.File`, etc., but this could be an empty string for uncaptioned media. Kawa should handle both captioned and uncaptioned cases — using a default like "📷 Image" or "📎 File: filename" when text is empty.