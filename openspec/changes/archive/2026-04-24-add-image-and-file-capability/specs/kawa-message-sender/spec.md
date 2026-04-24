## MODIFIED Requirements

### Requirement: Send plain-text message
The MessageSender SHALL provide a `sendTextMessage` method that sends a non-live plain-text message to a contact. The method SHALL return `Promise<void>`.

#### Scenario: Send a plain-text message
- **WHEN** `sendTextMessage` is called with a `contactId` and message text
- **THEN** the MessageSender sends the text message to the specified contact via the SimpleX CLI
- **AND** the method returns `Promise<void>`

## ADDED Requirements

### Requirement: Send image message
The MessageSender SHALL provide a `sendImageMessage` method that sends an image file to a contact as an inline SimpleX image. The method SHALL return `Promise<void>`.

#### Scenario: Send an image file
- **WHEN** `sendImageMessage` is called with a `contactId`, `filePath`, and optional `caption`
- **AND** the file at `filePath` exists on disk
- **THEN** the MessageSender SHALL call `apiSendMessages` with a `ComposedMessage` containing `msgContent: { type: "image", text: caption, image: "<base64-encoded-data>" }` (note: `MsgContent.Image` for sending has `text` and `image` string fields)
- **AND** the file SHALL be sent using the `fileSource` field on `ComposedMessage` for local file reference
- **AND** the contact SHALL see the image inline in the chat

#### Scenario: Send image with no caption
- **WHEN** `sendImageMessage` is called without a caption
- **THEN** the `msgContent.text` field SHALL be set to the file name of the image

#### Scenario: Image file does not exist
- **WHEN** `sendImageMessage` is called with a `filePath` that does not exist on disk
- **THEN** the method SHALL throw an error indicating the file was not found
- **AND** no message SHALL be sent to the contact

### Requirement: Send file message
The MessageSender SHALL provide a `sendFileMessage` method that sends a generic file to a contact as a SimpleX file attachment. The method SHALL return `Promise<void>`.

#### Scenario: Send a file attachment
- **WHEN** `sendFileMessage` is called with a `contactId`, `filePath`, and optional `description`
- **AND** the file at `filePath` exists on disk
- **THEN** the MessageSender SHALL call `apiSendMessages` with a `ComposedMessage` containing `msgContent: { type: "file", text: description }` and the file reference via `ComposedMessage.fileSource`
- **AND** the contact SHALL see the file as a downloadable attachment in the chat

#### Scenario: Send file with no description
- **WHEN** `sendFileMessage` is called without a description
- **THEN** the `msgContent.text` field SHALL be set to the file name of the attachment

#### Scenario: File does not exist
- **WHEN** `sendFileMessage` is called with a `filePath` that does not exist on disk
- **THEN** the method SHALL throw an error indicating the file was not found
- **AND** no message SHALL be sent to the contact