import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { send, waitForMessage } from "./helpers.js";
import { aliceHistory, setupShared, teardownShared } from "./setup.js";

describe("simple-prompt", () => {
	beforeAll(async () => {
		await setupShared();
	}, 120000);

	afterAll(async () => {
		await teardownShared();
	}, 30000);

	it("Alice asks a math question and Kawa answers", async () => {
		aliceHistory.length = 0;

		await send("What is 2+2?");
		// Wait for Kawa's final response — skip intermediate thinking/live messages.
		// The final message will contain the actual answer with patterns like "4", "four", or "2+2".
		// Use a long timeout because the LLM may take time to respond.
		const reply = await waitForMessage(
			(t) => /\b4\b|four|2\s*\+\s*2/i.test(t) || t.includes("(Agent finished with no output)"),
			180000,
		);
		console.log("[test] LLM reply:", reply.slice(0, 200));
		expect(reply.length).toBeGreaterThan(0);
		expect(reply).toMatch(/\b4\b|four|2\s*\+\s*2/i);
	}, 300000);
});
