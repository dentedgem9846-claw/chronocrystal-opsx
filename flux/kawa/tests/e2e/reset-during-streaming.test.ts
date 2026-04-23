import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { resetSession, send, waitForMessage } from "./helpers.js";
import { aliceHistory, setupShared, teardownShared } from "./setup.js";

describe("reset-during-streaming", () => {
	beforeAll(async () => {
		await setupShared();
	}, 120000);

	afterEach(async () => {
		await resetSession();
	}, 60000);

	afterAll(async () => {
		await teardownShared();
	}, 30000);

	it("/new during streaming resets state cleanly with no stale bleed", async () => {
		aliceHistory.length = 0;

		// Start a streaming response that will take some time (tool use)
		await send("Run `ls` and tell me what you see");

		// Wait briefly for Kawa to start processing, then send /new mid-response
		await new Promise((r) => setTimeout(r, 2000));
		await send("/new");

		// Wait for the new-session confirmation
		const resetReply = await waitForMessage(
			(t) => t.includes("fresh") || t.includes("New session") || t.includes("Maximum sessions"),
			120000,
		);
		expect(resetReply).toBeTruthy();

		// Drain stale history from the aborted session
		for (let i = aliceHistory.length - 1; i >= 0; i--) {
			if (aliceHistory[i].contactId !== undefined) aliceHistory.splice(i, 1);
		}

		// Now send a fresh prompt in the new session
		await send("What is 2+2?");

		// Wait for the answer — verify no stale content from the previous session bleeds in
		const freshReply = await waitForMessage(
			(t) => /\b4\b|four|2\s*\+\s*2/i.test(t) || t.includes("(Agent finished with no output)"),
			180000,
		);

		console.log("[test] reset-during-streaming fresh reply:", freshReply.slice(0, 200));
		expect(freshReply).toBeTruthy();

		// Verify the fresh reply does NOT contain stale ls output from the previous session
		// (The previous prompt asked to run `ls`, so stale state would contain "ls" content)
		expect(freshReply).not.toMatch(/\bls\b.*total\s+\d/);
	}, 300000);
});
