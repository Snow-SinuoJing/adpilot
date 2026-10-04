import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Per-test-file isolation (vitest runs each file in its own fork):
 * a fresh data root + fully offline providers, so tests never touch
 * real keys, real API calls, or the developer's data/ directory.
 */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adpilot-vitest-"));
process.env.ADPILOT_DATA_DIR = dir;
process.env.LLM_MODE = "mock";
process.env.VIDEO_PROVIDER = "fake";
process.env.TTS_PROVIDER = "fake";
delete process.env.RECORD_REPLAY_NAME;

export const TEST_DATA_DIR = dir;
