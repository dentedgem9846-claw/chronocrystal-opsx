import type { MessageSender } from "./message-sender.js";
import type { ContactContext } from "./session-manager.js";

/**
 * Throttles live message updates to SimpleX Chat.
 *
 * Instead of sending one update per agent event, the throttler batches
 * updates into timed intervals. When the throttle timer fires, only
 * the latest accumulatedText is sent, discarding stale intermediate values.
 *
 * Tool events and finalization flush immediately so markers and the
 * final message appear without delay.
 */
export class LiveMessageThrottler {
	constructor(
		private sender: MessageSender,
		private intervalMs: number,
	) {}

	/**
	 * Schedule a throttled update for the given contact context.
	 *
	 * Buffers the current accumulatedText and starts/resets the throttle
	 * timer. When the timer fires, one updateLiveMessage call is made
	 * with the latest text.
	 */
	scheduleUpdate(ctx: ContactContext): void {
		// Clear any existing timer
		if (ctx.throttleTimer !== null) {
			clearTimeout(ctx.throttleTimer);
		}

		ctx.throttleTimer = setTimeout(() => {
			ctx.throttleTimer = null;
			// Skip if text hasn't changed since last send
			if (ctx.accumulatedText === ctx.lastSentText) return;
			const textToSend = ctx.accumulatedText;
			this.sender
				.updateLiveMessage(ctx, textToSend)
				.then(() => {
					ctx.lastSentText = textToSend;
				})
				.catch((err) => {
					console.error(`[throttler] Error in throttled update for contact ${ctx.contactId}:`, err);
				});
		}, this.intervalMs);
	}

	/**
	 * Flush any buffered update immediately.
	 *
	 * Cancels the pending throttle timer and sends the update right away.
	 * Used before tool markers and agent_end so they appear promptly.
	 *
	 * Includes generation-based staleness detection: if the generation
	 * counter has changed after the async update, the result is discarded.
	 */
	async flush(ctx: ContactContext): Promise<void> {
		const hadTimer = ctx.throttleTimer !== null;

		// Cancel any pending timer
		if (ctx.throttleTimer !== null) {
			clearTimeout(ctx.throttleTimer);
			ctx.throttleTimer = null;
		}

		// Only send if there's something to flush
		if (ctx.liveMessageState === "STREAMING" && ctx.liveMessageItemId !== null) {
			// No-op if no timer was pending and text hasn't changed since last send
			if (!hadTimer && ctx.accumulatedText === ctx.lastSentText) {
				return;
			}
			// Capture generation before await for staleness detection
			const gen = ctx.generation;
			const textToSend = ctx.accumulatedText;
			await this.sender.updateLiveMessage(ctx, textToSend);
			// Discard if generation changed during await (stale event)
			if (ctx.generation !== gen) return;
			ctx.lastSentText = textToSend;
		}
	}

	/**
	 * Cancel any pending throttle timer without sending an update.
	 *
	 * Used during session teardown to prevent stale timers from firing.
	 */
	cancel(ctx: ContactContext): void {
		if (ctx.throttleTimer !== null) {
			clearTimeout(ctx.throttleTimer);
			ctx.throttleTimer = null;
		}
	}
}
