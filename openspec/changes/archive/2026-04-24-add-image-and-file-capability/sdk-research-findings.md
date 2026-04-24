# SDK Research Findings (2025-04-23)

Subagent-verified findings against actual SDK type definitions in `node_modules/`.

## Q1: customTools API ✅ CONFIRMED

`CreateAgentSessionOptions` has `customTools?: ToolDefinition[]`. The package also exports `defineTool` for constructing tool definitions.

**Source**: `@mariozechner/pi-coding-agent/dist/core/sdk.d.ts`

## Q2: resizeImage not public ❌ NOT IMPORTABLE

The `resizeImage` function exists at `@mariozechner/pi-coding-agent/dist/utils/image-resize.d.ts` but is NOT exported from the package's `index.d.ts`. It's an internal utility. Additionally, its interface takes `ImageContent` (base64 string) and returns `ResizedImage | null`, which doesn't match our use case of resizing from file paths.

**Impact**: Must use `sharp` npm package as the primary image resize dependency.

## Q3: setFilesFolder not on ChatClient ⚠️ USE sendChatCmd

`setFilesFolder` is a raw chat command (`{ type: "setFilesFolder", filePath: string }`), wire format `/_files_folder <filePath>`. It must be sent via `chatClient.sendChatCmd()`, not as a typed method on `ChatClient`.

**Source**: `simplex-chat/dist/command.d.ts`, `simplex-chat/dist/command.js`

## Q4: Type Verification — All Correct

- `CIFile` has `fileId`, `fileName`, `fileSize`, `fileSource?`, `fileStatus`, `fileProtocol`
- `CIFileStatus` receiving states: `"rcvInvitation" | "rcvAccepted" | "rcvTransfer" | "rcvComplete" | "rcvCancelled" | "rcvAborted" | "rcvError" | "rcvWarning"`
- `MsgContent.Image` has `{ type: "image", text: string, image: string }`
- `MsgContent.Video` has `{ type: "video", text: string, image: string, duration: number }`
- `MsgContent.File` has `{ type: "file", text: string }`
- `ChatItem` has optional `file?: CIFile` field separate from `content: CIContent`
- Text captions arrive embedded in `msgContent.text` (not as separate events)

## Q5: apiReceiveFile ✅ CONFIRMED

`chatClient.apiReceiveFile(fileId: number): Promise<T.AChatItem>` — takes numeric fileId, returns AChatItem.

## Q6: Text + File Same Event ✅ CONFIRMED

A single `newChatItems` event carries both `msgContent` (with text caption in `msgContent.text`) and `chatItem.file` (with `CIFile` transfer metadata). File transfer lifecycle events (`rcvFileStart`, `rcvFileComplete`, `rcvFileSndCancelled`) are separate event types with their own `AChatItem` fields.

## Open Questions

1. **`MsgContent.Image.image` field**: Is this base64 data or a file path reference? Needs testing with actual SimpleX traffic.
2. **`ChatItem.file` after download**: Does a fully-received image message still have `file` populated, or is it cleared after `rcvFileComplete`? Needs testing.
3. **Empty `msgContent.text`**: `MsgContent.Image.text` is `string` (which includes `""`). SimpleX may send empty strings for uncaptioned media.