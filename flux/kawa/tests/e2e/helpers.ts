import { ChatType } from "@simplex-chat/types/dist/types.js";
import { aliceClient, aliceHistory, kawaContactId, updateCounts } from "./setup.js";

export interface MessageResult {
	text: string;
	/** ItemId of the message — can be used to look up update counts */
	itemId: number | undefined;
}

export async function send(text: string): Promise<void> {
	// @ts-ignore — ChatClient types mismatch between CJS/ESM
	await aliceClient.apiSendTextMessage(ChatType.Direct, kawaContactId, text);
}

export async function waitForMessage(
	matcher: (text: string) => boolean,
	timeoutMs = 180000,
): Promise<string> {
	const result = await waitForMessageDetail(matcher, timeoutMs);
	return result.text;
}

/**
 * Like waitForMessage but also returns the itemId for tracking update counts.
 */
export async function waitForMessageDetail(
	matcher: (text: string) => boolean,
	timeoutMs = 180000,
): Promise<MessageResult> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const idx = aliceHistory.findIndex((m) => m.contactId === kawaContactId && matcher(m.text));
		if (idx !== -1) {
			const { text, itemId } = aliceHistory[idx];
			aliceHistory.splice(idx, 1);
			return { text, itemId };
		}
		await new Promise((r) => setTimeout(r, 300));
	}
	throw new Error("Timeout waiting for message from Kawa");
}

export async function resetSession(): Promise<void> {
	await send("/new");
	await waitForMessage((t) => t.includes("New session") || t.includes("fresh"), 30000);
	// Drain any stale history and update counts
	for (let i = aliceHistory.length - 1; i >= 0; i--) {
		if (aliceHistory[i].contactId === kawaContactId) aliceHistory.splice(i, 1);
	}
	updateCounts.clear();
}
