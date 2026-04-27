import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const DEFAULT_BEAR_DATABASE = path.join(
  os.homedir(),
  'Library/Group Containers/9K33E3U3T4.net.shinyfrog.bear/Application Data/database.sqlite',
)

export function resolveDatabasePath(databasePath) {
  return databasePath || process.env.BEAR_DATABASE || DEFAULT_BEAR_DATABASE
}

export async function searchNotes(options = {}) {
  const query = required(options.query, 'query is required')
  const databasePath = resolveDatabasePath(options.database)
  const limit = parseLimit(options.limit, 20)
  const tagFilter = options.tag ? `AND n.Z_PK IN (
    SELECT nt.Z_5NOTES
    FROM Z_5TAGS nt
    JOIN ZSFNOTETAG t ON t.Z_PK = nt.Z_13TAGS
    WHERE t.ZTITLE LIKE ${sqlLike(options.tag)}
  )` : ''

  return runJsonQuery(databasePath, `
    ${baseNoteSelect(false)}
    WHERE ${activeWhere(Boolean(options.includeTrashed))}
      AND (
        n.ZTITLE LIKE ${sqlLike(query)}
        OR n.ZSUBTITLE LIKE ${sqlLike(query)}
        OR n.ZTEXT LIKE ${sqlLike(query)}
      )
      ${tagFilter}
    GROUP BY n.Z_PK
    ORDER BY n.ZMODIFICATIONDATE DESC
    LIMIT ${limit};
  `)
}

export async function recentNotes(options = {}) {
  const databasePath = resolveDatabasePath(options.database)
  const limit = parseLimit(options.limit, 10)

  return runJsonQuery(databasePath, `
    ${baseNoteSelect(false)}
    WHERE ${activeWhere(Boolean(options.includeTrashed))}
    GROUP BY n.Z_PK
    ORDER BY n.ZMODIFICATIONDATE DESC
    LIMIT ${limit};
  `)
}

export async function readNote(options = {}) {
  const databasePath = resolveDatabasePath(options.database)
  const rows = await runJsonQuery(databasePath, `
    ${baseNoteSelect(true)}
    WHERE ${activeWhere(Boolean(options.includeTrashed))}
      AND ${resolveNoteWhere(options)}
    GROUP BY n.Z_PK
    ORDER BY n.ZMODIFICATIONDATE DESC
    LIMIT 1;
  `)

  if (rows.length === 0) {
    throw new Error('No matching Bear note found.')
  }

  return rows[0]
}

export async function createNote(options = {}) {
  const title = required(options.title, 'title is required')
  const text = required(options.text, 'text is required')
  const params = {
    title,
    clipboard: 'yes',
    open_note: options.openNote || 'no',
    show_window: options.showWindow || 'no',
  }

  if (options.tags) {
    params.tags = Array.isArray(options.tags) ? options.tags.join(',') : options.tags
  }

  return writeThroughBear('create', params, text, Boolean(options.dryRun))
}

export async function updateNote(options = {}) {
  const mode = options.mode || 'replace'
  if (!['append', 'prepend', 'replace', 'replace_all'].includes(mode)) {
    throw new Error('mode must be one of append, prepend, replace, replace_all')
  }

  const text = required(options.text, 'text is required')
  const params = {
    clipboard: 'yes',
    mode,
    open_note: options.openNote || 'no',
    show_window: options.showWindow || 'no',
    exclude_trashed: 'yes',
  }

  if (options.id) {
    params.id = options.id
  } else if (options.title) {
    params.title = options.title
  } else {
    throw new Error('id or title is required')
  }

  if (options.tags) {
    params.tags = Array.isArray(options.tags) ? options.tags.join(',') : options.tags
  }

  if (options.newLine) {
    params.new_line = 'yes'
  }

  return writeThroughBear('add-text', params, text, Boolean(options.dryRun))
}

