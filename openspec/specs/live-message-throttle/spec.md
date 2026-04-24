## ADDED Requirements

### Requirement: Throttled live message updates
The LiveMessageThrottler SHALL batch `updateLiveMessage` calls into timed intervals instead of sending one SimpleX command per agent event. Each `message_update` event SHALL be buffered and only the latest `accumulatedText` SHALL be sent when the throttle interval fires.

#### Scenario: Message updates are throttled
- **WHEN** multiple `message_update` events arrive within a single throttle interval (default 200ms)
- **THEN** the throttler SHALL buffer the latest `accumulatedText` for each contact
- **AND** only one `updateLiveMessage` call SHALL be made when the interval fires
- **AND** the text sent SHALL be the most recent `accumulatedText` at the time of the flush

#### Scenario: First token appears immediately
- **WHEN** a `message_update` event causes an IDLE → STREAMING transition
- **THEN** `startLiveMessage` SHALL be called immediately without throttling
- **AND** the first token SHALL appear to the user without throttle delay

#### Scenario: Tool markers appear promptly
- **WHEN** a `tool_execution_start` or `tool_execution_end` event fires
- **THEN** the throttler SHALL flush any buffered update immediately before appending the tool marker text
- **AND** the tool marker (🔧 prefix) SHALL be visible to the user without throttle delay

#### Scenario: Agent end flushes immediately
- **WHEN** an `agent_end` event fires
- **THEN** the throttler SHALL flush any buffered update before finalizing
- **AND** `finalizeLiveMessage` SHALL be called after the flush completes
- **AND** the user SHALL see the complete final message without throttle delay

### Requirement: Configurable throttle interval
The throttle interval SHALL be configurable via the `KAWA_LIVE_MSG_UPDATE_INTERVAL_MS` environment variable, with a default of 50ms.

#### Scenario: Default interval
- **WHEN** `KAWA_LIVE_MSG_UPDATE_INTERVAL_MS` is not set
- **THEN** the throttle interval SHALL be 50ms

#### Scenario: Custom interval
- **WHEN** `KAWA_LIVE_MSG_UPDATE_INTERVAL_MS` is set to `500`
- **THEN** the throttle interval SHALL be 500ms

### Requirement: Throttle timer cleanup on session teardown
The throttle timer SHALL be cleaned up when a contact session is torn down (new prompt, `/new` command, or contact removal).

#### Scenario: Timer cancelled on /new command
- **WHEN** a user sends `/new` while a throttled update is pending
- **THEN** the pending throttle timer SHALL be cancelled
- **AND** no throttled update SHALL fire after the session is reset

#### Scenario: Timer cancelled on contact removal
- **WHEN** a contact is removed via `removeByContactId`
- **THEN** the pending throttle timer for that contact SHALL be cancelled
- **AND** no throttled update SHALL fire for the removed contact

### Requirement: Throttle state on ContactContext
`ContactContext` SHALL include a `throttleTimer` field of type `ReturnType<typeof setTimeout> | null` to hold the throttle timer reference.

#### Scenario: Throttle timer is accessible on ContactContext
- **WHEN** a contact session is created
- **THEN** `ctx.throttleTimer` SHALL be initialized to `null`
- **AND** the throttler SHALL set `ctx.throttleTimer` when scheduling an update
- **AND** the throttler SHALL set `ctx.throttleTimer` to `null` after the timer fires or is cancelled

### Requirement: No throttle on startLiveMessage or finalizeLiveMessage
`startLiveMessage` and `finalizeLiveMessage` SHALL NOT be throttled. Only `updateLiveMessage` calls SHALL be throttled.

#### Scenario: Start message not throttled
- **WHEN** `startLiveMessage` is called
- **THEN** the `sendChatCmd` SHALL be sent immediately without any throttle delay

#### Scenario: Finalize message not throttled
- **WHEN** `finalizeLiveMessage` is called
- **THEN** the `updateLiveMessageCmd` with `liveMessage: false` SHALL be sent immediately without any throttle delay

### Requirement: Flush cancels the throttle timer
When `flush()` is called (e.g., by a tool marker or agent_end), it SHALL cancel any pending throttle timer and send the buffered update immediately.

#### Scenario: Flush during pending throttle
- **WHEN** a throttle timer is pending for a contact
- **AND** `flush()` is called (e.g., due to a tool_execution_start event)
- **THEN** the pending throttle timer SHALL be cancelled
- **AND** the buffered update SHALL be sent immediately
- **AND** no duplicate update SHALL be sent when the cancelled timer would have fired

#### Scenario: Flush with no pending timer
- **WHEN** no throttle timer is pending for a contact
- **AND** `flush()` is called
- **THEN** the method SHALL be a no-op (no update sent if no buffered text has changed since last send)