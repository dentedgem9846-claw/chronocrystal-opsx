## MODIFIED Requirements

### Requirement: Start live message
The MessageSender SHALL provide a `startLiveMessage` method that transitions a contact from IDLE to STREAMING by creating a new live message via `sendChatCmd` with `liveMessage: true`. The method SHALL return `{ itemId: number } | null` — null indicates the live message could not be created. The method SHALL NOT create a duplicate live message if one is already streaming for the same contact.

#### Scenario: Successful live message creation
- **WHEN** `startLiveMessage` is called for a contact in IDLE state
- **THEN** the MessageSender sends a `sendChatCmd` with `liveMessage: true` to the SimpleX CLI
- **AND** the method returns an object containing the `itemId` of the created message
- **AND** the contact state transitions to STREAMING

#### Scenario: Live message creation fails
- **WHEN** `startLiveMessage` is called and the `sendChatCmd` call fails or returns no item
- **THEN** the method returns null
- **AND** the contact state SHALL NOT transition to STREAMING with a valid `liveMessageItemId`

#### Scenario: Dedup when already streaming (defensive guard)
- **WHEN** `startLiveMessage` is called for a contact that is already in STREAMING state with a non-null `liveMessageItemId`
- **THEN** the MessageSender SHALL NOT create a new live message
- **AND** the MessageSender SHALL call `updateLiveMessage` with the provided text instead
- **AND** the method SHALL return `{ itemId: <existing itemId> }`

## ADDED Requirements

### Requirement: Single live message per contact
Only one live message SHALL exist per contact at any time. If `startLiveMessage` is called while a live message is already streaming, the existing message SHALL be updated rather than a new one created.

#### Scenario: Concurrent calls to startLiveMessage
- **WHEN** two calls to `startLiveMessage` occur for the same contact (due to a race condition or bug)
- **THEN** only one live message SHALL be created
- **AND** the second call SHALL update the existing message rather than create a duplicate

#### Scenario: E2e regression — single message per response
- **WHEN** a prompt triggers a multi-event agent response (message updates, tool calls, agent end)
- **THEN** exactly one live message SHALL be created for the entire response
- **AND** the contact SHALL see one message bubble that updates in place, not multiple bubbles

#### Scenario: E2e regression — /new during streaming
- **WHEN** a user sends `/new` while the agent is streaming a response
- **THEN** the streaming message SHALL be finalized and the live message state SHALL be IDLE
- **AND** the new session SHALL start with fresh state (IDLE, null itemId, empty accumulatedText)
- **AND** no stale state from the previous session SHALL bleed into the new session