---
name: iperuranio
description: Use reviewed project decisions to explain existing code, evaluate a proposed change, or hand off work between coding agents. Capture rationale and rejected alternatives as private review candidates.
---

# iperuranio

**Find the decision before repeating the investigation.** Search the current project's memory for the ticket, file or symbol involved. Use the project's iperuranio MCP tools when connected, or run `node .iperuranio/runtime/cli.ts` from the enrolled repository root. With the skill alone, read reviewed Markdown in the archive selected by `.iperuranio/config.json` (default `.iperuranio/decisions/`). If memory is unavailable, continue from the code and identify the missing context.

Open matching records with `memory_explain` or CLI `show`. Follow replacements with `memory_get_history` or `history`. Verify cited sources against the current branch. Distinguish a documented reason, an agent's proposal and an inference. An empty search leaves the reason unknown.

**During multi-agent work:**

- The coordinating agent passes relevant reviewed record IDs, scope and open questions to workers. Agents in separate checkouts verify that the records and code are present on their branch.
- Each worker reports what changed, why, and what it actually verified. Distinguish uncommitted work from a commit the next agent can fetch. Identify contrary evidence or a discarded alternative and its reason.
- Agree who stages each candidate so parallel agents do not submit the same conclusion. Use `memory_save` or `save --stdin` with English `text`, optional `reason`, `source` and `ticket`. Preserve quantities, conditions and uncertainty. Record proposals as `kind: proposal`; use `supersedes` only for a documented replacement.
- At handoff, use `kind: handoff` for the goal, decisions, alternatives, affected files, branch or commit, checks run, open issues and next action. The receiving agent can use `memory_get_handoff` or CLI `search` and check the references before resuming.

Keep credentials, personal data and raw chats out of candidates. Only the developer reviews and publishes free text. Candidate IDs are private to the checkout; share reviewed record IDs after the record reaches the recipient through Git. Without the runtime or MCP, deliver a concise handoff in the current conversation and leave the archive untouched.
