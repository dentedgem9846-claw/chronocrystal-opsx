## 1. Config and Prerequisites

- [x] 1.1 Add `KAWA_FILES_DIR`, `KAWA_FFMPEG_BIN`, `KAWA_IMAGE_MAX_DIMENSION`, and `KAWA_FILE_BUFFER_TIMEOUT_MS` fields to `KawaConfig` interface and `defaultConfig` in `config.ts`
- [x] 1.2 Add `detectFfmpegBin()` function in `kawa.ts` — check for ffmpeg on startup (same pattern as `detectSimplexBin`), log warning if not found, set a module-level `ffmpegAvailable` flag
- [x] 1.3 Add directory creation for `KAWA_FILES_DIR/images/`, `KAWA_FILES_DIR/videos/`, `KAWA_FILES_DIR/files/` on startup in `kawa.ts`

## 2. File Receiver Module

- [x] 2.1 Create `flux/kawa/src/file-receiver.ts` with `FileReceiver` class — constructor takes `ChatClient`, `KawaConfig`, and a callback for when a buffered message is ready to prompt
- [x] 2.2 Implement `handleNewChatItem(chatItem)` method — detect `CIFile` on chat items (via `chatItem.file?` on the `ChatItem` type; note: file attachment is a separate optional field from content), call `apiReceiveFile(fileId)` to auto-accept, track pending transfers by `fileId` and `contactId`
- [x] 2.3 Implement file transfer event handlers: `handleRcvFileStart`, `handleRcvFileComplete`, `handleRcvFileCancelled` — update pending transfer tracking
- [x] 2.4 Implement buffer logic — when a message has a file attachment, hold the text in a per-contact buffer; on `rcvFileComplete`, resolve the buffer and invoke the ready callback with text + file content
- [x] 2.5 Implement 30s buffer timeout — if transfer doesn't complete, call the ready callback with text only plus "[1 file attached, still downloading]" note
- [x] 2.6 Implement file type routing in the ready callback — for `MsgContent.Image`: resize image, base64-encode, return as `ImageContent`; for `MsgContent.Video`: delegate to `VideoFrameExtractor`, return frames as `ImageContent[]`; for `MsgContent.File`: return path reference string
- [x] 2.7 Add `pendingFiles` map to `ContactContext` in `session-manager.ts` — tracks pending file transfers per contact (fileId → { contactId, text, msgContentType, timestamp })

## 3. Video Frame Extractor Module

- [x] 3.1 Create `flux/kawa/src/video-frame-extractor.ts` with `VideoFrameExtractor` class — constructor takes `KawaConfig`
- [x] 3.2 Implement `extractFrames(videoPath: string): Promise<string[]>` method — run `ffmpeg -i <video> -vf fps=1 <output_dir>/%04d.jpg`, collect result frame file paths
- [x] 3.3 Implement frame count limit — cap at 60 frames, log warning if video exceeds 60 seconds
- [x] 3.4 Handle ffmpeg errors — log error, return empty array so caller can fall back to text-only prompt
- [x] 3.5 Implement frame detection guard — return empty array with warning if ffmpeg is not available

## 4. Image Resize Helper

