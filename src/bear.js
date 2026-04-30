import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const DEFAULT_BEAR_DATABASE = path.join(
  os.homedir(),
  'Library/Group Containers/9K33E3U3T4.net.shinyfrog.bear/Application Data/database.sqlite',
)

export const DEFAULT_BEAR_CONTAINER = path.join(
  os.homedir(),
  'Library/Group Containers/9K33E3U3T4.net.shinyfrog.bear',
)

export function resolveDatabasePath(databasePath) {
  return databasePath || process.env.BEAR_DATABASE || DEFAULT_BEAR_DATABASE
}

export function resolveContainerPath(containerPath) {
  return containerPath || process.env.BEAR_CONTAINER || DEFAULT_BEAR_CONTAINER
}

export async function searchNotes(options = {}) {
  if (preferCallback(options) && resolveBearToken(options.token)) {
    return searchNotesViaCallback(options)
  }

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
  if (preferCallback(options)) {
    try {
      return await readNoteViaCallback(options)
    } catch (error) {
      if (!options.allowSqliteFallback) {
        throw error
      }
    }
  }

  const databasePath = resolveDatabasePath(options.database)
  const rows = await runJsonQuery(databasePath, `
    ${baseNoteSelect(true, true)}
    WHERE ${activeWhere(Boolean(options.includeTrashed))}
      AND ${resolveNoteWhere(options)}
    GROUP BY n.Z_PK
    ORDER BY n.ZMODIFICATIONDATE DESC
    LIMIT 1;
  `)

  if (rows.length === 0) {
    throw new Error('No matching Bear note found.')
  }

  const note = rows[0]
  if (options.attachments) {
    note.attachments = await readNoteAttachments({
      database: databasePath,
      container: options.container,
      notePrimaryKey: note.primaryKey,
      mode: options.attachments,
    })
  }

  delete note.primaryKey
  return note
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

  return writeThroughBear('create', params, text, options)
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

  return writeThroughBear('add-text', params, text, options)
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

  return openBearAction('open-note', params, options)
}

