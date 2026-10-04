# AdPilot — Self-Repairing Agentic Ad Studio

An interview-ready demo of **Agentic Decision + Deterministic Execution**: submit an ad brief, a
Creative Director agent plans 3 scenes, an Asset Planner decides per scene between library footage
and AI generation, a Multimodal Critic QA-checks every generated scene against keyframes, failures
are repaired **locally (one scene only)**, and FFmpeg composes the final 15–20s vertical MP4.

```
Brief → Agent Planning → Existing / AI-Generated Scene → Multimodal Evaluation
      → Local Repair when needed → TTS → FFmpeg Composition → Final MP4
```

**Runs 100% offline out of the box** — no API keys needed: mock LLM agents, a procedural
ffmpeg video provider, macOS `say` voiceovers and a 12-clip synthetic asset library.

## Quickstart (offline, zero keys)

```bash
npm install
npm run assets        # regenerate the demo asset library (12 synthetic clips)
npm run verify:ffmpeg # sanity-check the project-local ffmpeg binary
npm run dev           # http://localhost:3000
```

Then: **Load Demo Brief → Create Campaign**. In ~10s you get the full arc — S1/S3 reuse library
clips, S2 is AI-generated, scores 64 (REPAIR), regenerates only S2, scores 88 (PASS), TTS +
composition produce `data/media/<projectId>/final.mp4`.

## Demo modes

| Concern | Env | Values |
|---|---|---|
| LLM agents | `LLM_MODE` | `mock` (default when no key) · `live` (OpenAI-compatible: GLM / DeepSeek / MiniMax / OpenAI via `LLM_BASE_URL`) |
| Video | `VIDEO_PROVIDER` | `fake` (procedural ffmpeg) · `minimax` (real generation, needs `MINIMAX_API_KEY`) |
| TTS | `TTS_PROVIDER` | `fake` (macOS `say`, silent-track fallback) · `minimax` |
| Reliability | `DEMO_MODE` | `live` (always call providers) · `cache` (default; identical requests reuse real generations) · `replay` |
| Recording | `RECORD_REPLAY_NAME` | set to `demo-brazil` to capture the next run as a replayable fallback |

Replay appears on the home page as an amber "offline fallback" button and the UI is explicitly
badged **"Replay of previous real run"** — it never pretends to be a live call.

### Going live (real providers)

1. `cp .env.example .env` and fill in `LLM_API_KEY` (default endpoint: Zhipu GLM) and
   `MINIMAX_API_KEY`; set `LLM_MODE=live`, `VIDEO_PROVIDER=minimax`, `TTS_PROVIDER=minimax`.
2. Smoke: run once, confirm a real generated video + real voiceover appear.
3. Record the fallback: `RECORD_REPLAY_NAME=demo-brazil npm run dev`, run the demo brief once,
   restart without the variable. A ▶ demo-brazil chip now appears on the home page.

Model names are env-driven (`LLM_MODEL`, `LLM_VISION_MODEL`, `MINIMAX_VIDEO_MODEL`,
`MINIMAX_TTS_MODEL`, `MINIMAX_TTS_VOICE`) — verify current names against your provider console.

## Architecture

```
app/            Next.js UI + API (SSE event stream, media serving)
components/     three-column studio: brief · creative canvas · agent activity
lib/agents/     DIRECTOR (bounded 9-action space) · STRATEGY · ASSET PLANNER · CRITIC
lib/runtime/    orchestrator loop · scene state machine · limits · events
lib/state/      Zod ProjectState · store (JSON persistence) · selectors (context projection)
lib/tools/      search-assets · generate-video (cache+poll) · extract-frames · voice · compose
lib/providers/  VideoProvider / TTSProvider adapters: MiniMax (real) + Fake (offline)
data/           assets · cache · media · projects · replays (swap for Redis/S3 later)
```

Design rules enforced in code, not prompts:

- **Bounded autonomy** — the Director picks from `allowedActions(state)`; anything else is rejected.
- **State over prompt chaining** — every mutation goes through the store, is Zod-validated, and
  illegal scene transitions throw (`lib/runtime/reducer.ts`).
- **Deterministic execution** — polling, retries, cache keys, timeouts, FFmpeg live in the runtime;
  the LLM never sleeps or parses HTTP.
- **Local self-repair** — repair regenerates only the failed scene; hard caps: 3 scenes,
  1 repair/scene, 4 total generations, 20 director steps.
- **Observable by design** — the UI renders `RuntimeEvent`s only; no hidden chain-of-thought.

## Tests

```bash
npm test   # 39 tests: state machine · bounded actions · ranking · cache keys ·
           # provider parsers · ffmpeg builders · critic verdict · full offline e2e
```

## Interview demo script (4–6 min)

1. Old system (0:40): 2025 fixed workflow — stable, but the path was developer-defined.
2. Redesign (0:40): uncertainty went to agents, reliability stayed in code. Show architecture above.
3. Demo (1:00): Load Demo Brief → Create Campaign. Watch Agent Activity: Strategy → per-scene
   retrieval → S2 decides GENERATE with an auditable reason.
4. Climax (1:30): S2 scores 64 — REPAIR. Open the scene card: issue, prompt delta, repair history.
   Only S2 regenerates. 88 — PASS.
5. Final (0:50): play the composed MP4.
6. Close (0:30): what changed is *where* the autonomy lives — not "more agents".

**Fallbacks if the network dies**: replay chip on the home page, cache mode for identical runs,
and `data/media/<projectId>/final.mp4` on disk.
