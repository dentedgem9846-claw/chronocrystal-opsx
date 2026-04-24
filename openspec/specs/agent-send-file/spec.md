## ADDED Requirements

### Requirement: send_image agent tool
Kawa SHALL register a `send_image` custom tool with the pi agent that allows the agent to send an image file from disk to the current contact as an inline SimpleX image.

#### Scenario: Agent sends an image to contact
- **WHEN** the agent calls `send_image` with a `path` parameter pointing to an image file on disk
- **AND** the path is within the current working directory or `KAWA_FILES_DIR`
- **THEN** Kawa SHALL read the image file from disk
- **AND** Kawa SHALL send it to the contact via `apiSendMessages` with `msgContent.type === "image"` and `filePath` set to the image file path
- **AND** the contact SHALL see the image inline in the chat

#### Scenario: Agent sends image with path outside allowed directories
- **WHEN** the agent calls `send_image` with a path that is outside the current working directory and `KAWA_FILES_DIR`
- **THEN** Kawa SHALL NOT send the file
- **AND** the tool SHALL return an error to the agent: "Path must be within the working directory or KAWA_FILES_DIR"

#### Scenario: Agent sends image with non-existent file
- **WHEN** the agent calls `send_image` with a path that does not exist on disk
- **THEN** the tool SHALL return an error to the agent: "File not found: <path>"

#### Scenario: Agent sends image while no active session
- **WHEN** the agent calls `send_image` and there is no active contact session
- **THEN** the tool SHALL return an error: "No active contact session"

### Requirement: send_file agent tool
Kawa SHALL register a `send_file` custom tool with the pi agent that allows the agent to send a file from disk to the current contact as a SimpleX file attachment.

#### Scenario: Agent sends a file to contact
- **WHEN** the agent calls `send_file` with a `path` parameter pointing to a file on disk
- **AND** the path is within the current working directory or `KAWA_FILES_DIR`
- **THEN** Kawa SHALL send the file to the contact via `apiSendMessages` with `msgContent.type === "file"`, `msgContent.text` set to the file name, and `filePath` set to the file path
- **AND** the contact SHALL see the file as a downloadable attachment in the chat

#### Scenario: Agent sends file with path outside allowed directories
- **WHEN** the agent calls `send_file` with a path that is outside the current working directory and `KAWA_FILES_DIR`
- **THEN** Kawa SHALL NOT send the file
- **AND** the tool SHALL return an error to the agent: "Path must be within the working directory or KAWA_FILES_DIR"

#### Scenario: Agent sends file with non-existent file
- **WHEN** the agent calls `send_file` with a path that does not exist on disk
- **THEN** the tool SHALL return an error to the agent: "File not found: <path>"

#### Scenario: Agent sends file while no active session
- **WHEN** the agent calls `send_file` and there is no active contact session
- **THEN** the tool SHALL return an error: "No active contact session"

### Requirement: Custom tools registered at session creation
The `send_image` and `send_file` tools SHALL be registered as custom tools via the `customTools` field in `CreateAgentSessionOptions` when creating a new agent session. The pi agent SDK confirms this field exists: `customTools?: ToolDefinition[]`. Use the `defineTool` helper from `@mariozechner/pi-coding-agent` to construct `ToolDefinition` objects.

#### Scenario: Tools appear in agent session
- **WHEN** a new agent session is created for a contact
- **THEN** the session SHALL have `send_image` and `send_file` available as custom tools
- **AND** the agent SHALL be able to call these tools during a conversation