export async function openNote(options = {}) {
  const params = {
    show_window: options.showWindow || 'yes',
    open_note: 'yes',
  }

  if (options.id) {
    params.id = options.id
  } else if (options.title) {
    params.title = options.title
  } else {
    throw new Error('id or title is required')
  }

  return openBearAction('open-note', params, Boolean(options.dryRun))
}

async function runJsonQuery(databasePath, sql) {
  await fs.access(databasePath)
  const { stdout } = await execFileAsync('sqlite3', ['-readonly', '-json', databasePath, sql], {
    maxBuffer: 1024 * 1024 * 64,
  })

  if (!stdout.trim()) {
    return []
  }

  const rows = JSON.parse(stdout)
  return rows.map((row) => ({
    ...row,
    tags: typeof row.tags === 'string' ? JSON.parse(row.tags) : row.tags,
  }))
}

async function writeThroughBear(action, params, text, dryRun) {
  const url = buildBearUrl(action, params)

  if (dryRun) {
    return {
      dryRun: true,
      url,
      clipboardCharacterCount: text.length,
    }
  }

  await writeClipboard(text)
  await execFileAsync('open', [url])
  return {
    dryRun: false,
    url,
    clipboardCharacterCount: text.length,
  }
}

async function openBearAction(action, params, dryRun) {
  const url = buildBearUrl(action, params)

  if (!dryRun) {
    await execFileAsync('open', [url])
  }

  return { dryRun, url }
}

export function buildBearUrl(action, params) {
  const url = new URL(`bear://x-callback-url/${action}`)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value))
    }
  }

  return url.toString()
}

async function writeClipboard(text) {
  const { spawn } = await import('node:child_process')

  await new Promise((resolve, reject) => {
    const child = spawn('pbcopy')

    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(`pbcopy exited with status ${code}`))
    })

    child.stdin.end(text)
  })
}

function baseNoteSelect(includeText) {
  const textColumn = includeText ? ', n.ZTEXT AS text' : ''

  return `
    SELECT
      n.ZUNIQUEIDENTIFIER AS id,
      n.ZTITLE AS title,
      n.ZSUBTITLE AS subtitle,
      datetime(n.ZCREATIONDATE + 978307200, 'unixepoch') AS createdAt,
      datetime(n.ZMODIFICATIONDATE + 978307200, 'unixepoch') AS modifiedAt,
      n.ZPINNED AS pinned,
      n.ZARCHIVED AS archived,
      n.ZTRASHED AS trashed,
      length(n.ZTEXT) AS characterCount,
      COALESCE(json_group_array(t.ZTITLE) FILTER (WHERE t.ZTITLE IS NOT NULL), json('[]')) AS tags
      ${textColumn}
    FROM ZSFNOTE n
    LEFT JOIN Z_5TAGS nt ON nt.Z_5NOTES = n.Z_PK
    LEFT JOIN ZSFNOTETAG t ON t.Z_PK = nt.Z_13TAGS
  `
}

function activeWhere(includeTrashed) {
  const trashClause = includeTrashed ? '1 = 1' : 'n.ZTRASHED = 0'
  return `${trashClause} AND n.ZPERMANENTLYDELETED = 0 AND n.ZENCRYPTED = 0`
}

function resolveNoteWhere(options) {
  if (options.id) {
    return `n.ZUNIQUEIDENTIFIER = ${sqlString(options.id)}`
  }

  if (options.title) {
    return `n.ZTITLE = ${sqlString(options.title)}`
  }

  throw new Error('id or title is required')
}

function parseLimit(value, fallback) {
  const parsed = value === undefined ? fallback : Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 200) {
    throw new Error('limit must be an integer from 1 to 200')
  }

  return parsed
}

function required(value, message) {
  if (value === undefined || value === '') {
    throw new Error(message)
  }

  return value
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

function sqlLike(value) {
  const escaped = String(value).replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
  return `${sqlString(`%${escaped}%`)} ESCAPE '\\'`
}
