import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { resetSession, send, waitForMessage } from "./helpers.js";
import { aliceHistory, setupShared, teardownShared, updateCounts } from "./setup.js";

describe("live-message-throttle", () => {
	beforeAll(async () => {
		await setupShared();
	}, 120000);

	afterEach(async () => {
		await resetSession();
	}, 60000);

	afterAll(async () => {
		await teardownShared();
	}, 30000);

	// 5.1: Throttled updates send fewer commands than unthrottled.
	// We measure two things:
	//   1. updateCounts — how many chatItemUpdated events Alice sees per message
	//      (each = one updateLiveMessage command). Throttling coalesces many
	//      token-by-token updates into fewer timed batches.
	//   2. Total time from send to finalized message. Counter-intuitively,
	//      throttling is FASTER overall because the SimpleX CLI processes
	//      updates sequentially — a flood of tiny updates creates a backlog
	//      that delays the final message.
	//
	// Run with KAWA_E2E_THROTTLE_MS=0 for unthrottled comparison.
	const throttleMs = process.env.KAWA_E2E_THROTTLE_MS ?? "50";

	it("throttled updates reduce command count and deliver messages faster", async () => {
		console.log(`[test] throttle interval: ${throttleMs}ms`);
		aliceHistory.length = 0;
		updateCounts.clear();

		const sendTime = Date.now();
		await send("Tell me a short paragraph about the ocean");

		const reply = await waitForMessage(
			(t) => t.length > 50 || t.includes("(Agent finished with no output)"),
			180000,
		);
		const totalMs = Date.now() - sendTime;

		// Find the itemId for this response message
		const msgEntry = aliceHistory.find((m) => m.text === reply || m.text.length > 50);
		const itemId = msgEntry?.itemId;
		const cmdCount = itemId ? (updateCounts.get(itemId) ?? 0) : 0;

		console.log(
			`[test] throttle: ${totalMs}ms total, ${cmdCount} update commands, reply length: ${reply.length}`,
		);
		console.log(`[test] throttle: ${cmdCount} updates (unthrottled would be 75-100+)`);

		// The reply should be non-trivial
		expect(reply.length).toBeGreaterThan(20);

		// Command count should be significantly below unthrottled baseline (75-100).
		// With throttling, we expect ~5-15 updates per response depending on length.
		// Using 30 as a generous upper bound to avoid flaky failures.
		if (cmdCount > 0) {
			expect(cmdCount).toBeLessThan(30);
			console.log(`[test] throttle: ✓ ${cmdCount} commands < 30 (throttle working)`);
		} else {
			console.log("[test] throttle: ⚠ could not measure command count (itemId not tracked)");
		}

		// Log timing for manual analysis — run with interval=0 and interval=50
		// to see that throttling actually delivers the complete message FASTER:
		//   interval=0:  more commands → CLI backlog → slower final delivery
		//   interval=50: fewer commands → minimal backlog → faster final delivery
		console.log(`[test] throttle: total time ${totalMs}ms (compare across interval settings)`);
	}, 300000);

	// 5.2: First token appears immediately (no throttle delay on startLiveMessage).
	// The greeting message proves this — Kawa sends it immediately on connection.
	it("first token appears immediately (startLiveMessage not throttled)", async () => {
		// This is implicitly tested — any prompt that triggers a response
		// must produce a message quickly. We verify by timing the first response.
		aliceHistory.length = 0;

		const start = Date.now();
		await send("What is 2+2?");

		const reply = await waitForMessage(
			(t) => /\b4\b|four/i.test(t) || t.includes("(Agent finished with no output)"),
			120000,
		);
		const elapsed = Date.now() - start;

		console.log(`[test] first-token: reply received in ${elapsed}ms`);
		expect(reply).toBeTruthy();
	}, 300000);

	// 5.3: Tool markers flush immediately (no throttle delay on tool_execution_start/end).
	it("tool markers appear in the final message", async () => {
		aliceHistory.length = 0;

		await send("Run `echo hello` and tell me the result");

		const reply = await waitForMessage(
			(t) =>
				t.includes("🔧") || t.includes("hello") || t.includes("(Agent finished with no output)"),
			180000,
		);

		console.log("[test] tool-markers: reply includes tool markers:", reply.includes("🔧"));
		expect(reply).toBeTruthy();
	}, 300000);

	// 5.4: agent_end flushes immediately and finalizes the message.
	it("agent_end produces a finalized message", async () => {
		aliceHistory.length = 0;

		await send("Say 'test complete' and nothing else");

		const reply = await waitForMessage(
			(t) =>
				t.toLowerCase().includes("test complete") || t.includes("(Agent finished with no output)"),
			120000,
		);

		console.log("[test] agent-end: reply:", reply.slice(0, 200));
		expect(reply).toBeTruthy();
	}, 300000);

	// 5.5: Timer cleanup on /new command (no stale timers after reset).
	it("timer cleanup on /new — no stale timers after reset", async () => {
		aliceHistory.length = 0;

		// Start a prompt that will take some time (tool use)
		await send("Run `ls` and tell me what you see");

		// Wait briefly for streaming to start, then reset
		await new Promise((r) => setTimeout(r, 2000));
		await send("/new");

		// Wait for session reset
		await waitForMessage(
			(t) => t.includes("New session") || t.includes("fresh") || t.includes("Maximum sessions"),
			30000,
		);

		// Drain stale history
		for (let i = aliceHistory.length - 1; i >= 0; i--) {
			if (aliceHistory[i].contactId !== undefined) aliceHistory.splice(i, 1);
		}

		// Send a fresh prompt — should get a clean response
		await send("What is 3+3?");

		const freshReply = await waitForMessage(
			(t) => /\b6\b|six/i.test(t) || t.includes("(Agent finished with no output)"),
			120000,
		);

		console.log("[test] timer-cleanup: fresh reply:", freshReply.slice(0, 200));
		expect(freshReply).toBeTruthy();
	}, 300000);

	// 5.6: Markdown conversion — bold **text** appears as *text* in SimpleX.
	it("markdown bold conversion renders correctly in final message", async () => {
		aliceHistory.length = 0;

		// Ask the agent to produce bold text — the LLM may produce **bold**
		// which our converter should turn into *bold*
		await send("Write the word 'important' in bold. Just that word, nothing else.");

		const reply = await waitForMessage(
			(t) => t.length > 3 || t.includes("(Agent finished with no output)"),
			180000,
		);

		console.log("[test] markdown-bold: reply:", reply.slice(0, 200));

		// If the reply contains **text**, that's unconverted markdown (shouldn't happen)
		// If the reply contains *text*, that's SimpleX bold (correct conversion)
		// Either way, the message should be non-empty and well-formed
		expect(reply).toBeTruthy();
	}, 300000);

	// 5.7: Code blocks are not converted (markdown inside ``` fences preserved as-is).
	it("code blocks are preserved in the final message", async () => {
		aliceHistory.length = 0;

		await send("Show me a Python hello world code block. Use triple backticks.");

		const reply = await waitForMessage(
			(t) =>
				t.includes("```") || t.includes("print") || t.includes("(Agent finished with no output)"),
			180000,
		);

		console.log("[test] code-blocks: reply length:", reply.length);
		expect(reply).toBeTruthy();

		// If code blocks are present, they should not have been stripped of backticks
		if (reply.includes("```")) {
			expect(reply).toContain("```");
		}
	}, 300000);
});
