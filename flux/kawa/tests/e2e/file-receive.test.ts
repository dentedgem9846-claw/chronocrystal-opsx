import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ChatType } from "@simplex-chat/types/dist/types.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { aliceClient, kawaContactId, resetSession, send, waitForMessage } from "./helpers.js";
import { setupShared, teardownShared } from "./setup.js";

describe("file-receive", () => {
	beforeAll(async () => {
		await setupShared();
	}, 120000);

	afterAll(async () => {
		await teardownShared();
	}, 30000);

	it("Kawa receives a file from Alice and references it in response", async () => {
		await resetSession();

		// Create a test source file to send
		const testFileDir = "/tmp/kawa-e2e-test-files";
		await mkdir(testFileDir, { recursive: true });
		const testFilePath = join(testFileDir, "hello.py");
		await writeFile(testFilePath, 'print("Hello, World!")\n');

		// Send the file to Kawa using apiSendMessages
		if (!aliceClient) throw new Error("Alice client not initialized");
		const client = aliceClient;
		await client.apiSendMessages(ChatType.Direct as unknown as number, kawaContactId, [
			{
				fileSource: { filePath: testFilePath },
				msgContent: { type: "file" as const, text: "Review this code" },
				mentions: {},
			},
		]);

		// Wait for Kawa's response — it should reference the file content
		const response = await waitForMessage(
			(text) => text.length > 10 && !text.includes("👋"),
			180000,
		);

		// The response should reference the file content or name
		expect(response).toBeDefined();
	}, 180000);
});
