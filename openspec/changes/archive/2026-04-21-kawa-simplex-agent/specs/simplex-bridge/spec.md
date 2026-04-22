## ADDED Requirements

### Requirement: SimpleX Chat CLI lifecycle management
Kawa SHALL spawn and own the `simplex-chat` CLI process. Kawa SHALL start it with the `-p` flag to enable the WebSocket server, monitor it for crashes, and restart it on failure.

#### Scenario: Starting Kawa
- **WHEN** Kawa starts
- **THEN** Kawa spawns `simplex-chat` as a child process with the configured port (default 5225)
- **AND** Kawa waits for the WebSocket server to become available before proceeding

#### Scenario: SimpleX CLI crashes
- **WHEN** the `simplex-chat` child process exits unexpectedly
- **THEN** Kawa logs the crash
- **AND** Kawa restarts the `simplex-chat` process after a configurable backoff delay
- **AND** Kawa reconnects the `ChatClient`

#### Scenario: Graceful shutdown
- **WHEN** Kawa receives a SIGINT or SIGTERM signal
- **THEN** Kawa gracefully closes all AgentSessions
- **AND** Kawa disconnects the `ChatClient`
- **AND** Kawa terminates the `simplex-chat` child process

### Requirement: ChatClient connection via simplex-chat npm SDK
Kawa SHALL connect to the `simplex-chat` CLI via the `simplex-chat` npm package's `ChatClient` class. Kawa SHALL NOT use raw WebSocket code — all communication goes through the SDK.

#### Scenario: Connecting to SimpleX
- **WHEN** Kawa starts and the `simplex-chat` CLI is ready
- **THEN** Kawa creates a `ChatClient` via `ChatClient.create("ws://localhost:5225")`
- **AND** Kawa begins processing events from `chat.msgQ`

#### Scenario: ChatClient disconnects
- **WHEN** the `ChatClient` connection drops
- **THEN** Kawa attempts to reconnect with exponential backoff
- **AND** Kawa preserves in-flight AgentSessions during reconnection

### Requirement: Bot profile configuration
Kawa SHALL configure itself as a SimpleX bot with `peerType: "bot"` and configure slash commands for the bot menu.

#### Scenario: Bot profile creation
- **WHEN** Kawa starts for the first time and no user profile exists
- **THEN** Kawa creates a bot profile using `--create-bot-display-name "Kawa"` CLI option or the `apiCreateActiveUser` API with `peerType: "bot"`
- **AND** Kawa sets up a SimpleX address with auto-accept enabled via `enableAddressAutoAccept()`

#### Scenario: Bot command menu
- **WHEN** Kawa configures its bot profile
- **THEN** Kawa registers slash commands: `/help`, `/reset`, `/compact`, `/status`
- **AND** these commands appear in the SimpleX Chat app's bot menu when users type `/`

### Requirement: Event routing from SimpleX to agent sessions
Kawa SHALL consume events from the `ChatClient.msgQ` async iterator and route them to the appropriate per-contact AgentSession.

#### Scenario: New contact connects
- **WHEN** Kawa receives a `contactConnected` event
- **THEN** Kawa creates a new AgentSession for the contact
- **AND** Kawa stores the mapping from `contactId` to the session

#### Scenario: Text message received
- **WHEN** Kawa receives a `newChatItems` event containing a text message from a known contact
- **THEN** Kawa extracts the text content using `ciContentText(chatItem.content)`
- **AND** Kawa prompts the contact's AgentSession with that text

#### Scenario: Message from unknown contact
- **WHEN** Kawa receives a `newChatItems` event from a contact with no existing AgentSession
- **THEN** Kawa creates a new AgentSession for that contact before prompting it

#### Scenario: Slash command received
- **WHEN** Kawa receives a `newChatItems` event where the text starts with `/`
- **THEN** Kawa routes the command to the appropriate slash handler (`/reset`, `/compact`, `/status`, `/help`) instead of prompting the AgentSession

### Requirement: Agent response forwarding to SimpleX
Kawa SHALL forward pi AgentSession response events back to the correct SimpleX contact using the `simplex-chat` SDK's `apiSendTextMessage` and `apiSendMessages`/`apiUpdateChatItem` methods with live message support.

#### Scenario: Sending initial response text
- **WHEN** Kawa receives the first `message_update` text delta from a contact's AgentSession
- **THEN** Kawa calls `apiSendMessages` with `liveMessage: true`, `ChatType.Direct`, and the contact's `contactId`

#### Scenario: Updating live message with continued text
- **WHEN** Kawa receives subsequent `message_update` text deltas
- **THEN** Kawa calls `apiUpdateChatItem` with `liveMessage: true` and the accumulated text, using the `chatItemId` from the initial send

#### Scenario: Finalizing the response
- **WHEN** Kawa receives `agent_end` from the AgentSession
- **THEN** Kawa calls `apiUpdateChatItem` with `liveMessage: false` to make the message permanent

### Requirement: AgentSession and SimpleX contact mapping
Kawa SHALL maintain a bidirectional mapping between SimpleX `contactId` and pi `AgentSession` instances. This mapping SHALL support O(1) lookup in both directions.

#### Scenario: Finding session for a contact
- **WHEN** a message arrives from SimpleX contact ID 42
- **THEN** Kawa looks up the AgentSession for contact 42 in the mapping

#### Scenario: Finding contact for a session event
- **WHEN** an AgentSession event (e.g., `message_update`) fires
- **THEN** Kawa looks up the SimpleX `contactId` and `chatItemId` for that session

### Requirement: Kawa configuration via pi settings
Kawa's agent behavior SHALL be configured through the `.pi/` directory at `chronocrystal/flux/kawa/.pi/`, including `AGENTS.md` for identity and `settings.json` for model/provider settings.

#### Scenario: AgentSession uses kawa's .pi config
- **WHEN** Kawa creates a new AgentSession for a contact
- **THEN** the AgentSession uses `chronocrystal/flux/kawa/.pi/` as its configuration directory
- **AND** the agent's identity, model, and provider are loaded from that configuration