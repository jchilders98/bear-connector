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
  const database = await createFixtureDatabase()

  const recent = await recentNotes({ database, limit: 2 })
  assert.equal(recent.length, 2)
  assert.equal(recent[0].title, 'Coffee Draft')
  assert.deepEqual(recent[0].tags, ['drafts'])

  const search = await searchNotes({ database, query: 'canary', limit: 5 })
  assert.equal(search.length, 1)
  assert.equal(search[0].id, 'NOTE-1')

  const note = await readNote({ database, id: 'NOTE-1' })
  assert.equal(note.title, 'Coffee Draft')
  assert.match(note.text, /coal mine/)
})

test('excludes trashed and encrypted notes by default', async () => {
  const database = await createFixtureDatabase()
  const search = await searchNotes({ database, query: 'hidden', limit: 10 })

  assert.equal(search.length, 0)
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

  await execFileAsync('sqlite3', [database, fixtureSql()])
  return database
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
  `
}
