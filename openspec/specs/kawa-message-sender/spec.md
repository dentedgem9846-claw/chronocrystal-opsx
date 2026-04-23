## ADDED Requirements

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

### Requirement: Update live message
The MessageSender SHALL provide an `updateLiveMessage` method that updates the text content of an existing live message during the STREAMING state. The method SHALL return `Promise<void>`. The method SHALL NOT attempt to create a new message — it SHALL only operate on an existing live message identified by `liveMessageItemId`.

When a `LiveMessageThrottler` is active, `updateLiveMessage` calls from `handleAgentEvent` SHALL go through the throttler instead of directly to `updateLiveMessageCmd`. The MessageSender's `updateLiveMessage` method itself remains unchanged — the throttler calls it when the throttle interval fires.

#### Scenario: Update content of an existing live message (unthrottled)
- **WHEN** `updateLiveMessage` is called with a `contactId`, `liveMessageItemId`, and `accumulatedText`
- **AND** the `liveMessageItemId` is non-null
- **THEN** the MessageSender calls `updateLiveMessageCmd` with `liveMessage: true` using the provided fields
- **AND** the method returns `Promise<void>`

#### Scenario: Skip update when live message item ID is null
- **WHEN** `updateLiveMessage` is called with a null `liveMessageItemId`
- **THEN** the MessageSender SHALL NOT call `updateLiveMessageCmd`
- **AND** the method returns `Promise<void>` without error

#### Scenario: Throttled update path
- **WHEN** `handleAgentEvent` processes a `message_update` event while a LiveMessageThrottler is active
- **THEN** `handleAgentEvent` SHALL call `throttler.scheduleUpdate(ctx)` instead of `sender.updateLiveMessage(ctx, ctx.accumulatedText)`
- **AND** the throttler SHALL eventually call `sender.updateLiveMessage(ctx, ctx.accumulatedText)` when the throttle interval fires or on flush

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
The MessageSender SHALL NOT contain a `sendOrUpdateLiveMessage` method or any private wrapper method that merely delegates to `updateLiveMessageCmd`. Callers SHALL use the public `updateLiveMessage` method, which encapsulates the null guard for `liveMessageItemId` and delegates to `updateLiveMessageCmd`.

#### Scenario: No private wrapper method exists
- **WHEN** the MessageSender module is reviewed
- **THEN** no private method named `updateLiveMessage` or `sendOrUpdateLiveMessage` exists that merely extracts context fields and delegates to `updateLiveMessageCmd`

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