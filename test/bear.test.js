import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import {
  buildBearUrl,
  readNote,
  recentNotes,
  searchNotes,
  updateNote,
} from '../src/bear.js'

const execFileAsync = promisify(execFile)

test('reads, searches, and lists notes from a Bear-shaped database', async () => {
  const { database } = await createFixtureDatabase()

  const recent = await recentNotes({ database, limit: 2, source: 'sqlite' })
  assert.equal(recent.length, 2)
  assert.equal(recent[0].title, 'Coffee Draft')
  assert.deepEqual(recent[0].tags, ['drafts'])

  const search = await searchNotes({ database, query: 'canary', limit: 5, source: 'sqlite' })
  assert.equal(search.length, 1)
  assert.equal(search[0].id, 'NOTE-1')

  const note = await readNote({ database, id: 'NOTE-1', source: 'sqlite' })
  assert.equal(note.title, 'Coffee Draft')
  assert.match(note.text, /coal mine/)
})

test('excludes trashed and encrypted notes by default', async () => {
  const { database } = await createFixtureDatabase()
  const search = await searchNotes({ database, query: 'hidden', limit: 10, source: 'sqlite' })

  assert.equal(search.length, 0)
})

test('optionally includes attachment metadata and base64 payloads', async () => {
  const { container, database } = await createFixtureDatabase()

  const metadataNote = await readNote({
    database,
    container,
    id: 'NOTE-1',
    source: 'sqlite',
    attachments: 'metadata',
  })

  assert.equal(metadataNote.attachments.length, 1)
  assert.equal(metadataNote.attachments[0].filename, 'image.png')
  assert.equal(metadataNote.attachments[0].mimeType, 'image/png')
  assert.equal(metadataNote.attachments[0].base64, undefined)

  const inlineNote = await readNote({
    database,
    container,
    id: 'NOTE-1',
    source: 'sqlite',
    attachments: 'base64',
  })

  assert.equal(inlineNote.attachments[0].base64, Buffer.from('fake png').toString('base64'))
  assert.match(inlineNote.attachments[0].dataUrl, /^data:image\/png;base64,/)
})

test('builds Bear update URLs without embedding body text', async () => {
  const result = await updateNote({
    id: 'NOTE-1',
    text: 'replacement body',
    mode: 'replace',
    dryRun: true,
  })

  assert.equal(result.dryRun, true)
  assert.equal(result.clipboardCharacterCount, 16)
  assert.equal(
    result.url,
    'bear://x-callback-url/add-text?clipboard=yes&mode=replace&open_note=no&show_window=no&exclude_trashed=yes&id=NOTE-1',
  )
})

test('encodes Bear URLs predictably', () => {
  const url = buildBearUrl('create', {
    title: 'Coffee & Covid',
    tags: 'drafts,C&C',
    clipboard: 'yes',
  })

  assert.equal(
    url,
    'bear://x-callback-url/create?title=Coffee+%26+Covid&tags=drafts%2CC%26C&clipboard=yes',
  )
})

async function createFixtureDatabase() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bear-connector-'))
  const database = path.join(directory, 'database.sqlite')
  const container = path.join(directory, 'container')
  const imageDirectory = path.join(
    container,
    'Application Data/Local Files/Note Images/FILE-1',
  )

  await execFileAsync('sqlite3', [database, fixtureSql()])
  await fs.mkdir(imageDirectory, { recursive: true })
  await fs.writeFile(path.join(imageDirectory, 'image.png'), 'fake png')
  return { container, database }
}

function fixtureSql() {
  return `
    CREATE TABLE ZSFNOTE (
      Z_PK INTEGER PRIMARY KEY,
      ZARCHIVED INTEGER,
      ZENCRYPTED INTEGER,
      ZPERMANENTLYDELETED INTEGER,
      ZPINNED INTEGER,
      ZTRASHED INTEGER,
      ZCREATIONDATE TIMESTAMP,
      ZMODIFICATIONDATE TIMESTAMP,
      ZSUBTITLE VARCHAR,
      ZTEXT VARCHAR,
      ZTITLE VARCHAR,
      ZUNIQUEIDENTIFIER VARCHAR
    );

    CREATE TABLE ZSFNOTETAG (
      Z_PK INTEGER PRIMARY KEY,
      ZTITLE VARCHAR
    );

    CREATE TABLE Z_5TAGS (
      Z_5NOTES INTEGER,
      Z_13TAGS INTEGER,
      PRIMARY KEY (Z_5NOTES, Z_13TAGS)
    );

    CREATE TABLE ZSFNOTEFILE (
      Z_PK INTEGER PRIMARY KEY,
      ZNOTE INTEGER,
      ZENCRYPTED INTEGER,
      ZPERMANENTLYDELETED INTEGER,
      ZINDEX INTEGER,
      ZFILESIZE INTEGER,
      ZWIDTH INTEGER,
      ZHEIGHT INTEGER,
      ZFILENAME VARCHAR,
      ZNORMALIZEDFILEEXTENSION VARCHAR,
      ZUNIQUEIDENTIFIER VARCHAR
    );

    INSERT INTO ZSFNOTE VALUES (
      1, 0, 0, 0, 0, 0, 799286400, 799290000,
      'A canary in the coal mine',
      'Full Coffee Draft body about a canary and the coal mine.',
      'Coffee Draft',
      'NOTE-1'
    );

    INSERT INTO ZSFNOTE VALUES (
      2, 0, 0, 0, 0, 0, 799200000, 799280000,
      'Older note',
      'Ordinary visible note.',
      'Older Draft',
      'NOTE-2'
    );

    INSERT INTO ZSFNOTE VALUES (
      3, 0, 0, 0, 0, 1, 799200000, 799300000,
      'hidden trashed',
      'hidden trashed text',
      'Trashed Draft',
      'NOTE-3'
    );

    INSERT INTO ZSFNOTE VALUES (
      4, 0, 1, 0, 0, 0, 799200000, 799300000,
      'hidden encrypted',
      'hidden encrypted text',
      'Encrypted Draft',
      'NOTE-4'
    );

    INSERT INTO ZSFNOTETAG VALUES (1, 'drafts');
    INSERT INTO Z_5TAGS VALUES (1, 1);
    INSERT INTO ZSFNOTEFILE VALUES (1, 1, 0, 0, 0, 8, 100, 80, 'image.png', 'png', 'FILE-1');
  `
}
