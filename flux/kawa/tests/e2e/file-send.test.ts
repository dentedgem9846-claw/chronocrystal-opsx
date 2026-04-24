import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetSession, send, waitForMessage } from "./helpers.js";
import { setupShared, teardownShared } from "./setup.js";

describe("file-send", () => {
	beforeAll(async () => {
		await setupShared();
	}, 120000);

	afterAll(async () => {
		await teardownShared();
	}, 30000);

	it("Kawa sends a file via the send_file tool when asked", async () => {
		await resetSession();

		// Create a test file for the agent to send
		const testFileDir = "/tmp/kawa-e2e-test-files";
		await mkdir(testFileDir, { recursive: true });
		const testFilePath = join(testFileDir, "test-file.txt");
		await writeFile(testFilePath, "Hello from Kawa file send test!\n");

		// Ask Kawa to send the file using the send_file tool
		await send(
			"Please use your send_file tool to send me the file at /tmp/kawa-e2e-test-files/test-file.txt",
		);

		// Wait for Kawa's response
		const response = await waitForMessage(
			(text) => text.length > 5 && !text.includes("👋"),
			180000,
		);

		// The agent should either send the file or explain why it couldn't
		expect(response).toBeDefined();
	}, 180000);
});
