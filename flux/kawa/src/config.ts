/**
 * Configuration for Kawa.
 */
export interface KawaConfig {
	/** Port for the simplex-chat CLI WebSocket server */
	simplexPort: number;
	/** Path to the simplex-chat CLI binary */
	simplexBin: string;
	/** Display name for the bot profile on SimpleX */
	botDisplayName: string;
	/** Data directory for the simplex-chat CLI (passed as -d flag). If empty, uses simplex-chat default. */
	simplexDataDir: string;
	/** Path to the Kawa agent directory (.pi/) */
	agentDir: string;
	/** Working directory for agent sessions */
	cwd: string;
	/** Maximum concurrent agent sessions */
	maxSessions: number;
	/** Port for the address HTTP API */
	addressApiPort: number;
	/** Tool output truncation line limit */
	toolTruncationLines: number;
	/** Throttle interval for live message updates (ms). Reduces SimpleX command volume by batching updates. */
	liveMessageUpdateIntervalMs: number;
	/** Backoff settings for SimpleX CLI restart */
	restartBackoff: {
		initialMs: number;
		maxMs: number;
		multiplier: number;
	};
}

export const defaultConfig: KawaConfig = {
	simplexPort: 5225,
	simplexBin: "simplex-chat",
	botDisplayName: "Kawa",
	simplexDataDir: "",
	agentDir: "", // Will be set relative to project root
	cwd: "", // Will be set to process.cwd()
	maxSessions: 3,
	addressApiPort: 8080,
	toolTruncationLines: 5,
	liveMessageUpdateIntervalMs: 200,
	restartBackoff: {
		initialMs: 1000,
		maxMs: 30000,
		multiplier: 2,
	},
};
