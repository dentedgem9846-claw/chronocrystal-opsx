import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { resetSession, send, waitForMessage } from "./helpers.js";
import { aliceHistory, setupShared, teardownShared } from "./setup.js";

describe("new-command", () => {
	beforeAll(async () => {
		await setupShared();
	}, 120000);

	afterEach(async () => {
		await resetSession();
	}, 60000);

	afterAll(async () => {
		await teardownShared();
	}, 30000);

	it("/new while idle starts a fresh session", async () => {
		aliceHistory.length = 0;
		await send("/new");
		const reply = await waitForMessage(
			(t) => t.includes("fresh") || t.includes("New session"),
			30000,
		);
		expect(reply).toBeTruthy();
	});

	it("/new while streaming aborts and resets", async () => {
		aliceHistory.length = 0;
		// Start a streaming response with a short prompt
		await send("Tell me a short joke.");

		// Wait briefly for Kawa to start processing, then send /new
		await new Promise((r) => setTimeout(r, 2000));
		await send("/new");

		// Wait for the new-session confirmation
		const reply = await waitForMessage(
			(t) =>
				t.includes("fresh") ||
				t.includes("New session") ||
				t.includes("aborted") ||
				t.includes("Maximum sessions"),
			120000,
		);
		expect(reply).toBeTruthy();

		// Verify Kawa can respond normally after abort
		await send("Ping");
		const pong = await waitForMessage(
			(t) => t.toLowerCase().includes("ping") || t.length > 5,
			120000,
		);
		expect(pong).toBeTruthy();
	}, 300000);
});
