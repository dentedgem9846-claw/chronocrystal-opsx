import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { resetSession, send, waitForMessage } from "./helpers.js";
import { aliceHistory, setupShared, teardownShared } from "./setup.js";

describe("live-message-dedup", () => {
	beforeAll(async () => {
		await setupShared();
	}, 120000);

	afterEach(async () => {
		await resetSession();
	}, 60000);

	afterAll(async () => {
		await teardownShared();
	}, 30000);

	it("multi-event agent response produces a single live message", async () => {
		aliceHistory.length = 0;

		// Send a prompt designed to trigger tool use, which produces
		// multiple events: message_update, tool_execution_start,
		// tool_execution_end, agent_end
		await send("Run `ls` and then read the file package.json");

		// Wait for the agent to finish — look for a response that contains
		// typical tool-use output markers or substantial content
		const reply = await waitForMessage(
			(t) =>
				t.includes("package.json") ||
				t.includes("dependencies") ||
				t.includes("(Agent finished with no output)") ||
				t.length > 50,
			180000,
		);

		expect(reply).toBeTruthy();

		// Count distinct message itemIds from Kawa in aliceHistory.
		// A correct implementation creates exactly ONE live message that
		// gets updated in place and finalized as one item.
		const kawaMessages = aliceHistory.filter((m) => m.itemId !== undefined);
		const distinctItemIds = new Set(kawaMessages.map((m) => m.itemId));

		console.log(
			`[test] live-message-dedup: ${kawaMessages.length} history entries, ${distinctItemIds.size} distinct itemIds`,
		);
		expect(distinctItemIds.size).toBe(1);
	}, 300000);
});
