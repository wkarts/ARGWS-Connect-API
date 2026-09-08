#!/usr/bin/env node
'use strict'

const crypto = require('crypto')
const fs = require('fs')
const { pipeline } = require('stream/promises')
const { Writable } = require('stream')

const MAGIC = Buffer.from('CONNECTAPI-BACKUP-V1\n', 'utf8')
const SALT_SIZE = 16
const IV_SIZE = 12
const TAG_SIZE = 16

function fail(message) {
  console.error(message)
  process.exit(1)
}

function resolveKey() {
  const key = String(process.env.AUTHENTICATION_API_KEY || '').trim()
  if (!key || key.startsWith('CHANGE_ME_') || key.length < 24) {
    fail('AUTHENTICATION_API_KEY ausente ou fraca; backup recusado.')
  }
  return key
}

function deriveKey(secret, salt) {
  return crypto.scryptSync(secret, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
}

async function encrypt(input, output) {
  const secret = resolveKey()
  const salt = crypto.randomBytes(SALT_SIZE)
  const iv = crypto.randomBytes(IV_SIZE)
  const key = deriveKey(secret, salt)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(MAGIC)

  const out = fs.createWriteStream(output, { mode: 0o600 })
  out.write(MAGIC)
  out.write(salt)
  out.write(iv)

  await pipeline(fs.createReadStream(input), cipher, out, { end: false })
  out.write(cipher.getAuthTag())
  await new Promise((resolve, reject) => {
    out.end(resolve)
    out.on('error', reject)
  })
}

function readEnvelope(file) {
  const stat = fs.statSync(file)
  const headerSize = MAGIC.length + SALT_SIZE + IV_SIZE
  if (stat.size <= headerSize + TAG_SIZE) fail('Backup inválido ou truncado.')

  const fd = fs.openSync(file, 'r')
  try {
    const header = Buffer.alloc(headerSize)
    fs.readSync(fd, header, 0, header.length, 0)
    const magic = header.subarray(0, MAGIC.length)
    if (!crypto.timingSafeEqual(magic, MAGIC)) fail('Arquivo não é um backup Connect|API suportado.')

    const salt = header.subarray(MAGIC.length, MAGIC.length + SALT_SIZE)
    const iv = header.subarray(MAGIC.length + SALT_SIZE)
    const tag = Buffer.alloc(TAG_SIZE)
    fs.readSync(fd, tag, 0, TAG_SIZE, stat.size - TAG_SIZE)
    return { stat, headerSize, salt, iv, tag }
  } finally {
    fs.closeSync(fd)
  }
}

async function decrypt(input, output) {
  const secret = resolveKey()
  const envelope = readEnvelope(input)
  const key = deriveKey(secret, envelope.salt)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, envelope.iv)
  decipher.setAAD(MAGIC)
  decipher.setAuthTag(envelope.tag)

  const source = fs.createReadStream(input, {
    start: envelope.headerSize,
    end: envelope.stat.size - TAG_SIZE - 1,
  })

  const destination = output
    ? fs.createWriteStream(output, { mode: 0o600 })
    : new Writable({ write(_chunk, _encoding, callback) { callback() } })

  try {
    await pipeline(source, decipher, destination)
  } catch (error) {
    if (output) {
      try { fs.unlinkSync(output) } catch {}
    }
    fail(`Backup não pôde ser autenticado/decriptado: ${error.message}`)
  }
}

async function main() {
  const [command, input, output] = process.argv.slice(2)
  if (!command || !input) {
    fail('Uso: connect-backup-crypto.cjs <encrypt|decrypt|verify> <input> [output]')
  }

  if (command === 'encrypt') {
    if (!output) fail('Informe o arquivo de saída.')
    await encrypt(input, output)
    return
  }
  if (command === 'decrypt') {
    if (!output) fail('Informe o arquivo de saída.')
    await decrypt(input, output)
    return
  }
  if (command === 'verify') {
    await decrypt(input, null)
    console.log('OK')
    return
  }
  fail(`Comando desconhecido: ${command}`)
}

main().catch((error) => fail(error?.stack || String(error)))
