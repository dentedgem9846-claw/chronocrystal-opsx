## Why

Kawa currently only handles text messages. When a contact sends an image, video, or file, Kawa silently drops it. When the agent produces or references files on disk, there is no way to deliver them to the contact. Gemma 3 supports multimodal input (images) and video can be handled via frame extraction, but Kawa has no plumbing for either direction of file/image flow.

## What Changes

- Accept incoming images from contacts → auto-resize → forward to the agent as `ImageContent` via `session.prompt(text, { images })` so vision models can see them
- Accept incoming video from contacts → extract key frames via ffmpeg → forward frames to the agent as `ImageContent[]`
- Accept incoming files from contacts → save to disk → tell the agent the file path so it can use its `read` tool to inspect them
- Add a `send_image` agent tool: agent can send an image file from disk to the contact as an inline SimpleX image
- Add a `send_file` agent tool: agent can send a file from disk to the contact as a SimpleX file attachment
- Buffer incoming messages with attachments until file transfers complete, then prompt the agent with text + media together
- Auto-accept all incoming file transfers (personal app, trusted contacts)
- Add `KAWA_FILES_DIR` config (default: `<cwd>/kawa-files/`) with split subdirectories for images, videos, and files
- Add `KAWA_FFMPEG_BIN` config for video frame extraction path

## Capabilities

### New Capabilities

- `file-receiver`: Handles incoming file transfer lifecycle — detects `CIFile` attachments on chat items, auto-accepts via `apiReceiveFile()`, buffers text until transfer completes, saves files to split storage (images/, videos/, files/), and routes to the agent (images/videos as `ImageContent[]`, files as path references)
- `agent-send-file`: Two new agent tools (`send_image` and `send_file`) registered as custom tools via the pi agent API, enabling the agent to send images and files from disk to contacts via SimpleX file transfer
- `video-frame-extractor`: Extracts key frames from received video files using ffmpeg so they can be sent to vision models as image sequences

### Modified Capabilities

- `kawa-message-sender`: Add methods for sending image messages (`MsgContent.Image`) and file messages (`MsgContent.File` with `filePath`) via `apiSendMessages`
- `e2e-alice-testing`: Add smoke tests for image receive/send flows (Alice sends image, Kawa sees it; Kawa sends image, Alice receives it)

## Impact

- **New modules**: `file-receiver.ts`, `video-frame-extractor.ts` in `flux/kawa/src/`
- **Modified modules**: `kawa.ts` (handle file lifecycle events in event loop), `event-formatter.ts` (extract file info from non-text `MsgContent`), `message-sender.ts` (add image/file send methods), `config.ts` (add `KAWA_FILES_DIR`, `KAWA_FFMPEG_BIN`, image resize settings), `session-manager.ts` (add pending files state to `ContactContext`)
- **New dependencies**: `ffmpeg` must be available on PATH (or configurable via `KAWA_FFMPEG_BIN`) for video frame extraction; prerequisite check on startup similar to `simplex-chat` CLI check. `sharp` npm package for image resizing (the pi agent's internal `resizeImage` utility is not part of its public API and cannot be imported)
- **SimpleX SDK**: Uses `ChatClient.apiReceiveFile(fileId)` for incoming; `apiSendMessages()` with `ComposedMessage` containing `msgContent` for outgoing; `sendChatCmd(SetFilesFolder.cmdString(...))` to configure where received files are stored (setFilesFolder is not a typed method on ChatClient — must be sent as a raw command)
- **Pi agent**: Uses `session.prompt(text, { images: ImageContent[] })` for vision input; `CreateAgentSessionOptions.customTools?: ToolDefinition[]` for registering `send_image`/`send_file` (confirmed: the `customTools` option exists on the SDK's `createAgentSession` API)
- **Storage**: New `kawa-files/` directory tree under cwd with `images/`, `videos/`, `files/` subdirectories