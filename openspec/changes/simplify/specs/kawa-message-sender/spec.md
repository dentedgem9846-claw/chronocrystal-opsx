## ADDED Requirements

### Requirement: Start live message
The MessageSender SHALL provide a `startLiveMessage` method that transitions a contact from IDLE to STREAMING by creating a new live message via `sendChatCmd` with `liveMessage: true`. The method SHALL return `{ itemId: string } | null` — null indicates the live message could not be created.

#### Scenario: Successful live message creation
- **WHEN** `startLiveMessage` is called for a contact in IDLE state
- **THEN** the MessageSender sends a `sendChatCmd` with `liveMessage: true` to the SimpleX CLI
- **AND** the method returns an object containing the `itemId` of the created message
- **AND** the contact state transitions to STREAMING

#### Scenario: Live message creation fails
- **WHEN** `startLiveMessage` is called and the `sendChatCmd` call fails or returns no item
- **THEN** the method returns null
- **AND** the contact state SHALL NOT transition to STREAMING with a valid `liveMessageItemId`

### Requirement: Update live message
The MessageSender SHALL provide an `updateLiveMessage` method that updates the text content of an existing live message during the STREAMING state. The method SHALL return `Promise<void>`. The method SHALL NOT attempt to create a new message — it SHALL only operate on an existing live message identified by `liveMessageItemId`.

#### Scenario: Update content of an existing live message
- **WHEN** `updateLiveMessage` is called with a `contactId`, `liveMessageItemId`, and `accumulatedText`
- **AND** the `liveMessageItemId` is non-null
- **THEN** the MessageSender calls `updateLiveMessageCmd` with `liveMessage: true` using the provided fields
- **AND** the method returns `Promise<void>`

#### Scenario: Skip update when live message item ID is null
- **WHEN** `updateLiveMessage` is called with a null `liveMessageItemId`
- **THEN** the MessageSender SHALL NOT call `updateLiveMessageCmd`
- **AND** the method returns `Promise<void>` without error

### Requirement: Finalize live message
The MessageSender SHALL provide a `finalizeLiveMessage` method that finalizes an existing live message, signaling the end of streaming. The method SHALL return `Promise<void>`.

#### Scenario: Finalize a streaming live message
- **WHEN** `finalizeLiveMessage` is called with a `contactId`, `liveMessageItemId`, and final `accumulatedText`
- **AND** the `liveMessageItemId` is non-null
- **THEN** the MessageSender calls `updateLiveMessageCmd` with `liveMessage: false`
- **AND** the contact state transitions from STREAMING to IDLE
- **AND** the method returns `Promise<void>`

#### Scenario: Finalize when live message item ID is null
- **WHEN** `finalizeLiveMessage` is called with a null `liveMessageItemId`
- **THEN** the MessageSender SHALL NOT call `updateLiveMessageCmd`
- **AND** the contact state transitions from STREAMING to IDLE
- **AND** the method returns `Promise<void>` without error

### Requirement: Send plain-text message
The MessageSender SHALL provide a `sendTextMessage` method that sends a non-live plain-text message to a contact. The method SHALL return `Promise<void>`.

#### Scenario: Send a plain-text message
- **WHEN** `sendTextMessage` is called with a `contactId` and message text
- **THEN** the MessageSender sends the text message to the specified contact via the SimpleX CLI
- **AND** the method returns `Promise<void>`

### Requirement: Direct chat type constant
The MessageSender SHALL define a single `DIRECT_CHAT_TYPE` constant equal to `ChatType.Direct as ChatType` at the module level. All code in MessageSender that references the direct chat type SHALL use this constant instead of repeating the cast expression.

#### Scenario: Direct chat type is defined once
- **WHEN** the MessageSender module is loaded
- **THEN** a constant `DIRECT_CHAT_TYPE` is available with the value of `ChatType.Direct as ChatType`

#### Scenario: All direct chat references use the constant
- **WHEN** any method in MessageSender needs to reference the direct chat type
- **THEN** it SHALL use `DIRECT_CHAT_TYPE` rather than `ChatType.Direct as ChatType`

### Requirement: No send-or-update indirection
The MessageSender SHALL NOT contain a `sendOrUpdateLiveMessage` method or any private wrapper method that merely delegates to `updateLiveMessageCmd`. Callers SHALL invoke `updateLiveMessageCmd` directly with explicit parameters.

#### Scenario: No private wrapper method exists
- **WHEN** the MessageSender module is reviewed
- **THEN** no private method named `updateLiveMessage` or `sendOrUpdateLiveMessage` exists that merely extracts context fields and delegates to `updateLiveMessageCmd`

#### Scenario: Callers invoke updateLiveMessageCmd directly
- **WHEN** a caller needs to update a live message during streaming
- **THEN** the caller constructs the `updateLiveMessageCmd` call directly with `contactId`, `liveMessageItemId`, `accumulatedText`, and `liveMessage: true`