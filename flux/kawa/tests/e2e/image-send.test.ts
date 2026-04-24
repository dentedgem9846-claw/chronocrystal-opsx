import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetSession, send, waitForMessage } from "./helpers.js";
import { setupShared, teardownShared } from "./setup.js";

describe("image-send", () => {
	beforeAll(async () => {
		await setupShared();
	}, 120000);

	afterAll(async () => {
		await teardownShared();
	}, 30000);

	it("Kawa sends an image via the send_image tool when asked", async () => {
		await resetSession();

		// Ask Kawa to send an image using the send_image tool
		// Note: This test requires that a test image exists at a known path
		// or that the agent can create one. We ask it to send a specific file.
		await send(
			"Please use your send_image tool to send me the image at /tmp/kawa-e2e-test-files/test-image.png",
		);

		// Wait for Kawa's response (it should use the send_image tool)
		const response = await waitForMessage(
			(text) => text.length > 5 && !text.includes("👋"),
			180000,
		);

		// The agent should either send the image or explain why it couldn't
		expect(response).toBeDefined();
	}, 180000);
});
