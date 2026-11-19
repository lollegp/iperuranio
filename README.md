# iperuranio

Project-local technical memory for Codex, Claude Code and Copilot CLI. The project shares English Markdown records through its existing Git workflow. Installation requires Git, Node 24 or later and a POSIX shell.

## Install in a project

From the target checkout, install this package as a local development dependency or invoke its CLI directly from the source checkout.

```sh
npm install --save-dev /absolute/path/to/iperuranio
npx --no-install iperuranio init codex
npx --no-install iperuranio init claude-code
npx --no-install iperuranio init copilot-cli
```

Each init copies the Node runtime to `.iperuranio/runtime`, installs a project skill, registers hooks and configures the stdio MCP server. Inspect the generated files in Git. Restart the agent and enable the project and hooks in its trust settings. Each collaborator runs init to enroll their own checkout. From the project root, `node .iperuranio/runtime/cli.ts` works without npm installation. No commit or push runs automatically. Use `--history-dir docs/memory` on first initialization to change the archive location. The directory must stay inside the project.

## Daily use

```sh
iperuranio search "perché il contenuto rimane persistente?"
iperuranio search "render" --file src/List.tsx
iperuranio save "Adopt memoization for the list." --source src/List.tsx
iperuranio forget "Use a 30 minute cache" --reason "Content remained stale"
iperuranio pending
iperuranio review CANDIDATE_ID
iperuranio show RECORD_ID
iperuranio save "Reduce max-age to 5 minutes." --supersedes RECORD_ID
iperuranio history RECORD_ID
```

Use the installed local bin through npx or the project's package scripts. Agent writes use the same gateway via MCP or JSON on stdin. Example input for `save --stdin`:

```json
{"text":"Use sessionStorage for the login API token.","reason":"Historical storage rationale unknown.","ticket":"ABC-1234","source":"src/login.ts","kind":"decision"}
```

An English-speaking reviewer checks the exact final Markdown and confirms in a terminal. A candidate ID refers to private state. A record ID refers to the reviewed artifact. Save and review are separate operations. Git review controls subsequent changes to the shared files. The archive follows the checkout. Search returns up to three excerpts. Show reads the full record. History follows challenges and replacements. MCP exposes search, save, explain, history, handoff and challenge. The client must run the server in the project.

## Automatic capture and languages

Prompt and turn hooks process the payload and retain a private transcript reference where provided. Session start replays unread complete JSONL lines. Recovery handles common Codex and Claude envelopes and Copilot message entries in default host directories. Text unavailable from both an event and a retained transcript cannot be recovered. Without inference the runtime detects decision-related phrases, preserves candidate wording for review and relies on the agent skill for structured English drafts. The lexical search includes a small explicit multilingual vocabulary.

Optional: run a **trusted offline inference server** compatible with the OpenAI chat completions request format (model alias `local`) on this machine. Add `--model-port 8080` to init to authorize eligible private segments for that local server. The worker calls the loopback address, queues inputs outside Git, extracts English claims and checks them against the original in a separate inference call. Human review covers generated free text. Configure the server itself to disable logging and remote forwarding. A failed extraction stays queued. Run `iperuranio drain` to retry. CLI search can expand the query with the local model. MCP clients can submit translated query terms directly.

Optional: `init codex --auto-cache` authorizes one closed publication rule for explicit user decisions. It accepts exactly “Decision: change max-age from 2 to 10 minutes” or “Decisione: cambiare max-age da 2 a 10 minuti” with variable integer values. Additional clauses invalidate the rule. Use only if this fact is shareable with every repository reader. All other prose requires review.

## Privacy and limits

Private state lives under `~/.local/state/iperuranio/<checkout-hash>/` with owner-only file permissions. Treat these files as sensitive. They can contain private candidate text and, with local inference enabled, source segments used for verification. The original transcript stays under the host's retention policy. Signature checks reject common credentials and email addresses; names and organization-specific confidential data require human classification. Restrict agent write access and use repository review controls. A terminal confirmation is an interaction guard, not an identity boundary against another process running as the same OS user. Editing Markdown directly bypasses the CLI. Git controls readership at repository scope.

Automatic capture is best effort and currently limits each eligible message to 12,000 characters. Review skipped messages and host-specific coverage before production use. No cloud inference is bundled. Generic translation fidelity, real-client hook delivery and IDE compatibility require deployment testing. Keep a local inference server on a trusted device. Review private candidates promptly.

## Verify

For development, use Node 24 (`nvm use`), then run `npm ci` and `npm run check`. The check runs Oxlint and the test suite. To run either separately, use `npm run lint` or `npm test`. Tests use temporary Git repositories, isolated home directories and synthetic messages. The project does not need an external service for its default test suite.