async function runJsonQuery(databasePath, sql) {
  await fs.access(databasePath)
  const timeoutMs = Number(process.env.BEAR_SQLITE_TIMEOUT_MS || 2500)
  const { stdout } = await execFileAsync('sqlite3', ['-readonly', '-cmd', `.timeout ${timeoutMs}`, '-json', databasePath, sql], {
    maxBuffer: 1024 * 1024 * 64,
    timeout: timeoutMs + 1000,
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

async function writeThroughBear(action, params, text, options) {
  const url = buildBearUrl(action, params)

  if (options.dryRun) {
    return {
      dryRun: true,
      url,
      clipboardCharacterCount: text.length,
    }
  }

  await writeClipboard(text)
  const callback = await openBearAction(action, params, options)
  return {
    dryRun: false,
    ...callback,
    clipboardCharacterCount: text.length,
  }
}

async function openBearAction(action, params, options = {}) {
  const url = buildBearUrl(action, params)

  if (options.dryRun) {
    return { dryRun: true, url }
  }

  return callBearAction(action, params, {
    timeoutMs: options.callbackTimeoutMs,
  })
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

async function callBearAction(action, params, options = {}) {
  const timeoutMs = Number(options.timeoutMs || process.env.BEAR_CALLBACK_TIMEOUT_MS || 30000)
  const callbackId = Math.random().toString(36).slice(2)

  return new Promise((resolve, reject) => {
    let settled = false
    const server = http.createServer({ maxHeaderSize: 1024 * 1024 * 64 }, (request, response) => {
      const requestUrl = new URL(request.url || '/', 'http://127.0.0.1')
      const payload = Object.fromEntries(requestUrl.searchParams.entries())
      response.shouldKeepAlive = false
      response.writeHead(200, { 'content-type': 'text/plain', connection: 'close' })
      response.end('ok', () => request.socket.destroy())

      if (!requestUrl.pathname.endsWith(callbackId)) {
        return
      }

      finish(() => {
        if (requestUrl.pathname.startsWith('/error/')) {
          reject(new Error(payload.errorMessage || payload.errorCode || 'Bear x-callback-url error'))
          return
        }

        resolve({
          dryRun: false,
          url: actionUrl,
          callback: payload,
        })
      })
    })

    const timer = setTimeout(() => {
      finish(() => reject(new Error(`Timed out waiting ${timeoutMs}ms for Bear x-callback-url response.`)))
    }, timeoutMs)

    let actionUrl = ''

    function finish(callback) {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timer)
      server.close()
      server.closeAllConnections?.()
      callback()
    }

    server.listen(0, '127.0.0.1', async () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      const callbackBase = `http://127.0.0.1:${port}`
      actionUrl = buildBearUrl(action, {
        ...params,
        'x-success': `${callbackBase}/success/${callbackId}`,
        'x-error': `${callbackBase}/error/${callbackId}`,
      })

      try {
        await execFileAsync('open', [actionUrl])
      } catch (error) {
        finish(() => reject(error))
      }
    })
  })
}

async function readNoteViaCallback(options) {
  const params = {
    exclude_trashed: options.includeTrashed ? 'no' : 'yes',
    open_note: options.openNote || 'no',
    show_window: options.showWindow || 'no',
  }

  if (options.id) {
    params.id = options.id
  } else if (options.title) {
    params.title = options.title
  } else {
    throw new Error('id or title is required')
  }

  const result = await callBearAction('open-note', params, {
    timeoutMs: options.callbackTimeoutMs,
  })
  const callback = result.callback || {}
  const note = {
    id: callback.identifier,
    title: callback.title,
    text: callback.note || '',
    tags: parseCallbackJson(callback.tags, []),
    trashed: callback.is_trashed === 'yes' ? 1 : 0,
    modifiedAt: callback.modificationDate,
    createdAt: callback.creationDate,
    source: 'x-callback-url',
  }

  note.characterCount = note.text.length

  if (options.attachments) {
    const databasePath = resolveDatabasePath(options.database)
    const notePrimaryKey = await getNotePrimaryKey(databasePath, note.id)
    note.attachments = await readNoteAttachments({
      database: databasePath,
      container: options.container,
      notePrimaryKey,
      mode: options.attachments,
    })
  }

  return note
}

async function searchNotesViaCallback(options) {
  const query = required(options.query, 'query is required')
  const result = await callBearAction('search', {
    term: query,
    tag: options.tag,
    token: resolveBearToken(options.token),
    show_window: options.showWindow || 'no',
  }, {
    timeoutMs: options.callbackTimeoutMs,
  })

  const notes = parseCallbackJson(result.callback?.notes, [])
  return notes.slice(0, parseLimit(options.limit, 20)).map((note) => ({
    id: note.identifier,
    title: note.title,
    tags: note.tags || note.tag || [],
    modifiedAt: note.modificationDate,
    createdAt: note.creationDate,
    pinned: note.pin ? 1 : 0,
    source: 'x-callback-url',
  }))
}

async function getNotePrimaryKey(databasePath, noteId) {
  const rows = await runJsonQuery(databasePath, `
    SELECT Z_PK AS primaryKey
    FROM ZSFNOTE
    WHERE ZUNIQUEIDENTIFIER = ${sqlString(noteId)}
    LIMIT 1;
  `)

  if (!rows[0]) {
    throw new Error(`Unable to resolve Bear note primary key for attachments: ${noteId}`)
  }

  return rows[0].primaryKey
}

function preferCallback(options) {
  return (options.source || process.env.BEAR_READ_SOURCE || 'xcallback') !== 'sqlite'
}

function resolveBearToken(token) {
  return token || process.env.BEAR_TOKEN || process.env.BEAR_API_TOKEN
}

function parseCallbackJson(value, fallback) {
  if (!value) {
    return fallback
  }

  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
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

function baseNoteSelect(includeText, includePrimaryKey = false) {
  const textColumn = includeText ? ', n.ZTEXT AS text' : ''
  const primaryKeyColumn = includePrimaryKey ? 'n.Z_PK AS primaryKey,' : ''

  return `
    SELECT
      ${primaryKeyColumn}
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

async function readNoteAttachments(options) {
  const rows = await runJsonQuery(options.database, `
    SELECT
      ZUNIQUEIDENTIFIER AS id,
      ZFILENAME AS filename,
      ZNORMALIZEDFILEEXTENSION AS extension,
      ZWIDTH AS width,
      ZHEIGHT AS height,
      ZFILESIZE AS size,
      ZINDEX AS position
    FROM ZSFNOTEFILE
    WHERE ZNOTE = ${Number(options.notePrimaryKey)}
      AND ZPERMANENTLYDELETED = 0
      AND ZENCRYPTED = 0
    ORDER BY ZINDEX ASC, Z_PK ASC;
  `)

  const includeBase64 = options.mode === 'base64'
  const imagesDirectory = path.join(
    resolveContainerPath(options.container),
    'Application Data/Local Files/Note Images',
  )

  return Promise.all(rows.map(async (row) => {
    const filePath = path.join(imagesDirectory, row.id, row.filename)
    const attachment = {
      ...row,
      path: filePath,
      mimeType: mimeTypeForExtension(row.extension),
    }

    if (includeBase64) {
      const fileBuffer = await fs.readFile(filePath)
      attachment.base64 = fileBuffer.toString('base64')
      attachment.dataUrl = `data:${attachment.mimeType};base64,${attachment.base64}`
    }

    return attachment
  }))
}

function mimeTypeForExtension(extension) {
  switch (String(extension || '').toLowerCase()) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'gif':
      return 'image/gif'
    case 'webp':
      return 'image/webp'
    case 'tif':
    case 'tiff':
      return 'image/tiff'
    case 'png':
    default:
      return 'image/png'
  }
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
