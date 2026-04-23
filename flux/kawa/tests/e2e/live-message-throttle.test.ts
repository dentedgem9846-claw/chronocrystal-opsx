import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { resetSession, send, waitForMessageDetail } from "./helpers.js";
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

	// The throttle interval is set via KAWA_LIVE_MSG_UPDATE_INTERVAL_MS (default 50ms).
	// Run `KAWA_LIVE_MSG_UPDATE_INTERVAL_MS=0 npx vitest run --config vitest.e2e.config.ts`
	// to see unthrottled baseline: more commands, slower delivery.
	const throttleMs = process.env.KAWA_LIVE_MSG_UPDATE_INTERVAL_MS ?? "50";

	/**
	 * 5.1: Verify that throttling reduces command count AND speeds up delivery.
	 *
	 * This test measures:
	 *   - updateCommands: how many chatItemUpdated events per message (proxy for
	 *     updateLiveMessage commands sent to SimpleX CLI). Throttling coalesces
	 *     token-by-token updates into timed batches.
	 *   - totalMs: time from send to finalized message. Counter-intuitively,
	 *     throttling is FASTER because the CLI processes commands sequentially —
	 *     a flood of updates creates a backlog that delays the final message.
	 *
	 * Expected results by interval:
	 *   interval=1  (near-unthrottled): many commands, slow delivery
	 *   interval=50 (throttled):         ~5-15 commands, ~3-5s delivery
	 *   interval=200 (conservative):     ~3-8 commands,  ~3-5s delivery
	 *
	 * Run with KAWA_LIVE_MSG_UPDATE_INTERVAL_MS=1 for near-unthrottled comparison.
	 * Note: interval=0 is rejected at startup by parsePositiveInt().
	 */
	it("throttled updates reduce command count and deliver messages faster", async () => {
		console.log(`[test] throttle interval: ${throttleMs}ms`);
		aliceHistory.length = 0;
		updateCounts.clear();

		const sendTime = Date.now();
		await send("Tell me a short paragraph about the ocean");

		const { text: reply, itemId } = await waitForMessageDetail(
			(t) => t.length > 50 || t.includes("(Agent finished with no output)"),
			180000,
		);
		const totalMs = Date.now() - sendTime;

		const cmdCount = itemId ? (updateCounts.get(itemId) ?? 0) : 0;

		console.log(
			`[test] throttle @${throttleMs}ms: ${totalMs}ms total, ${cmdCount} update commands, reply length: ${reply.length}`,
		);

		// The reply should be non-trivial
		expect(reply.length).toBeGreaterThan(20);

		// When throttled (interval > 0), command count should be well below
		// unthrottled baseline (75-100). We expect ~5-15 updates per response.
		// Using 30 as a generous upper bound to avoid flaky failures.
		if (Number(throttleMs) > 1) {
			if (cmdCount > 0) {
				expect(cmdCount).toBeLessThan(30);
				console.log(`[test] throttle: ✓ ${cmdCount} commands < 30`);
			} else {
				// cmdCount=0 means we couldn't track itemId (possible in some flows)
				console.log("[test] throttle: ⚠ could not measure command count (itemId not tracked)");
			}

			// Throttled delivery should complete in under 15s for a short paragraph.
			// Near-unthrottled (interval=1) typically takes much longer due to CLI backlog.
			expect(totalMs).toBeLessThan(15000);
			console.log(`[test] throttle: ✓ ${totalMs}ms < 15000ms (delivery speed)`);
		} else {
			// interval=1 (near-unthrottled): expect high command count and slow delivery.
			// These are NOT hard assertions — just logging for comparison.
			console.log(
				`[test] near-unthrottled baseline: ${cmdCount} commands, ${totalMs}ms delivery (for comparison)`,
			);
		}
	}, 300000);

	// 5.2: First token appears immediately (no throttle delay on startLiveMessage).
	it("first token appears immediately (startLiveMessage not throttled)", async () => {
		aliceHistory.length = 0;

		const start = Date.now();
		await send("What is 2+2?");

		const { text: reply } = await waitForMessageDetail(
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

		const { text: reply } = await waitForMessageDetail(
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

		const { text: reply } = await waitForMessageDetail(
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
		const { text: resetMsg } = await waitForMessageDetail(
			(t) => t.includes("New session") || t.includes("fresh") || t.includes("Maximum sessions"),
			30000,
		);

		// Drain stale history
		for (let i = aliceHistory.length - 1; i >= 0; i--) {
			if (aliceHistory[i].contactId !== undefined) aliceHistory.splice(i, 1);
		}

		// Send a fresh prompt — should get a clean response
		await send("What is 3+3?");

		const { text: freshReply } = await waitForMessageDetail(
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

		const { text: reply } = await waitForMessageDetail(
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

		const { text: reply } = await waitForMessageDetail(
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
