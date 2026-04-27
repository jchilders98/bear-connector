#!/usr/bin/env node
import fs from 'node:fs/promises'
import {
  createNote,
  openNote,
  readNote,
  recentNotes,
  searchNotes,
  updateNote,
} from '../src/bear.js'

const help = `
Bear connector for local macOS drafting workflows.

Usage:
  bear-connector search --query "Coffee" [--tag "Drafts"] [--limit 10]
  bear-connector recent [--limit 10]
  bear-connector read --id NOTE_ID [--text-only] [--include-attachments]
  bear-connector read --title "Note title" [--text-only] [--attachments metadata|base64]
  bear-connector add --title "Title" --text-file draft.md [--tags "Coffee & Covid,drafts"]
  bear-connector edit --id NOTE_ID --text-file draft.md [--mode replace|replace_all]
  bear-connector append --id NOTE_ID --text "More text"
  bear-connector prepend --title "Title" --text-file intro.md
  bear-connector open --id NOTE_ID

Options:
  --database PATH       Override Bear database path.
  --container PATH      Override Bear group container path.
  --include-trashed     Include trashed notes in read/search/recent.
  --include-attachments Include attachment file paths and metadata on read.
  --attachments MODE    Attachment mode for read: metadata or base64.
  --json                Force JSON output for read.
  --dry-run             Print the Bear URL without opening Bear or changing clipboard.
`

async function main() {
  const [command, ...rawArgs] = process.argv.slice(2)
  const args = parseArgs(rawArgs)

  if (!command || args.help || args.h) {
    process.stdout.write(help.trimStart())
    return
  }

  switch (command) {
    case 'search':
      await printJson(searchNotes(toReadOptions(args)))
      break
    case 'recent':
      await printJson(recentNotes(toReadOptions(args)))
      break
    case 'read':
      await handleRead(args)
      break
    case 'add':
      await handleCreate(args)
      break
    case 'edit':
      await handleUpdate(args, args.mode || 'replace')
      break
    case 'append':
      await handleUpdate(args, 'append')
      break
    case 'prepend':
      await handleUpdate(args, 'prepend')
      break
    case 'open':
      await printJson(openNote(toWriteOptions(args)))
      break
    default:
      throw new Error(`Unknown command: ${command}`)
  }
}

async function handleRead(args) {
  const note = await readNote(toReadOptions(args))

  if (args['text-only'] && !args.json) {
    process.stdout.write(note.text || '')
    return
  }

  process.stdout.write(`${JSON.stringify(note, null, 2)}\n`)
}

async function handleCreate(args) {
  const result = await createNote({
    ...toWriteOptions(args),
    title: args.title,
    text: await resolveText(args),
  })
  await printJson(Promise.resolve(result))
}

async function handleUpdate(args, mode) {
  const result = await updateNote({
    ...toWriteOptions(args),
    id: args.id,
    title: args.title,
    mode,
    text: await resolveText(args),
    newLine: Boolean(args['new-line']),
  })
  await printJson(Promise.resolve(result))
}

function toReadOptions(args) {
  return {
    database: args.database,
    container: args.container,
    attachments: resolveAttachmentMode(args),
    includeTrashed: Boolean(args['include-trashed']),
    id: args.id,
    limit: args.limit,
    query: args.query,
    tag: args.tag,
    title: args.title,
  }
}

function resolveAttachmentMode(args) {
  if (args.attachments) {
    if (!['metadata', 'base64'].includes(args.attachments)) {
      throw new Error('--attachments must be metadata or base64')
    }

    return args.attachments
  }

  if (args['include-attachments']) {
    return 'metadata'
  }

  return undefined
}

function toWriteOptions(args) {
  return {
    dryRun: Boolean(args['dry-run']),
    id: args.id,
    openNote: args['open-note'],
    showWindow: args['show-window'],
    tags: args.tags,
    title: args.title,
  }
}

async function resolveText(args) {
  if (args['text-file']) {
    return fs.readFile(args['text-file'], 'utf8')
  }

  if (args.text !== undefined) {
    return args.text
  }

  throw new Error('--text or --text-file is required')
}

function parseArgs(rawArgs) {
  const args = {}

  for (let index = 0; index < rawArgs.length; index += 1) {
    const token = rawArgs[index]
    if (!token.startsWith('--')) {
      throw new Error(`Unexpected argument: ${token}`)
    }

    const name = token.slice(2)
    const next = rawArgs[index + 1]
    if (!next || next.startsWith('--')) {
      args[name] = true
      continue
    }

    args[name] = next
    index += 1
  }

  return args
}

async function printJson(valuePromise) {
  const value = await valuePromise
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
