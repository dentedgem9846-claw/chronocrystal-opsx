## ADDED Requirements

### Requirement: Synchronous state transitions
All live message state transitions in `handleAgentEvent` SHALL occur synchronously before any `await` expression. The `liveMessageState` field SHALL be written before the first yield point so that subsequent events cannot read stale state.

#### Scenario: IDLE to STREAMING transition is atomic
- **WHEN** a `message_update` event fires while `liveMessageState` is IDLE
- **THEN** `liveMessageState` SHALL be set to STREAMING synchronously (before any `await`)
- **AND** the `await sender.startLiveMessage()` call happens after the state transition
- **AND** a second event firing during the `await` SHALL read STREAMING and call `updateLiveMessage` instead of `startLiveMessage`

#### Scenario: Accumulated text updated synchronously
- **WHEN** a `tool_execution_start` or `tool_execution_end` event fires
- **THEN** `accumulatedText` SHALL be appended synchronously before `await sender.updateLiveMessage()`
- **AND** the `await` call uses the already-updated `accumulatedText`

### Requirement: Generation-based staleness detection
`ContactContext` SHALL include a `generation` counter that is incremented when the context is reset (new prompt, `/new` command, or session creation). Any in-flight async handler SHALL capture `generation` before yielding and discard its results if `generation` has changed after the yield.

#### Scenario: New prompt invalidates in-flight agent events
- **WHEN** a user sends a new message while agent events from a previous prompt are still in-flight
- **THEN** `handleIncomingMessage` SHALL increment `ctx.generation`
- **AND** any in-flight `handleAgentEvent` SHALL check `ctx.generation` after each `await`
- **AND** if the generation has changed, the event handler SHALL discard its results and return early

#### Scenario: /new command invalidates in-flight agent events
- **WHEN** a user sends `/new` while agent events are in-flight
- **THEN** `handleNew` SHALL increment `ctx.generation` on the old context
- **AND** any in-flight events on the old context SHALL detect the generation change and return early
- **AND** the new session SHALL start with `generation: 0` (or the next sequential value)

#### Scenario: Generation counter does not overflow
- **WHEN** generation is incremented 1000 times
- **THEN** the counter SHALL remain a valid JavaScript number with no precision loss
- **AND** stale event detection SHALL continue to work correctly

### Requirement: Stale event result discard is silent
When an in-flight event detects a generation mismatch and discards its results, it SHALL NOT throw, log an error, or send a message to the contact. The discard SHALL be a silent no-op.

#### Scenario: Stale startLiveMessage result discarded
- **WHEN** `startLiveMessage` completes after the generation has changed
- **THEN** the itemId SHALL NOT be written to `ctx.liveMessageItemId`
- **AND** no error message SHALL be sent to the contact

#### Scenario: Stale updateLiveMessage result discarded
- **WHEN** `updateLiveMessage` completes after the generation has changed
- **THEN** no additional state mutation SHALL occur
- **AND** the event handler SHALL return immediately