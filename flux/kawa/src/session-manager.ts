import type { AgentSession, AgentSessionEvent } from "@mariozechner/pi-coding-agent";

/**
 * Live message streaming state.
 */
export type LiveMessageState = "IDLE" | "STREAMING";

/**
 * Per-contact context holding the agent session and live message state.
 */
export interface ContactContext {
	contactId: number;
	session: AgentSession;
	/** Current live message chatItemId, if streaming */
	liveMessageItemId: number | null;
	/** Accumulated response text for the current live message */
	accumulatedText: string;
	/** State machine for live message lifecycle */
	liveMessageState: LiveMessageState;
	/** Unsubscribe function for the session event listener */
	unsubscribe: (() => void) | null;
	/** Generation counter for cross-path staleness detection. Incremented on new prompt or /new. */
	generation: number;
}

/**
 * Manages per-contact AgentSessions with O(1) lookups.
 */
export class SessionManager {
	private byContactId = new Map<number, ContactContext>();

	constructor(private maxSessions: number) {}

	/**
	 * Add a contact context. Returns false if max sessions exceeded.
	 */
	add(ctx: ContactContext): boolean {
		if (this.byContactId.size >= this.maxSessions) {
			return false;
		}
		this.byContactId.set(ctx.contactId, ctx);
		return true;
	}

	/**
	 * Get context by SimpleX contact ID.
	 */
	getByContactId(contactId: number): ContactContext | undefined {
		return this.byContactId.get(contactId);
	}

	/**
	 * Remove a contact context and clean up.
	 */
	removeByContactId(contactId: number): ContactContext | undefined {
		const ctx = this.byContactId.get(contactId);
		if (ctx) {
			this.byContactId.delete(contactId);
			ctx.unsubscribe?.();
		}
		return ctx;
	}

	/**
	 * Check if a contact has an active session.
	 */
	has(contactId: number): boolean {
		return this.byContactId.has(contactId);
	}

	/**
	 * Current number of active sessions.
	 */
	get size(): number {
		return this.byContactId.size;
	}

	/**
	 * Close all sessions.
	 */
	async closeAll(): Promise<void> {
		for (const ctx of this.byContactId.values()) {
			ctx.unsubscribe?.();
		}
		this.byContactId.clear();
	}
}
