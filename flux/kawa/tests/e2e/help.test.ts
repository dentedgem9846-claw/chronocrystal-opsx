import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { send, waitForMessage } from "./helpers.js";
import { aliceHistory, kawaContactId, setupShared, teardownShared } from "./setup.js";

describe("help", () => {
	beforeAll(async () => {
		await setupShared();
	}, 120000);

	afterAll(async () => {
		await teardownShared();
	}, 30000);

	it("Alice sees commands when she sends /help", async () => {
		aliceHistory.length = 0;
		await send("/help");
		const reply = await waitForMessage((t) => t.includes("/help") && t.includes("/new"), 30000);
		expect(reply).toContain("/help");
		expect(reply).toContain("/new");
		expect(reply).toContain("/compact");
		expect(reply).toContain("/status");
	});
});
