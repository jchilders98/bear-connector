#!/usr/bin/env node
import {
  createNote,
  openNote,
  readNote,
  recentNotes,
  searchNotes,
  updateNote,
} from '../src/bear.js'

const tools = [
  {
    name: 'bear_search',
    description: 'Search local Bear notes by title, subtitle, or body text.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        tag: { type: 'string' },
        limit: { type: 'number' },
        database: { type: 'string' },
        source: { enum: ['xcallback', 'sqlite'] },
        allowSqliteFallback: { type: 'boolean' },
        token: { type: 'string' },
        includeTrashed: { type: 'boolean' },
      },
      required: ['query'],
    },
  },
  {
    name: 'bear_recent',
    description: 'List recently modified local Bear notes.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number' },
        database: { type: 'string' },
        source: { enum: ['sqlite'] },
        includeTrashed: { type: 'boolean' },
      },
    },
  },
  {
    name: 'bear_read',
    description: 'Read a local Bear note by id or exact title.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        database: { type: 'string' },
        container: { type: 'string' },
        source: { enum: ['xcallback', 'sqlite'] },
        allowSqliteFallback: { type: 'boolean' },
        includeTrashed: { type: 'boolean' },
        attachments: { enum: ['metadata', 'base64'] },
      },
    },
  },
  {
    name: 'bear_create',
    description: 'Create a Bear note through Bear x-callback-url.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        text: { type: 'string' },
        tags: { type: 'string' },
        dryRun: { type: 'boolean' },
      },
      required: ['title', 'text'],
    },
  },
  {
    name: 'bear_update',
    description: 'Replace, append, or prepend text in a Bear note through Bear x-callback-url.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        text: { type: 'string' },
        mode: { enum: ['append', 'prepend', 'replace', 'replace_all'] },
        tags: { type: 'string' },
        newLine: { type: 'boolean' },
        dryRun: { type: 'boolean' },
      },
      required: ['text'],
    },
  },
  {
    name: 'bear_open',
    description: 'Open a Bear note by id or title.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        dryRun: { type: 'boolean' },
      },
    },
  },
]

const handlers = {
  initialize: async () => ({
    protocolVersion: '2024-11-05',
    capabilities: { tools: {} },
    serverInfo: { name: 'bear-connector', version: '0.2.0' },
  }),
  'tools/list': async () => ({ tools }),
  'tools/call': async (params) => {
    const args = params.arguments || {}
    let result

    switch (params.name) {
      case 'bear_search':
        result = await searchNotes(args)
        break
      case 'bear_recent':
        result = await recentNotes(args)
        break
      case 'bear_read':
        result = await readNote(args)
        break
      case 'bear_create':
        result = await createNote(args)
        break
      case 'bear_update':
        result = await updateNote(args)
        break
      case 'bear_open':
        result = await openNote(args)
        break
      default:
        throw new Error(`Unknown tool: ${params.name}`)
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    }
  },
}

let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  input += chunk

  for (;;) {
    const newlineIndex = input.indexOf('\n')
    if (newlineIndex === -1) {
      break
    }

    const line = input.slice(0, newlineIndex).trim()
    input = input.slice(newlineIndex + 1)

    if (line) {
      void handleMessage(line)
    }
  }
})

async function handleMessage(line) {
  let message
  try {
    message = JSON.parse(line)
    const handler = handlers[message.method]
    if (!handler) {
      if (message.id !== undefined) {
        send({ id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } })
      }
      return
    }

    if (message.id === undefined) {
      await handler(message.params || {})
      return
    }

    const result = await handler(message.params || {})
    send({ id: message.id, result })
  } catch (error) {
    send({
      id: message?.id ?? null,
      error: {
        code: -32603,
        message: error instanceof Error ? error.message : String(error),
      },
    })
  }
}

function send(payload) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...payload })}\n`)
}
