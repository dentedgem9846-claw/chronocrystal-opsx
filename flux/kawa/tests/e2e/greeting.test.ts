import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { aliceHistory, kawaContactId, setupShared, teardownShared } from "./setup.js";

describe("greeting", () => {
	beforeAll(async () => {
		await setupShared();
	}, 120000);

	afterAll(async () => {
		await teardownShared();
	}, 30000);

	it("Kawa greets Alice with 👋", () => {
		const greeting = aliceHistory.find((m) => m.contactId === kawaContactId);
		expect(greeting).toBeDefined();
		expect(greeting?.text).toContain("👋");
		expect(greeting?.text.toLowerCase()).toContain("coding agent");
	});
});