- [x] 4.1 Create `flux/kawa/src/image-resize.ts` with `resizeImageFile(filePath: string, maxDimension: number): Promise<Buffer>` function — read image, resize to max dimension on longest side, return resized image buffer
- [x] 4.2 Use `sharp` npm package for resizing (the pi agent's internal `resizeImage` is not part of the public API and cannot be imported; additionally its interface takes `ImageContent` base64 strings, not file paths); add `sharp` to `package.json` dependencies
- [x] 4.3 Implement `imageFileToImageContent(filePath: string): Promise<ImageContent>` — read file, detect MIME type, resize, base64-encode, return `{ type: "image", data: base64, mimeType }`

## 5. MessageSender Extensions

- [x] 5.1 Add `sendImageMessage(contactId: number, filePath: string, caption?: string): Promise<void>` method to `MessageSender` — calls `apiSendMessages` with `ComposedMessage` containing `msgContent: { type: "image", text, image: base64 }` and `filePath`
- [x] 5.2 Add `sendFileMessage(contactId: number, filePath: string, description?: string): Promise<void>` method to `MessageSender` — calls `apiSendMessages` with `ComposedMessage` containing `msgContent: { type: "file", text }` and `filePath`
- [x] 5.3 Add path validation helper in `MessageSender` — verify `filePath` is within cwd or `KAWA_FILES_DIR` before sending; throw descriptive error if not

## 6. Agent Tools Registration

- [x] 6.1 Create `flux/kawa/src/agent-tools.ts` with `createSendImageTool(sender, config)` and `createSendFileTool(sender, config)` functions — each returns a `ToolDefinition` object compatible with pi agent's `customTools`
- [x] 6.2 Implement `send_image` tool — parameter `path` (string), validates path is within cwd or `KAWA_FILES_DIR`, calls `sender.sendImageMessage()`, returns success/failure to agent
- [x] 6.3 Implement `send_file` tool — parameter `path` (string), validates path, calls `sender.sendFileMessage()`, returns success/failure to agent
- [x] 6.4 Register custom tools in `createAgentSession` call in `kawa.ts` — pass `customTools: [sendImageTool, sendFileTool]` via `CreateAgentSessionOptions` (confirmed: `customTools?: ToolDefinition[]` exists on the SDK's `CreateAgentSessionOptions` interface; use `defineTool` from the SDK to construct `ToolDefinition` objects)
- [x] 6.5 Store `contactId` on `ContactContext` so tools can look up the active contact from the session — tools need the contactId to send files/images to the right contact

## 7. Event Loop Integration

- [x] 7.1 Modify `handleSimpleXEvent` in `kawa.ts` to handle `rcvFileStart`, `rcvFileComplete`, `rcvFileCancelled`, `sndFileComplete` events — delegate to `FileReceiver`
- [x] 7.2 Modify `newChatItems` handling in `handleSimpleXEvent` to detect non-text `MsgContent` types (image, video, file) — when detected, delegate to `FileReceiver.handleNewChatItem` instead of `handleIncomingMessage`
- [x] 7.3 Modify `extractTextFromContent` in `event-formatter.ts` to also extract text from `MsgContent.Image` (caption text via `.text` field), `MsgContent.Video` (caption text), `MsgContent.File` (file name + `.text` field), and `MsgContent.Link` (link text) — return the text portion plus a marker that a file is attached. Note: these `MsgContent` variants have an embedded `.text` field that carries the user's caption/description; return `undefined` only for types that have no text (e.g., `MsgContent.Voice` which is a non-goal)
- [x] 7.4 Add `setFilesFolder` command call in `kawa.ts` after SimpleX connection is established — send via `chatClient.sendChatCmd(CC.SetFilesFolder.cmdString({ type: "setFilesFolder", filePath: config.filesDir }))` or the raw command string `"/_files_folder " + config.filesDir`. Note: `setFilesFolder` is a raw chat command, not a typed API method on `ChatClient`. Import the command constructors from `@simplex-chat/types` or construct the raw command string.

## 8. Prompt Integration

- [x] 8.1 Modify `handleIncomingMessage` in `kawa.ts` to accept optional `images?: ImageContent[]` parameter — when images are present, pass them to `session.prompt(text, { images })` instead of just `session.prompt(text)`
- [x] 8.2 When file transfer is for a generic file (not image/video), append the file path reference (e.g., "📎 Attached: filename at path") to the prompt text before calling `session.prompt`

## 9. E2E Smoke Tests

- [x] 9.1 Add `flux/kawa/tests/e2e/image-receive.test.ts` — Alice sends image to Kawa with "What is in this image?", verify Kawa's agent response references image content
- [x] 9.2 Add `flux/kawa/tests/e2e/image-send.test.ts` — Alice asks Kawa to send an image via `send_image`, verify Alice receives an inline image
- [x] 9.3 Add `flux/kawa/tests/e2e/file-send.test.ts` — Alice asks Kawa to send a file via `send_file`, verify Alice receives a file attachment
- [x] 9.4 Add `flux/kawa/tests/e2e/file-receive.test.ts` — Alice sends a source file to Kawa with "Review this code", verify Kawa's response references the file content