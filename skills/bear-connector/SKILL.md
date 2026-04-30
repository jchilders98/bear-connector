---
name: bear-connector
description: Use when a user wants to read, search, summarize, create, edit, append, prepend, or open Bear notes on macOS from Codex.
---

# Bear Connector

Use the local `bear-connector` CLI or the `bear` MCP tools to work with Bear notes.

## Safety

- Reads use Bear's local SQLite database in read-only mode.
- Writes use Bear's official `bear://x-callback-url` actions.
- Note reads prefer Bear's `open-note` x-callback action by default. SQLite reads remain available with `--source sqlite`.
- Search can use Bear's x-callback action when a Bear API token is available as `BEAR_TOKEN`; otherwise SQLite search is available with `--source sqlite`.
- For long writes, text is copied to the macOS clipboard and Bear is asked to consume the clipboard.
- Prefer `dryRun: true` or `--dry-run` before destructive replacements unless the user clearly asked to write.
- Reads return text only unless attachments are requested. Prefer metadata paths first; use base64 only when the host needs inline assets.

## CLI Examples

```bash
bear-connector recent --limit 5
bear-connector search --query "draft" --limit 10
bear-connector read --id NOTE_ID --text-only
bear-connector read --id NOTE_ID --source sqlite
bear-connector read --id NOTE_ID --include-attachments
bear-connector read --id NOTE_ID --attachments base64
bear-connector add --title "Draft" --text-file draft.md --tags "drafts"
bear-connector edit --id NOTE_ID --text-file draft.md --dry-run
bear-connector append --id NOTE_ID --text "Postscript" --new-line
```

## Defaults

The default database path is:

```text
~/Library/Group Containers/9K33E3U3T4.net.shinyfrog.bear/Application Data/database.sqlite
```

Override it with `BEAR_DATABASE` or `--database`.
