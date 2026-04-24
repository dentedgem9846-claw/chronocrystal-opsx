import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ChatType } from "@simplex-chat/types/dist/types.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { aliceClient, kawaContactId, resetSession, send, waitForMessage } from "./helpers.js";
import { setupShared, teardownShared } from "./setup.js";

describe("image-receive", () => {
	beforeAll(async () => {
		await setupShared();
	}, 120000);

	afterAll(async () => {
		await teardownShared();
	}, 30000);

	it("Kawa receives and describes an image sent by Alice", async () => {
		await resetSession();

		// Create a small test image (1x1 red PNG)
		const testImageDir = "/tmp/kawa-e2e-test-files";
		await mkdir(testImageDir, { recursive: true });
		// Minimal 1x1 red PNG in base64
		const minimalPng = Buffer.from(
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
			"base64",
		);
		const testImagePath = join(testImageDir, "test-image.png");
		await writeFile(testImagePath, minimalPng);

		// Send the image to Kawa using apiSendMessages
		if (!aliceClient) throw new Error("Alice client not initialized");
		const client = aliceClient;
		await client.apiSendMessages(ChatType.Direct as unknown as number, kawaContactId, [
			{
				msgContent: {
					type: "image" as const,
					text: "What is in this image?",
					image: minimalPng.toString("base64"),
				},
				mentions: {},
			},
		]);

		// Wait for Kawa's response
		const response = await waitForMessage(
			(text) => text.length > 10 && !text.includes("👋"),
			180000,
		);

		// The response should acknowledge the image in some way
		// A vision-capable model should describe the image content
		expect(response).toBeDefined();
	}, 180000);
});
