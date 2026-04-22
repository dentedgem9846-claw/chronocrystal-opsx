import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { send, waitForMessage } from "./helpers.js";
import { aliceHistory, kawaContactId, setupShared, teardownShared } from "./setup.js";

describe("queued-messages", () => {
	beforeAll(async () => {
		await setupShared();
	}, 120000);

	afterAll(async () => {
		await teardownShared();
	}, 30000);

	it("Both messages receive responses even when sent during streaming", async () => {
		// Clear greeting and any stale history
		aliceHistory.length = 0;
		// Send a message that triggers an LLM stream
		await send("Count from 1 to 5 with one number per line.");

		// Immediately send a second message before the first completes
		await send("What is the capital of France?");

		// Collect responses from Kawa until both questions are answered.
		// Skip purely thinking/reasoning content — match on substantive keywords.
		const responses: string[] = [];
		const deadline = Date.now() + 180000;

		while (Date.now() < deadline && responses.length < 2) {
			const idx = aliceHistory.findIndex(
				(m) =>
					m.contactId === kawaContactId && m.text.length > 10 && !m.text.startsWith("The user"),
			);
			if (idx !== -1) {
				responses.push(aliceHistory[idx].text);
				aliceHistory.splice(idx, 1);
			}
			await new Promise((r) => setTimeout(r, 500));
		}

		expect(responses.length).toBeGreaterThanOrEqual(2);
		// Verify both responses have meaningful content
		expect(responses[0].length).toBeGreaterThan(0);
		if (responses[1]) expect(responses[1].length).toBeGreaterThan(0);
	}, 300000);
});
