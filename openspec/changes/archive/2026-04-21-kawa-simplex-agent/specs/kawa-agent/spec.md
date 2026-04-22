## ADDED Requirements

### Requirement: Per-contact agent session management
Kawa SHALL create a dedicated pi AgentSession for each SimpleX contact that connects. Each session SHALL have isolated conversation context. Kawa SHALL close the session when a contact is deleted.

#### Scenario: New contact connects
- **WHEN** Kawa receives a `contactConnected` event from SimpleX
- **THEN** Kawa creates a new `AgentSession` instance and maps it to the contact's `contactId`
- **AND** Kawa sends a welcome message to the contact via `apiSendTextMessage`

#### Scenario: Contact sends a message
- **WHEN** Kawa receives a `newChatItems` event containing a text message from a contact
- **THEN** Kawa routes the message text to the AgentSession mapped to that contact's `contactId`
- **AND** Kawa calls `session.prompt()` (or equivalent AgentSession API) with the message

#### Scenario: Contact is deleted
- **WHEN** Kawa receives a `contactDeletedByContact` event
- **THEN** Kawa closes the AgentSession for that contact
- **AND** Kawa removes the contact-to-session mapping

### Requirement: Tool call visibility
Kawa SHALL surface pi tool execution events inline in the live message stream. Tool calls SHALL appear with a 🔧 prefix, the tool name, and the command or file path. Tool output SHALL be truncated to a configurable line limit.

#### Scenario: Bash tool execution shown
- **WHEN** Kawa receives a `tool_execution_start` event for the `bash` tool with args `{command: "ls -la"}`
- **THEN** Kawa appends `🔧 bash: ls -la` to the current live message for that contact

#### Scenario: Tool output truncated
- **WHEN** Kawa receives a `tool_execution_end` event with result content exceeding the line limit
- **THEN** Kawa appends the first N lines of output followed by `... and X more lines` to the live message
- **WHERE** N is the configured truncation limit and X is the remaining line count

#### Scenario: Tool completes successfully
- **WHEN** Kawa receives a `tool_execution_end` event with `isError: false`
- **THEN** Kawa appends ` ✓` after the tool call line in the live message

#### Scenario: Tool completes with error
- **WHEN** Kawa receives a `tool_execution_end` event with `isError: true`
- **THEN** Kawa appends ` ✗` and the error summary after the tool call line

### Requirement: Live message streaming
Kawa SHALL stream pi's response to SimpleX using live messages. The first text delta SHALL create a live message via `APISendMessages(live=on)`. Subsequent text deltas and tool calls SHALL update the message in-place via `APIUpdateChatItem(live=on)`. When `agent_end` fires, Kawa SHALL finalize the message via `APIUpdateChatItem(live=off)`.

#### Scenario: First text delta creates live message
- **WHEN** Kawa receives a `message_update` event with `assistantMessageEvent.type: "text_delta"` for the first time in a response
- **THEN** Kawa calls `APISendMessages` with `liveMessage: true` containing the accumulated text

#### Scenario: Subsequent text deltas update live message
- **WHEN** Kawa receives additional `message_update` text delta events
- **THEN** Kawa calls `APIUpdateChatItem` with `liveMessage: true` and the updated full text content, using the `chatItemId` from the initial send response

#### Scenario: Agent finishes and finalizes message
- **WHEN** Kawa receives an `agent_end` event
- **THEN** Kawa calls `APIUpdateChatItem` with `liveMessage: false` to finalize the message

#### Scenario: Tool execution updates live message
- **WHEN** Kawa receives `tool_execution_start` or `tool_execution_end` events during streaming
- **THEN** Kawa calls `APIUpdateChatItem` with `liveMessage: true` appending the tool call info to the current message text

### Requirement: Session slash commands
Kawa SHALL support slash commands that operate on the contact's AgentSession.

#### Scenario: /reset command
- **WHEN** a contact sends `/reset` to Kawa
- **THEN** Kawa creates a new AgentSession for that contact, replacing the existing one
- **AND** Kawa sends a confirmation message to the contact

#### Scenario: /compact command
- **WHEN** a contact sends `/compact` to Kawa
- **THEN** Kawa triggers context compaction on the contact's AgentSession
- **AND** Kawa sends a confirmation message to the contact

#### Scenario: /status command
- **WHEN** a contact sends `/status` to Kawa
- **THEN** Kawa queries the AgentSession state for that contact
- **AND** Kawa responds with current context usage, model, and streaming status

### Requirement: Agent error handling
Kawa SHALL handle AgentSession errors gracefully and report them to the contact.

#### Scenario: LLM provider error
- **WHEN** an AgentSession encounters a provider error (e.g., Ollama unavailable, rate limit)
- **THEN** Kawa finalizes the current live message with an error notice
- **AND** Kawa sends a message describing the error to the contact