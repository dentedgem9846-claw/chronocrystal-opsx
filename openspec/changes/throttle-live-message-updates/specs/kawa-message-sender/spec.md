## MODIFIED Requirements

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