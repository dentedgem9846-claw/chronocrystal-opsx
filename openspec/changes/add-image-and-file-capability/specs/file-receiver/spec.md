## ADDED Requirements

### Requirement: Inbound file transfer auto-accept
When a contact sends a file (image, video, or generic file) to Kawa, Kawa SHALL automatically accept the file transfer by calling `ChatClient.apiReceiveFile(fileId)` without requiring user confirmation.

#### Scenario: Contact sends an image
- **WHEN** a contact sends an image and Kawa receives a `newChatItems` event containing a `ChatItem` with `chatItem.file` of type `CIFile` with `fileStatus` equal to `"rcvInvitation"` and `msgContent.type === "image"`
- **THEN** Kawa SHALL call `apiReceiveFile(chatItem.file.fileId)` to accept the transfer
- **AND** Kawa SHALL NOT prompt the contact for confirmation

#### Scenario: Contact sends a generic file
- **WHEN** a contact sends a PDF, source file, or other non-image/non-video file
- **THEN** Kawa SHALL call `apiReceiveFile(fileId)` to accept the transfer automatically

#### Scenario: Contact sends a video
- **WHEN** a contact sends a video file
- **THEN** Kawa SHALL call `apiReceiveFile(fileId)` to accept the transfer automatically

### Requirement: File type routing by MsgContent type
Kawa SHALL route incoming files based on their `MsgContent` type to the appropriate handler.

#### Scenario: Image message routing
- **WHEN** a `newChatItems` event contains a message with `msgContent.type === "image"`
- **THEN** Kawa SHALL save the received file to `KAWA_FILES_DIR/images/`
- **AND** after the file transfer completes, Kawa SHALL resize the image to max 2048px on the longest side
- **AND** Kawa SHALL read the resized image, base64-encode it, and pass it to the agent as `ImageContent` in `session.prompt(text, { images })`

#### Scenario: Video message routing
- **WHEN** a `newChatItems` event contains a message with `msgContent.type === "video"`
- **THEN** Kawa SHALL save the received file to `KAWA_FILES_DIR/videos/`
- **AND** after the file transfer completes, Kawa SHALL extract key frames at 1 fps using ffmpeg
- **AND** Kawa SHALL resize each frame to max 2048px on the longest side
- **AND** Kawa SHALL pass all extracted frames to the agent as `ImageContent[]` in `session.prompt(text, { images })`

#### Scenario: Generic file message routing
- **WHEN** a `newChatItems` event contains a message with `msgContent.type === "file"`
- **THEN** Kawa SHALL save the received file to `KAWA_FILES_DIR/files/`
- **AND** after the file transfer completes, Kawa SHALL prompt the agent with the message text plus an attachment note including the file name and path (e.g., "📎 Attached: report.pdf at kawa-files/files/report.pdf")
- **AND** the agent MAY use its `read` tool to inspect the file

#### Scenario: Voice message handling
- **WHEN** a `newChatItems` event contains a message with `msgContent.type === "voice"`
- **THEN** Kawa SHALL log that a voice message was received and not forward it to the agent
- **AND** Kawa SHALL NOT attempt to process or transcribe the voice message

#### Scenario: Link message handling
- **WHEN** a `newChatItems` event contains a message with `msgContent.type === "link"`
- **THEN** Kawa SHALL extract the link text and forward only the text to the agent (existing behavior)

### Requirement: Buffer messages until file transfer completes
Kawa SHALL hold the text portion of an incoming message when a file attachment is still downloading, and prompt the agent with text + attachment together once the transfer completes.

#### Scenario: Image arrives with text, transfer completes promptly
- **WHEN** a contact sends a message "What's in this image?" with an image attachment
- **AND** the `newChatItems` event carries a single `AChatItem` with `msgContent.type === "image"` (text caption embedded in `msgContent.text`) and `chatItem.file` with `CIFile.fileStatus === "rcvInvitation"`
- **AND** Kawa calls `apiReceiveFile(fileId)` to accept the transfer
- **AND** the image file transfer completes within 30 seconds (tracked via `rcvFileComplete` event)
- **THEN** Kawa SHALL prompt the agent once with both the text (from `msgContent.text`) and the image as `ImageContent`
- **AND** the agent SHALL see both the text and the image in the same prompt

#### Scenario: File transfer takes longer than timeout
- **WHEN** a contact sends a message with a file attachment
- **AND** the file transfer has not completed within 30 seconds
- **THEN** Kawa SHALL prompt the agent with the text only, appending a note: "[1 file attached, still downloading]"
- **AND** when the file transfer subsequently completes, Kawa SHALL send a follow-up message to the agent containing the file content

#### Scenario: Message with no file attachment
- **WHEN** a contact sends a plain text message with no file attachment
- **THEN** Kawa SHALL prompt the agent immediately without buffering (existing behavior)

### Requirement: File transfer lifecycle event handling
Kawa SHALL handle SimpleX file transfer events in the main event loop to track file download progress.

#### Scenario: File transfer starts
- **WHEN** Kawa receives a `rcvFileStart` event
- **THEN** Kawa SHALL log that the file transfer has started and track the transfer by `fileId`

#### Scenario: File transfer completes
- **WHEN** Kawa receives a `rcvFileComplete` event for a tracked file
- **THEN** Kawa SHALL resolve the pending buffer for the associated message
- **AND** Kawa SHALL route the file to the appropriate handler based on its `MsgContent` type
- **AND** Kawa SHALL prompt the agent with the buffered text and the processed file content

#### Scenario: File transfer is cancelled
- **WHEN** Kawa receives a `rcvFileCancelled` or `rcvFileSndCancelled` event
- **THEN** Kawa SHALL discard the pending buffer
- **AND** Kawa SHALL prompt the agent with the text only, noting that the file transfer was cancelled

### Requirement: SimpleX files folder configuration
Kawa SHALL configure the SimpleX CLI to store received files in the `KAWA_FILES_DIR` directory by sending a `setFilesFolder` command after connecting.

#### Scenario: Files folder set on startup
- **WHEN** Kawa starts and connects to the SimpleX CLI
- **THEN** Kawa SHALL send a `setFilesFolder` command via `ChatClient.sendChatCmd()` (note: `setFilesFolder` is a raw chat command, not a typed API method on `ChatClient`; the wire format is `/_files_folder <filePath>`)
- **AND** received files SHALL be stored in the configured directory

### Requirement: File storage directory structure
Kawa SHALL maintain a split directory structure under `KAWA_FILES_DIR` for different file types.

#### Scenario: Directory creation on startup
- **WHEN** Kawa starts
- **THEN** Kawa SHALL ensure that `KAWA_FILES_DIR/images/`, `KAWA_FILES_DIR/videos/`, and `KAWA_FILES_DIR/files/` directories exist
- **AND** if any directory does not exist, Kawa SHALL create it

#### Scenario: KAWA_FILES_DIR is configurable
- **WHEN** the `KAWA_FILES_DIR` environment variable is set
- **THEN** Kawa SHALL use that value as the base directory for file storage
- **AND** when `KAWA_FILES_DIR` is not set, Kawa SHALL default to `<cwd>/kawa-files/`