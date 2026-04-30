# Bear Connector

Bear Connector is a local macOS connector for [Bear](https://bear.app/) notes. It lets agents and shell workflows read, search, create, edit, append, prepend, and open Bear notes without sending your note database to a hosted service.

## What It Does

- Reads and searches Bear's local SQLite database in read-only mode.
- Creates and edits notes through Bear's official `bear://x-callback-url` actions.
- Uses the macOS clipboard for write bodies so long notes are not squeezed into URL query strings.
- Ships a CLI, a small MCP-compatible stdio server, and Codex plugin metadata.

## Requirements

- macOS
- Bear for Mac
- Node.js 20+
- `sqlite3`, `pbcopy`, and `open` available on PATH

## Install

```bash
npm install -g jchilders98/bear-connector
```

Or run from a clone:

```bash
git clone https://github.com/jchilders98/bear-connector.git
cd bear-connector
npm link
```

## CLI Usage

```bash
bear-connector recent --limit 5
bear-connector search --query "Coffee" --limit 10
bear-connector read --id NOTE_ID --text-only
bear-connector read --id NOTE_ID --source sqlite
bear-connector read --id NOTE_ID --include-attachments
bear-connector read --id NOTE_ID --attachments base64
bear-connector read --title "Exact Note Title"
bear-connector add --title "Draft Title" --text-file draft.md --tags "drafts"
bear-connector edit --id NOTE_ID --text-file draft.md
bear-connector append --id NOTE_ID --text "Postscript" --new-line
bear-connector prepend --title "Draft Title" --text-file intro.md
bear-connector open --id NOTE_ID
```

Use `--dry-run` on write commands to print the Bear action without changing the clipboard or opening Bear:

```bash
bear-connector edit --id NOTE_ID --text-file draft.md --dry-run
```

## Attachments

Reads return text only by default. To include images and other Bear note files, request them explicitly:

```bash
bear-connector read --id NOTE_ID --include-attachments
bear-connector read --id NOTE_ID --attachments metadata
bear-connector read --id NOTE_ID --attachments base64
```

`metadata` returns local paths, dimensions, file sizes, MIME types, and Bear attachment IDs. `base64` also includes `base64` and `dataUrl` fields. Base64 can make responses very large, so it is intentionally opt-in.

## MCP

The repository includes `.mcp.json`:

```json
{
  "mcpServers": {
    "bear": {
      "command": "node",
      "args": ["./bin/bear-mcp.mjs"]
    }
  }
}
```

Tools exposed by the server:

- `bear_search`
- `bear_recent`
- `bear_read`
- `bear_create`
- `bear_update`
- `bear_open`

## Codex Plugin

The repo includes `.codex-plugin/plugin.json` and `skills/bear-connector/SKILL.md` so it can be installed as a Codex plugin or adapted into a local marketplace entry.

## Database Path

By default, the connector reads:

```text
~/Library/Group Containers/9K33E3U3T4.net.shinyfrog.bear/Application Data/database.sqlite
```

Override it with either:

```bash
BEAR_DATABASE=/path/to/database.sqlite bear-connector recent
bear-connector recent --database /path/to/database.sqlite
```

If Bear's group container is in a nonstandard location, pass `--container /path/to/9K33E3U3T4.net.shinyfrog.bear` or set `BEAR_CONTAINER`.

## Privacy

Reads are local. The connector shells out to `sqlite3 -readonly` against your local Bear database. Writes are performed by Bear itself through Bear's x-callback-url API.

Write commands put the note body on your macOS clipboard. This is intentional, because it avoids URL length limits for long drafts.

Attachment reads return local filesystem paths unless `--attachments base64` is used.

## Read Strategy

Single-note reads prefer Bear's `open-note` x-callback-url action by default, so they do not touch Bear's SQLite database:

```bash
bear-connector read --id NOTE_ID
```

SQLite reads remain available when you need direct database behavior:

```bash
bear-connector read --id NOTE_ID --source sqlite
```

SQLite calls use `sqlite3 -readonly`, set a short busy timeout, and the process itself has a timeout so agents fail quickly instead of hanging on a locked database.

Search can also use Bear's x-callback API when a Bear API token is available:

```bash
BEAR_TOKEN=... bear-connector search --query "Coffee"
```

Without a token, search falls back to SQLite.

## Limitations

- This is macOS-only.
- Encrypted and permanently deleted notes are excluded from reads.
- Bear database internals are not a public stable API. The connector uses the current Bear 2 database shape and includes tests around that schema, but Bear could change it in a future release.
- The MCP server is intentionally small and dependency-free. If a host requires a newer MCP transport behavior, the CLI remains the stable fallback.

## Development

```bash
npm test
npm run check
```

## License

MIT
