import { ChatType } from "@simplex-chat/types/dist/types.js";
import { aliceClient, aliceHistory, kawaContactId } from "./setup.js";

export async function send(text: string): Promise<void> {
	// @ts-ignore — ChatClient types mismatch between CJS/ESM
	await aliceClient.apiSendTextMessage(ChatType.Direct, kawaContactId, text);
}

export async function waitForMessage(
	matcher: (text: string) => boolean,
	timeoutMs = 180000,
): Promise<string> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const idx = aliceHistory.findIndex((m) => m.contactId === kawaContactId && matcher(m.text));
		if (idx !== -1) {
			const { text } = aliceHistory[idx];
			aliceHistory.splice(idx, 1);
			return text;
		}
		await new Promise((r) => setTimeout(r, 300));
	}
	throw new Error("Timeout waiting for message from Kawa");
}

export async function resetSession(): Promise<void> {
	await send("/new");
	await waitForMessage((t) => t.includes("New session") || t.includes("fresh"), 30000);
	// Drain any stale history
	for (let i = aliceHistory.length - 1; i >= 0; i--) {
		if (aliceHistory[i].contactId === kawaContactId) aliceHistory.splice(i, 1);
	}
}
