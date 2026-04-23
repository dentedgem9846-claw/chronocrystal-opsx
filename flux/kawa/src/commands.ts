import type { KawaConfig } from "./config.js";
import type { MessageSender } from "./message-sender.js";
import type { ContactContext, SessionManager } from "./session-manager.js";

/**
 * Handles slash commands from contacts.
 * Commands are routed here before AgentSession prompting.
 */
export class CommandHandler {
	constructor(
		private sessionManager: SessionManager,
		private messageSender: MessageSender,
		private config: KawaConfig,
		private createSession: (contactId: number) => Promise<ContactContext | undefined>,
	) {}

	/**
	 * Try to handle a message as a slash command.
	 * Returns true if the message was a command and was handled.
	 * Returns false if the message should be forwarded to the agent.
	 */
	async handle(contactId: number, text: string): Promise<boolean> {
		if (!text.startsWith("/")) return false;

		const parts = text.trim().split(/\s+/);
		const command = parts[0].toLowerCase();
		const ctx = this.sessionManager.getByContactId(contactId);

		switch (command) {
			case "/help":
				await this.handleHelp(contactId);
				return true;
			case "/new":
				await this.handleNew(contactId);
				return true;
			case "/compact":
				await this.handleCompact(contactId, ctx);
				return true;
			case "/status":
				await this.handleStatus(contactId, ctx);
				return true;
			default:
				// Unknown command — let the agent handle it
				return false;
		}
	}

	private async handleHelp(contactId: number): Promise<void> {
		const helpText = [
			"🔧 **Kawa Commands**",
			"/help — Show this help message",
			"/new — Start a fresh session (aborts current if streaming)",
			"/compact — Compact the current conversation context",
			"/status — Show current session status",
		].join("\n");
		await this.messageSender.sendTextMessage(contactId, helpText);
	}

	private async handleNew(contactId: number): Promise<void> {
		const oldCtx = this.sessionManager.getByContactId(contactId);
		if (oldCtx) {
			// Cancel any pending throttle timer
			if (oldCtx.throttleTimer !== null) {
				clearTimeout(oldCtx.throttleTimer);
				oldCtx.throttleTimer = null;
			}

			// Increment generation to invalidate any in-flight agent events
			oldCtx.generation++;

			// Finalize any stuck live message before aborting (Task 2.4)
			if (oldCtx.liveMessageState === "STREAMING") {
				await this.messageSender.finalizeLiveMessage(oldCtx);
			}
			// Abort before unsubscribe (Task 2.3) — cancel in-flight LLM request first
			await oldCtx.session.abort();
			oldCtx.unsubscribe?.();
			// Remove from session manager (unsubscribe already called, null it to prevent double-call)
			oldCtx.unsubscribe = null;
			this.sessionManager.removeByContactId(contactId);
		}

		const newCtx = await this.createSession(contactId);
		if (newCtx) {
			await this.messageSender.sendTextMessage(
				contactId,
				"🔄 New session started. Fresh context loaded.",
			);
		} else {
			await this.messageSender.sendTextMessage(
				contactId,
				"❌ Could not create new session. Maximum sessions reached.",
			);
		}
	}

	private async handleCompact(contactId: number, ctx: ContactContext | undefined): Promise<void> {
		if (!ctx) {
			await this.messageSender.sendTextMessage(
				contactId,
				"No active session. Send a message to start one.",
			);
			return;
		}
		try {
			await ctx.session.compact();
			await this.messageSender.sendTextMessage(contactId, "📦 Context compacted.");
		} catch (err) {
			console.error(`[cmd] Compact failed for contact ${contactId}:`, err);
			await this.messageSender.sendTextMessage(contactId, `❌ Compaction failed: ${err}`);
		}
	}

	private async handleStatus(contactId: number, ctx: ContactContext | undefined): Promise<void> {
		if (!ctx) {
			await this.messageSender.sendTextMessage(
				contactId,
				"No active session. Send a message to start one.",
			);
			return;
		}

		const state = ctx.session.state;
		const lines = [
			"📊 **Session Status**",
			`Model: ${state.model?.id ?? "unknown"}`,
			`Streaming: ${state.isStreaming ? "yes" : "no"}`,
			`Messages in context: ${state.messages?.length ?? 0}`,
			`Pending tool calls: ${state.pendingToolCalls?.size ?? 0}`,
		];
		await this.messageSender.sendTextMessage(contactId, lines.join("\n"));
	}
}
