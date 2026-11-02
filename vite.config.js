import { defineConfig } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const DADOS_DIR = path.resolve(process.cwd(), 'dados');
const RESERVATIONS_FILE = path.resolve(DADOS_DIR, 'reservas_protocolos.json');
const COUNTER_FILE = path.resolve(DADOS_DIR, 'protocolo_contador.json');
const PROTOCOL_LOCK_FILE = path.resolve(DADOS_DIR, 'protocolo.lock');
const RESERVATION_TTL_MS = 10 * 60 * 1000; // 10 minutos de inatividade conforme decisão do usuário
const LOCK_TTL_MS = 15 * 1000; // 15 segundos máximo para trava de arquivo de protocolo
const SYSTEM_MASTER_SECRET = 'SIGESP_ENTERPRISE_SYSTEM_SECRET_KEY_v1_SECURE_2026';
const serverWriteQueues = new Map();

// Caches em memória no servidor para evitar PBKDF2 síncrono repetitivo
const serverDerivedKeyCache = new Map();
const serverDecryptedLineCache = new Map();
let ocorrenciasProtocolCache = {
  mtimeMs: -1,
  size: -1,
  byYear: new Map()
};
let lastOccurrenceMutationMs = 0;

function isIndividualOccurrenceFile(fileName) {
  return /^ocorrencia_.+\.csv$/i.test(String(fileName || '').trim());
}

function invalidateOcorrenciasProtocolCache() {
  lastOccurrenceMutationMs = Date.now();
  ocorrenciasProtocolCache = { mtimeMs: -1, size: -1, byYear: new Map() };
}

async function listIndividualOccurrenceFiles() {
  await fs.mkdir(DADOS_DIR, { recursive: true });
  const entries = await fs.readdir(DADOS_DIR, { withFileTypes: true });
  const occEntries = entries.filter(e => e.isFile() && isIndividualOccurrenceFile(e.name));
  occEntries.sort((a, b) => a.name.localeCompare(b.name, 'en'));
  const files = [];
  let totalSize = 0;
  let maxMtimeMs = lastOccurrenceMutationMs;
  const chunkSize = 64;
  for (let i = 0; i < occEntries.length; i += chunkSize) {
    const slice = occEntries.slice(i, i + chunkSize);
    const stats = await Promise.all(
      slice.map(async entry => {
        const fullPath = path.join(DADOS_DIR, entry.name);
        try {
          const st = await fs.stat(fullPath);
          if (st.size > 0) {
            return { name: entry.name, path: fullPath, size: st.size, mtimeMs: st.mtimeMs };
          }
        } catch {}
        return null;
      })
    );
    for (const st of stats) {
      if (st) {
        files.push(st);
        totalSize += st.size;
        if (st.mtimeMs > maxMtimeMs) maxMtimeMs = st.mtimeMs;
      }
    }
  }
  const sig = `${files.length}:${totalSize}:${Math.round(maxMtimeMs)}`;
  return { files, count: files.length, totalSize, maxMtimeMs, sig };
}

function withServerFileLock(targetPath, operation) {
  const key = path.normalize(targetPath);
  const previous = serverWriteQueues.get(key) || Promise.resolve();
  const current = previous
    .catch(() => {})
    .then(() => operation());
  serverWriteQueues.set(key, current);
  return current.finally(() => {
    if (serverWriteQueues.get(key) === current) {
      serverWriteQueues.delete(key);
    }
  });
}

function logProtocolStep(traceEnabled, step, details = {}) {
  if (!traceEnabled && process.env.SIGESP_PROTOCOL_TRACE !== '1') return;
  console.log(`[PROTOCOLO] ${step}`, details);
}

function logProtocolError(step, error, details = {}) {
  console.error(`[PROTOCOLO:ERRO] ${step}`, {
    erro: error?.message || String(error),
    ...details
  });
}

function normalizeReservationItem(r, now = Date.now(), usedInFile = null) {
  if (!r || typeof r !== 'object') return null;
  const proto = String(r.numeroProtocolo || r.protocolo || '').trim().toUpperCase();
  const seqMatch = /^OC-(\d{4})-(\d+)$/i.exec(proto);
  const year = Number(r.year || (seqMatch ? parseInt(seqMatch[1], 10) : new Date().getFullYear()));
  const seq = Number(r.id_sequencial || (seqMatch ? parseInt(seqMatch[2], 10) : 0));
  const resId = String(r.reservationId || r.id_reserva || crypto.randomUUID()).trim();
  const sessId = String(r.sessionId || r.clientId || r.sessao || resId).trim();
  const user = String(r.usuario || r.user || 'Sistema').trim();
  const createdAt = Number(r.createdAt || (r.dataHoraReserva ? Date.parse(r.dataHoraReserva) : (r.data_hora ? Date.parse(r.data_hora) : now))) || now;
  const isoCreated = r.dataHoraReserva || r.data_hora || new Date(createdAt).toISOString();
  const rawStatus = String(r.status || 'RESERVADO').trim().toUpperCase();
  const inFile = Boolean(usedInFile && seq > 0 && usedInFile.has(seq));
  const isUtilized = inFile || rawStatus === 'UTILIZADO' || rawStatus === 'CONFIRMADO' || r.confirmado === true;
  const expiresAt = Number(r.expiresAt || (createdAt + RESERVATION_TTL_MS));

  let finalStatus = 'RESERVADO';
  if (isUtilized) {
    finalStatus = 'UTILIZADO';
  } else if (rawStatus === 'CANCELADO' || rawStatus === 'LIBERADO') {
    finalStatus = 'CANCELADO';
  } else if (expiresAt <= now || rawStatus === 'EXPIRADO') {
    finalStatus = 'EXPIRADO';
  }

  const utilizedIso = isUtilized
    ? (r.dataHoraUtilizacao || r.confirmedAt || new Date(now).toISOString())
    : null;

  return {
    id_reserva: resId,
    reservationId: resId,
    numeroProtocolo: proto,
    protocolo: proto,
    id_sequencial: seq,
    usuario: user,
    user,
    sessionId: sessId,
    clientId: sessId,
    sessao: sessId,
    id_interno: r.id_interno || null,
    unit: String(r.unit || ''),
    year,
    dataHoraReserva: isoCreated,
    data_hora: isoCreated,
    createdAt,
    expiresAt,
    status: finalStatus,
    confirmado: isUtilized,
    dataHoraUtilizacao: utilizedIso,
    confirmedAt: utilizedIso
  };
}

async function acquireSharedProtocolFileLock(owner = 'Sistema', clientId = '', traceEnabled = false) {
  await fs.mkdir(DADOS_DIR, { recursive: true });
  const lockId = crypto.randomUUID();
  const maxAttempts = 80;
  const tLock0 = performance.now();
  logProtocolStep(traceEnabled, 'tentando adquirir lock', { lockId, usuario: owner, sessionId: clientId });

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const now = Date.now();
    const lockPayload = JSON.stringify({
      lockId,
      pid: process.pid,
      owner,
      sessionId: clientId,
      clientId,
      createdAt: now,
      expiresAt: now + LOCK_TTL_MS,
      state: 'ACTIVE'
    });

    try {
      const handle = await fs.open(PROTOCOL_LOCK_FILE, 'wx');
      try {
        await handle.writeFile(lockPayload, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      logProtocolStep(traceEnabled, 'lock adquirido', {
        lockId,
        usuario: owner,
        sessionId: clientId,
        tentativas: attempt + 1,
        tempoMs: +(performance.now() - tLock0).toFixed(2)
      });
      return lockId;
    } catch (err) {
      if (err && err.code === 'EEXIST') {
        try {
          const rawLock = await fs.readFile(PROTOCOL_LOCK_FILE, 'utf8');
          const parsedLock = JSON.parse(rawLock);
          const isExpired = parsedLock && typeof parsedLock.expiresAt === 'number' && Date.now() > parsedLock.expiresAt;
          if (isExpired) {
            let reservationMtime = 0;
            try {
              const rStat = await fs.stat(RESERVATIONS_FILE);
              reservationMtime = rStat.mtimeMs;
            } catch {}
            if (Date.now() - reservationMtime > 1000) {
              await fs.rm(PROTOCOL_LOCK_FILE, { force: true });
              continue;
            }
          }
        } catch {
          try {
            const lStat = await fs.stat(PROTOCOL_LOCK_FILE);
            if (Date.now() - lStat.mtimeMs > 2000) {
              await fs.rm(PROTOCOL_LOCK_FILE, { force: true });
              continue;
            }
          } catch {}
        }
        await new Promise(r => setTimeout(r, 15 + Math.random() * 25));
        continue;
      }
      throw err;
    }
  }
  const lockErr = new Error('Não foi possível obter acesso exclusivo ao controle de protocolos.');
  logProtocolError('acquireSharedProtocolFileLock', lockErr, { owner, clientId });
  throw lockErr;
}

async function releaseSharedProtocolFileLock(lockId, traceEnabled = false) {
  if (!lockId) return;
  try {
    const rawLock = await fs.readFile(PROTOCOL_LOCK_FILE, 'utf8');
    const parsedLock = JSON.parse(rawLock);
    if (!parsedLock || parsedLock.lockId === lockId) {
      await fs.rm(PROTOCOL_LOCK_FILE, { force: true });
    }
  } catch {
    try {
      await fs.rm(PROTOCOL_LOCK_FILE, { force: true });
    } catch {}
  }
  logProtocolStep(traceEnabled, 'lock liberado', { lockId });
}

async function withProtocolControlLock(owner, clientId, operation, traceEnabled = false) {
  return await withServerFileLock(RESERVATIONS_FILE, async () => {
    const lockId = await acquireSharedProtocolFileLock(owner, clientId, traceEnabled);
    try {
      return await operation(lockId);
    } finally {
      await releaseSharedProtocolFileLock(lockId, traceEnabled);
    }
  });
}

async function readAllReservationsRaw(usedInFile = null, yearFilter = null) {
  try {
    const raw = await fs.readFile(RESERVATIONS_FILE, 'utf8');
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    const now = Date.now();
    const cleaned = [];
    for (const item of list) {
      const r = normalizeReservationItem(
        item,
        now,
        (!yearFilter || Number(item?.year) === yearFilter) ? usedInFile : null
      );
      if (!r || !r.protocolo || r.id_sequencial <= 0) continue;
      if (r.status === 'UTILIZADO' || r.status === 'CONFIRMADO') {
        cleaned.push(r);
      } else if (r.status === 'RESERVADO' && r.expiresAt > now) {
        cleaned.push(r);
      } else if (r.createdAt && now - r.createdAt < 30 * 60 * 1000) {
        cleaned.push(r);
      }
    }
    return cleaned;
  } catch {
    return [];
  }
}

async function readReservations() {
  const all = await readAllReservationsRaw();
  const now = Date.now();
  return all.filter(r => r.status === 'RESERVADO' && r.expiresAt > now);
}

async function writeReservations(list) {
  await fs.mkdir(DADOS_DIR, { recursive: true });
  const payload = Buffer.from(JSON.stringify(list, null, 2), 'utf8');
  await atomicWriteFile(RESERVATIONS_FILE, payload);
  const verifyRaw = await fs.readFile(RESERVATIONS_FILE, 'utf8');
  const verifyParsed = JSON.parse(verifyRaw);
  if (!Array.isArray(verifyParsed)) {
    throw new Error('Falha na confirmação de persistência das reservas de protocolo.');
  }
  return verifyParsed;
}

function deriveServerKey(saltB64) {
  if (serverDerivedKeyCache.has(saltB64)) {
    return serverDerivedKeyCache.get(saltB64);
  }
  const salt = Buffer.from(saltB64, 'base64');
  const key = crypto.pbkdf2Sync(SYSTEM_MASTER_SECRET, salt, 100000, 32, 'sha256');
  if (serverDerivedKeyCache.size >= 128) {
    const oldest = serverDerivedKeyCache.keys().next().value;
    if (oldest !== undefined) serverDerivedKeyCache.delete(oldest);
  }
  serverDerivedKeyCache.set(saltB64, key);
  return key;
}

function decryptSingleEnvelope(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed.startsWith('SIGESP_ENC_v1:')) return '';
  const canCacheLine = trimmed.length <= 16384;
  if (canCacheLine && serverDecryptedLineCache.has(trimmed)) {
    return serverDecryptedLineCache.get(trimmed);
  }
  try {
    const jsonStr = trimmed.slice('SIGESP_ENC_v1:'.length);
    const envelope = JSON.parse(jsonStr);
    const key = deriveServerKey(envelope.salt);
    const iv = Buffer.from(envelope.iv, 'base64');
    const ctAndTag = Buffer.from(envelope.ct, 'base64');
    const tag = ctAndTag.subarray(ctAndTag.length - 16);
    const ct = ctAndTag.subarray(0, ctAndTag.length - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    let dec = decipher.update(ct, null, 'utf8');
    dec += decipher.final('utf8');
    if (canCacheLine) {
      if (serverDecryptedLineCache.size >= 64) {
        const oldest = serverDecryptedLineCache.keys().next().value;
        if (oldest !== undefined) serverDecryptedLineCache.delete(oldest);
      }
      serverDecryptedLineCache.set(trimmed, dec);
    }
    return dec;
  } catch {
    return '';
  }
}

function decryptEncryptedContent(rawText) {
  if (!rawText || !rawText.trim()) return '';
  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  let decryptedTotal = '';
  for (const line of lines) {
    if (line.startsWith('SIGESP_ENC_v1:')) {
      const dec = decryptSingleEnvelope(line);
      if (dec) decryptedTotal += '\n' + dec;
    } else {
      decryptedTotal += '\n' + line;
    }
  }
  return decryptedTotal;
}

async function readProtocolCounter(year) {
  try {
    const raw = await fs.readFile(COUNTER_FILE, 'utf8');
    const data = JSON.parse(raw);
    return parseInt(data?.[String(year)] || 0, 10) || 0;
  } catch {
    return 0;
  }
}

async function writeProtocolCounter(year, value, allowReset = false) {
  try {
    let data = {};
    try {
      const raw = await fs.readFile(COUNTER_FILE, 'utf8');
      data = JSON.parse(raw) || {};
    } catch {}
    const current = parseInt(data[String(year)] || 0, 10) || 0;
    if (allowReset || value > current) {
      data[String(year)] = value;
      await fs.mkdir(DADOS_DIR, { recursive: true });
      await atomicWriteFile(COUNTER_FILE, Buffer.from(JSON.stringify(data, null, 2), 'utf8'));
    }
  } catch (err) {
    console.warn('[vite.config.js] Falha ao persistir contador de protocolos:', err);
  }
}

async function extractExistingNumbersFromOcorrencias(year) {
  const occBatch = await listIndividualOccurrenceFiles();
  const filesToScan = ['ocorrencias.csv', 'ocorrencias_pendentes.csv', 'registros_apagados.csv'];
  let combinedSig = `INDIV:${occBatch.sig}|`;
  const stats = [];

  for (const name of filesToScan) {
    const p = path.resolve(DADOS_DIR, name);
    try {
      const st = await fs.stat(p);
      stats.push({ name, path: p, size: st.size, mtimeMs: st.mtimeMs });
      combinedSig += `${name}:${st.size}:${st.mtimeMs}|`;
    } catch {
      combinedSig += `${name}:0:0|`;
    }
  }

  if (
    ocorrenciasProtocolCache.sig === combinedSig &&
    ocorrenciasProtocolCache.byYear.has(year)
  ) {
    return new Set(ocorrenciasProtocolCache.byYear.get(year));
  }

  const used = new Set();
  const regex = new RegExp(`OC-${year}-(\\d{1,8})`, 'gi');
  const fileNameProtoRegex = new RegExp(`OC-${year}-(\\d{1,8})`, 'i');
  const indivFilesToRead = [];

  for (const occFile of occBatch.files) {
    const nameMatch = fileNameProtoRegex.exec(occFile.name);
    if (nameMatch) {
      const num = parseInt(nameMatch[1], 10);
      if (!isNaN(num) && num > 0) {
        used.add(num);
        continue;
      }
    }
    indivFilesToRead.push(occFile);
  }

  const allToRead = [...indivFilesToRead, ...stats];
  for (const item of allToRead) {
    if (item.size <= 0) continue;
    try {
      const raw = await fs.readFile(item.path, 'utf8');
      let m;
      regex.lastIndex = 0;
      while ((m = regex.exec(raw)) !== null) {
        const num = parseInt(m[1], 10);
        if (!isNaN(num) && num > 0) used.add(num);
      }
      if (raw.includes('SIGESP_ENC_v1:')) {
        const decrypted = decryptEncryptedContent(raw);
        regex.lastIndex = 0;
        while ((m = regex.exec(decrypted)) !== null) {
          const num = parseInt(m[1], 10);
          if (!isNaN(num) && num > 0) used.add(num);
        }
      }
    } catch {}
  }

  if (ocorrenciasProtocolCache.sig !== combinedSig) {
    ocorrenciasProtocolCache = {
      mtimeMs: occBatch.maxMtimeMs || stats[0]?.mtimeMs || 0,
      size: occBatch.totalSize || stats[0]?.size || 0,
      sig: combinedSig,
      byYear: new Map()
    };
  }
  ocorrenciasProtocolCache.byYear.set(year, new Set(used));
  return used;
}

async function atomicWriteFile(target, buffer) {
  const dir = path.dirname(target);
  await fs.mkdir(dir, { recursive: true });
  const tmpPath = `${target}.tmp.${process.pid}.${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  let handle = null;
  try {
    handle = await fs.open(tmpPath, 'w');
    await handle.writeFile(buffer);
    await handle.sync();
    await handle.close();
    handle = null;
    const tmpStat = await fs.stat(tmpPath);
    if (tmpStat.size !== buffer.length) {
      throw new Error(`Tamanho gravado inconsistente (${tmpStat.size} !== ${buffer.length}).`);
    }
    await fs.rename(tmpPath, target);
    return await fs.stat(target);
  } catch (error) {
    if (handle) {
      try {
        await handle.close();
      } catch {}
    }
    try {
      await fs.rm(tmpPath, { force: true });
    } catch {}
    throw error;
  }
}

function resolveSafePath(relPath = '') {
  let cleaned = String(relPath || '').replace(/^[/\\]+/, '');
  if (cleaned.startsWith('dados/') || cleaned.startsWith('dados\\')) {
    cleaned = cleaned.slice(6);
  }
  const resolved = path.resolve(DADOS_DIR, cleaned);
  if (resolved !== DADOS_DIR && !resolved.startsWith(DADOS_DIR + path.sep)) {
    const err = new Error('Caminho inválido fora da pasta de dados.');
    err.statusCode = 403;
    throw err;
  }
  return resolved;
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function createStorageMiddleware() {
  return async (req, res, next) => {
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      const pathname = url.pathname;
      let relPath = url.searchParams.get('path') || '';

      if (
        !relPath &&
        pathname !== '/' &&
        pathname !== '/file' &&
        pathname !== '/list' &&
        pathname !== '/mkdir' &&
        pathname !== '/occurrences/batch' &&
        pathname !== '/api/storage/occurrences/batch' &&
        !pathname.startsWith('/protocol/') &&
        !pathname.startsWith('/api/storage/protocol/')
      ) {
        relPath = pathname.replace(/^\/+/, '');
      }

      let createIfMissing = url.searchParams.get('create') === '1';
      if (relPath.includes('&create=1')) {
        createIfMissing = true;
        relPath = relPath.replace('&create=1', '');
      }
      if (relPath.includes('?create=1')) {
        createIfMissing = true;
        relPath = relPath.replace('?create=1', '');
      }

      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, PUT, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', '*');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Length, X-File-Size, X-File-Mtime, Content-Type');

      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
      }

      if (req.method === 'GET' && (pathname === '/list' || pathname === '/')) {
        await fs.mkdir(DADOS_DIR, { recursive: true });
        const entries = await fs.readdir(DADOS_DIR, { withFileTypes: true });
        const files = [];
        for (const entry of entries) {
          if (entry.isFile() && entry.name.toLowerCase().endsWith('.csv')) {
            const stat = await fs.stat(path.join(DADOS_DIR, entry.name));
            files.push({
              name: entry.name,
              size: stat.size,
              mtimeMs: stat.mtimeMs,
              updatedAt: stat.mtime.toISOString(),
            });
          }
        }
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ files }));
        return;
      }

      if (req.method === 'GET' && (pathname === '/occurrences/batch' || pathname === '/api/storage/occurrences/batch')) {
        const knownSig = url.searchParams.get('knownSig') || '';
        const batchInfo = await listIndividualOccurrenceFiles();
        let legacyRawText = '';
        let legacyMtime = 0;
        let legacySize = 0;
        const legacyPath = path.resolve(DADOS_DIR, 'ocorrencias.csv');
        try {
          const lStat = await fs.stat(legacyPath);
          if (lStat.isFile() && lStat.size > 0) {
            legacySize = lStat.size;
            legacyMtime = lStat.mtimeMs;
          }
        } catch {}

        const effectiveSig = legacySize > 0
          ? `${batchInfo.sig}:L:${legacySize}:${Math.round(legacyMtime)}`
          : batchInfo.sig;
        const effectiveTotalSize = batchInfo.totalSize + legacySize;
        const effectiveMaxMtime = Math.max(batchInfo.maxMtimeMs, legacyMtime);

        if (knownSig && knownSig === effectiveSig) {
          const respBuf = Buffer.from(JSON.stringify({
            ok: true,
            unchanged: true,
            sig: effectiveSig,
            count: batchInfo.count,
            totalSize: effectiveTotalSize,
            maxMtimeMs: effectiveMaxMtime
          }), 'utf8');
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Content-Length', String(respBuf.length));
          res.end(respBuf);
          return;
        }

        const loadedFiles = [];
        const chunkSize = 64;
        for (let i = 0; i < batchInfo.files.length; i += chunkSize) {
          const slice = batchInfo.files.slice(i, i + chunkSize);
          const chunkData = await Promise.all(
            slice.map(async f => {
              try {
                const rawText = await fs.readFile(f.path, 'utf8');
                return {
                  name: f.name,
                  size: f.size,
                  mtimeMs: f.mtimeMs,
                  rawText
                };
              } catch {
                return null;
              }
            })
          );
          for (const item of chunkData) {
            if (item && item.rawText) loadedFiles.push(item);
          }
        }

        if (legacySize > 0) {
          try {
            legacyRawText = await fs.readFile(legacyPath, 'utf8');
          } catch {}
        }

        const respPayload = Buffer.from(JSON.stringify({
          ok: true,
          unchanged: false,
          sig: effectiveSig,
          count: loadedFiles.length,
          totalSize: effectiveTotalSize,
          maxMtimeMs: effectiveMaxMtime,
          files: loadedFiles,
          legacyRawText
        }), 'utf8');
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Length', String(respPayload.length));
        res.end(respPayload);
        return;
      }

      // Endpoints de Reserva e Confirmação Centralizada de Protocolo (Concorrência Multiusuário)
      if (pathname === '/protocol/reserve' || pathname === '/api/storage/protocol/reserve') {
        const tReq0 = performance.now();
        const bodyBuf = await readRawBody(req);
        let payload = {};
        try { payload = JSON.parse(bodyBuf.toString('utf8')); } catch {}
        const user = String(payload.user || payload.usuario || 'Sistema').trim();
        const unit = String(payload.unit || '').trim();
        const year = parseInt(payload.year, 10) || new Date().getFullYear();
        const clientId = String(payload.clientId || payload.sessionId || '').trim();
        const preferredReservationId = String(payload.reservationId || '').trim();
        const preferredProtocol = String(payload.preferredProtocol || '').trim().toUpperCase();
        const previousProtocol = String(payload.previousProtocol || '').trim().toUpperCase();
        const forceNew = Boolean(payload.forceNew);
        const traceEnabled = Boolean(payload.trace);
        const existingKnownMax = parseInt(payload.existingMax || 0, 10) || 0;
        const clientKnownNumbers = Array.isArray(payload.knownNumbers)
          ? payload.knownNumbers.map(n => parseInt(n, 10)).filter(n => !isNaN(n) && n > 0)
          : [];

        logProtocolStep(traceEnabled, 'solicitação iniciada', {
          usuario: user,
          sessionId: clientId,
          forceNew,
          preferredProtocol: preferredProtocol || null
        });

        const reservation = await withProtocolControlLock(user, clientId, async () => {
          const tState0 = performance.now();
          const now = Date.now();
          const usedInFile = await extractExistingNumbersFromOcorrencias(year);
          let allList = await readAllReservationsRaw(usedInFile, year);

          const utilizedNumbers = new Set(
            allList
              .filter(r => r.year === year && (r.status === 'UTILIZADO' || r.status === 'CONFIRMADO' || r.confirmado === true))
              .map(r => r.id_sequencial)
              .filter(n => typeof n === 'number' && n > 0)
          );

          logProtocolStep(traceEnabled, 'estado compartilhado carregado', {
            ocorrenciasNoDisco: usedInFile.size,
            reservasCarregadas: allList.length,
            utilizadosConfirmados: utilizedNumbers.size,
            tempoMs: +(performance.now() - tState0).toFixed(2)
          });

          // 1. Reutilização segura: APENAS para a mesma sessão/instância (mesmo clientId/sessionId) se a reserva continuar ativa e sem conflito
          if (clientId && !forceNew) {
            const existingClient = allList.find(r => {
              if (r.year !== year || r.status !== 'RESERVADO' || r.expiresAt <= now) return false;
              if (usedInFile.has(r.id_sequencial) || utilizedNumbers.has(r.id_sequencial)) return false;
              const sameSession = r.clientId === clientId || r.sessionId === clientId;
              if (!sameSession) return false;
              if (preferredReservationId && r.reservationId === preferredReservationId) return true;
              if (preferredProtocol && r.protocolo === preferredProtocol) return true;
              return true;
            });

            if (existingClient) {
              // Garante que nenhuma outra sessão ativa tem este mesmo número
              const collisionWithOther = allList.some(
                other =>
                  other.reservationId !== existingClient.reservationId &&
                  other.year === year &&
                  other.id_sequencial === existingClient.id_sequencial &&
                  (other.status === 'UTILIZADO' || other.status === 'CONFIRMADO' || (other.status === 'RESERVADO' && other.expiresAt > now))
              );
              if (!collisionWithOther) {
                existingClient.expiresAt = now + RESERVATION_TTL_MS;
                if (unit) existingClient.unit = unit;
                if (user && user !== 'Sistema') {
                  existingClient.usuario = user;
                  existingClient.user = user;
                }
                logProtocolStep(traceEnabled, 'próximo número calculado', {
                  modo: 'REUTILIZACAO_SESSAO_ATIVA',
                  numeroProtocolo: existingClient.numeroProtocolo,
                  id_sequencial: existingClient.id_sequencial
                });
                logProtocolStep(traceEnabled, 'reservationId criado', {
                  reservationId: existingClient.reservationId,
                  reutilizado: true
                });
                const verifiedExisting = await writeReservations(allList);
                logProtocolStep(traceEnabled, 'reserva persistida', {
                  numeroProtocolo: existingClient.numeroProtocolo,
                  reservationId: existingClient.reservationId
                });
                const confirmedExisting = verifiedExisting.find(
                  r => (r.reservationId === existingClient.reservationId || r.id_reserva === existingClient.reservationId) &&
                       (r.protocolo === existingClient.protocolo || r.numeroProtocolo === existingClient.numeroProtocolo)
                );
                if (!confirmedExisting) {
                  throw new Error('Falha ao confirmar persistência da reserva ativa da sessão.');
                }
                logProtocolStep(traceEnabled, 'persistência confirmada', {
                  numeroProtocolo: confirmedExisting.numeroProtocolo || confirmedExisting.protocolo,
                  reservationId: confirmedExisting.reservationId || confirmedExisting.id_reserva,
                  tempoTotalMs: +(performance.now() - tReq0).toFixed(2)
                });
                return { ...normalizeReservationItem(confirmedExisting, now, usedInFile), reused: true };
              }
            }
          }

          // Se forceNew foi solicitado para este clientId, cancela reservas pendentes anteriores desta mesma sessão que não foram gravadas no CSV
          if (clientId && (forceNew || previousProtocol)) {
            for (const r of allList) {
              const sameSess = r.clientId === clientId || r.sessionId === clientId;
              const matchesPrev = !previousProtocol || r.protocolo === previousProtocol || r.numeroProtocolo === previousProtocol;
              if (sameSess && r.year === year && r.status === 'RESERVADO' && matchesPrev && !usedInFile.has(r.id_sequencial)) {
                r.status = 'CANCELADO';
                r.expiresAt = now - 1;
              }
            }
          }

          const activeReservedNums = new Set(
            allList
              .filter(r => r.year === year && r.status === 'RESERVADO' && r.expiresAt > now)
              .map(r => r.id_sequencial)
              .filter(n => typeof n === 'number' && n > 0)
          );

          const counterMax = (usedInFile.size > 0 || utilizedNumbers.size > 0)
            ? await readProtocolCounter(year)
            : 0;

          let maxKnown = Math.max(counterMax, existingKnownMax, ...clientKnownNumbers);
          for (const num of usedInFile) {
            if (num > maxKnown) maxKnown = num;
          }
          for (const num of utilizedNumbers) {
            if (num > maxKnown) maxKnown = num;
          }
          for (const num of activeReservedNums) {
            if (num > maxKnown) maxKnown = num;
          }

          let candidate = Math.max(1, maxKnown + 1);
          while (
            usedInFile.has(candidate) ||
            utilizedNumbers.has(candidate) ||
            activeReservedNums.has(candidate)
          ) {
            candidate++;
          }

          const proto = `OC-${year}-${String(candidate).padStart(6, '0')}`;
          logProtocolStep(traceEnabled, 'próximo número calculado', {
            modo: 'NOVA_RESERVA_ATOMICA',
            numeroProtocolo: proto,
            id_sequencial: candidate,
            maxAnterior: maxKnown
          });

          const reservationId = crypto.randomUUID();
          const effectiveSessionId = clientId || reservationId;
          const isoNow = new Date(now).toISOString();

          logProtocolStep(traceEnabled, 'reservationId criado', {
            reservationId,
            sessionId: effectiveSessionId,
            numeroProtocolo: proto
          });

          const item = {
            id_reserva: reservationId,
            reservationId,
            numeroProtocolo: proto,
            protocolo: proto,
            id_sequencial: candidate,
            usuario: user,
            user,
            sessionId: effectiveSessionId,
            clientId: effectiveSessionId,
            sessao: effectiveSessionId,
            id_interno: null,
            unit,
            year,
            dataHoraReserva: isoNow,
            data_hora: isoNow,
            createdAt: now,
            expiresAt: now + RESERVATION_TTL_MS,
            status: 'RESERVADO',
            confirmado: false,
            dataHoraUtilizacao: null,
            confirmedAt: null
          };
          allList.push(item);
          const verifiedList = await writeReservations(allList);
          logProtocolStep(traceEnabled, 'reserva persistida', {
            numeroProtocolo: proto,
            reservationId
          });

          const confirmedSaved = verifiedList.find(
            r => (r.reservationId === reservationId || r.id_reserva === reservationId) &&
                 (r.protocolo === proto || r.numeroProtocolo === proto)
          );
          if (!confirmedSaved) {
            throw new Error('Falha ao confirmar a gravação da reserva de protocolo no armazenamento compartilhado.');
          }
          logProtocolStep(traceEnabled, 'persistência confirmada', {
            numeroProtocolo: proto,
            reservationId,
            tempoTotalMs: +(performance.now() - tReq0).toFixed(2)
          });
          return { ...normalizeReservationItem(confirmedSaved, now, usedInFile), reused: false };
        }, traceEnabled);

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: true, ...reservation, reservation }));
        return;
      }

      if (pathname === '/protocol/confirm' || pathname === '/api/storage/protocol/confirm') {
        const bodyBuf = await readRawBody(req);
        let payload = {};
        try { payload = JSON.parse(bodyBuf.toString('utf8')); } catch {}
        const proto = String(payload.protocolo || payload.numeroProtocolo || '').trim().toUpperCase();
        const user = String(payload.user || payload.usuario || 'Sistema').trim();
        const unit = String(payload.unit || '').trim();
        const clientId = String(payload.clientId || payload.sessionId || '').trim();
        const reservationId = String(payload.reservationId || '').trim();
        const idInterno = String(payload.id_interno || '').trim();
        const markUtilized = Boolean(payload.markUtilized);
        const autoResolve = payload.autoResolve !== false;
        const traceEnabled = Boolean(payload.trace);
        const yearMatch = /^OC-(\d{4})-(\d+)$/i.exec(proto);
        const year = yearMatch ? parseInt(yearMatch[1], 10) : (parseInt(payload.year, 10) || new Date().getFullYear());
        const seqNum = yearMatch ? parseInt(yearMatch[2], 10) : 0;

        const result = await withProtocolControlLock(user, clientId, async () => {
          const now = Date.now();
          const usedInFile = await extractExistingNumbersFromOcorrencias(year);
          let allList = await readAllReservationsRaw(usedInFile, year);

          const alreadyInFile = seqNum > 0 && usedInFile.has(seqNum);
          // Procura reservas para este protocolo
          const matchingList = allList.filter(r => String(r.protocolo || r.numeroProtocolo || '').toUpperCase() === proto);
          const ownRes = matchingList.find(r =>
            (reservationId && r.reservationId === reservationId) ||
            (clientId && (r.clientId === clientId || r.sessionId === clientId))
          );
          const matchingRes = ownRes || matchingList[0] || null;

          const utilizedByOther = matchingList.some(r =>
            (r.status === 'UTILIZADO' || r.status === 'CONFIRMADO' || r.confirmado === true) &&
            ((idInterno && r.id_interno && r.id_interno !== idInterno) ||
             (!idInterno && clientId && r.clientId && r.clientId !== clientId) ||
             (reservationId && r.reservationId && r.reservationId !== reservationId))
          );

          const reservedByOther = matchingList.some(r =>
            r.status === 'RESERVADO' &&
            r.expiresAt > now &&
            ((clientId && r.clientId && r.clientId !== clientId) ||
             (reservationId && r.reservationId && r.reservationId !== reservationId && (!clientId || r.clientId !== clientId)))
          );

          const hasConflict = !proto || seqNum <= 0 || alreadyInFile || utilizedByOther || reservedByOther;

          if (hasConflict) {
            if (!autoResolve) {
              return {
                ok: false,
                conflict: true,
                message: `O protocolo ${proto || 'informado'} já foi utilizado ou pertence a outra reserva ativa.`
              };
            }

            const utilizedNumbers = new Set(
              allList
                .filter(r => r.year === year && (r.status === 'UTILIZADO' || r.status === 'CONFIRMADO' || r.confirmado === true))
                .map(r => r.id_sequencial)
                .filter(n => typeof n === 'number' && n > 0)
            );
            const activeReservedNums = new Set(
              allList
                .filter(r => r.year === year && r.status === 'RESERVADO' && r.expiresAt > now)
                .map(r => r.id_sequencial)
                .filter(n => typeof n === 'number' && n > 0)
            );
            const counterMax = (usedInFile.size > 0 || utilizedNumbers.size > 0)
              ? await readProtocolCounter(year)
              : 0;
            let maxKnown = counterMax;
            for (const n of usedInFile) if (n > maxKnown) maxKnown = n;
            for (const n of utilizedNumbers) if (n > maxKnown) maxKnown = n;
            for (const n of activeReservedNums) if (n > maxKnown) maxKnown = n;

            let candidate = Math.max(1, maxKnown + 1);
            while (
              usedInFile.has(candidate) ||
              utilizedNumbers.has(candidate) ||
              activeReservedNums.has(candidate)
            ) {
              candidate++;
            }

            const newProto = `OC-${year}-${String(candidate).padStart(6, '0')}`;
            const newResId = crypto.randomUUID();
            const effectiveSessionId = clientId || newResId;
            const isoNow = new Date(now).toISOString();
            const newItem = {
              id_reserva: newResId,
              reservationId: newResId,
              numeroProtocolo: newProto,
              protocolo: newProto,
              id_sequencial: candidate,
              usuario: user,
              user,
              sessionId: effectiveSessionId,
              clientId: effectiveSessionId,
              sessao: effectiveSessionId,
              id_interno: idInterno || null,
              unit,
              year,
              dataHoraReserva: isoNow,
              data_hora: isoNow,
              createdAt: now,
              expiresAt: now + RESERVATION_TTL_MS,
              status: markUtilized ? 'UTILIZADO' : 'RESERVADO',
              confirmado: markUtilized,
              dataHoraUtilizacao: markUtilized ? isoNow : null,
              confirmedAt: markUtilized ? isoNow : null
            };
            if (markUtilized) {
              await writeProtocolCounter(year, candidate);
            }
            allList.push(newItem);
            await writeReservations(allList);
            return {
              ok: true,
              conflict: true,
              conflictResolved: true,
              reallocated: true,
              previousProtocol: proto,
              protocolo: newProto,
              numeroProtocolo: newProto,
              id_sequencial: candidate,
              reservationId: newResId,
              reservation: newItem
            };
          }

          const isoNow = new Date(now).toISOString();
          if (matchingRes) {
            const needsWrite = markUtilized ||
              matchingRes.status !== 'RESERVADO' ||
              (matchingRes.expiresAt - now <= 60000) ||
              Boolean(idInterno && matchingRes.id_interno !== idInterno);

            matchingRes.expiresAt = now + RESERVATION_TTL_MS;
            if (idInterno) matchingRes.id_interno = idInterno;
            if (clientId) {
              matchingRes.clientId = clientId;
              matchingRes.sessionId = clientId;
              matchingRes.sessao = clientId;
            }
            if (markUtilized) {
              matchingRes.status = 'UTILIZADO';
              matchingRes.confirmado = true;
              matchingRes.dataHoraUtilizacao = isoNow;
              matchingRes.confirmedAt = isoNow;
              await writeProtocolCounter(year, seqNum);
            }
            if (needsWrite) {
              await writeReservations(allList);
            }
            return {
              ok: true,
              conflict: false,
              conflictResolved: false,
              reallocated: false,
              protocolo: matchingRes.protocolo,
              numeroProtocolo: matchingRes.numeroProtocolo || matchingRes.protocolo,
              id_sequencial: matchingRes.id_sequencial,
              reservationId: matchingRes.reservationId,
              reservation: matchingRes
            };
          }

          const newResId = reservationId || crypto.randomUUID();
          const effectiveSessionId = clientId || newResId;
          const createdItem = {
            id_reserva: newResId,
            reservationId: newResId,
            numeroProtocolo: proto,
            protocolo: proto,
            id_sequencial: seqNum,
            usuario: user,
            user,
            sessionId: effectiveSessionId,
            clientId: effectiveSessionId,
            sessao: effectiveSessionId,
            id_interno: idInterno || null,
            unit,
            year,
            dataHoraReserva: isoNow,
            data_hora: isoNow,
            createdAt: now,
            expiresAt: now + RESERVATION_TTL_MS,
            status: markUtilized ? 'UTILIZADO' : 'RESERVADO',
            confirmado: markUtilized,
            dataHoraUtilizacao: markUtilized ? isoNow : null,
            confirmedAt: markUtilized ? isoNow : null
          };
          if (markUtilized) {
            await writeProtocolCounter(year, seqNum);
          }
          allList.push(createdItem);
          await writeReservations(allList);
          return {
            ok: true,
            conflict: false,
            conflictResolved: false,
            reallocated: false,
            protocolo: proto,
            numeroProtocolo: proto,
            id_sequencial: seqNum,
            reservationId: newResId,
            reservation: createdItem
          };
        }, traceEnabled);

        res.statusCode = result.ok ? 200 : 409;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(result));
        return;
      }

      if (pathname === '/protocol/release' || pathname === '/api/storage/protocol/release') {
        const bodyBuf = await readRawBody(req);
        let payload = {};
        try { payload = JSON.parse(bodyBuf.toString('utf8')); } catch {}
        const proto = String(payload.protocolo || payload.numeroProtocolo || '').trim().toUpperCase();
        const confirmedUse = Boolean(payload.confirmed || payload.utilized);
        const clientId = String(payload.clientId || payload.sessionId || '').trim();
        const reservationId = String(payload.reservationId || '').trim();
        const idInterno = String(payload.id_interno || '').trim();

        await withProtocolControlLock(payload.user || 'Sistema', clientId, async () => {
          const seqMatch = /^OC-(\d{4})-(\d+)$/i.exec(proto);
          const year = seqMatch ? parseInt(seqMatch[1], 10) : new Date().getFullYear();
          const seqNum = seqMatch ? parseInt(seqMatch[2], 10) : 0;
          const usedInFile = await extractExistingNumbersFromOcorrencias(year);
          let allList = await readAllReservationsRaw(usedInFile, year);

          if (proto) {
            const isActuallySaved = confirmedUse || (seqNum > 0 && usedInFile.has(seqNum));
            const isoNow = new Date().toISOString();

            allList = allList.filter(r => {
              const rProto = String(r.protocolo || r.numeroProtocolo || '').toUpperCase();
              if (rProto !== proto) return true;
              if (isActuallySaved || r.status === 'UTILIZADO' || r.status === 'CONFIRMADO' || r.confirmado) {
                r.status = 'UTILIZADO';
                r.confirmado = true;
                r.dataHoraUtilizacao = r.dataHoraUtilizacao || r.confirmedAt || isoNow;
                r.confirmedAt = r.dataHoraUtilizacao;
                if (idInterno) r.id_interno = idInterno;
                return true;
              }
              // Só permite cancelar reserva que pertence à mesma sessão/reservationId (ou sem dono)
              if (reservationId && r.reservationId && r.reservationId !== reservationId) return true;
              if (clientId && r.clientId && r.clientId !== clientId) return true;
              return false;
            });

            if (isActuallySaved && seqNum > 0) {
              await writeProtocolCounter(year, seqNum);
            }
          }
          await writeReservations(allList);
        });

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: true, released: proto }));
        return;
      }

      if (pathname === '/protocol/renew' || pathname === '/api/storage/protocol/renew') {
        const bodyBuf = await readRawBody(req);
        let payload = {};
        try { payload = JSON.parse(bodyBuf.toString('utf8')); } catch {}
        const proto = String(payload.protocolo || payload.numeroProtocolo || '').trim().toUpperCase();
        const clientId = String(payload.clientId || payload.sessionId || '').trim();
        const reservationId = String(payload.reservationId || '').trim();
        const seqMatch = /^OC-(\d{4})-(\d+)$/i.exec(proto);
        const year = seqMatch ? parseInt(seqMatch[1], 10) : new Date().getFullYear();
        const seqNum = seqMatch ? parseInt(seqMatch[2], 10) : 0;

        const renewResult = await withProtocolControlLock(payload.user || 'Sistema', clientId, async () => {
          const usedInFile = await extractExistingNumbersFromOcorrencias(year);
          let allList = await readAllReservationsRaw(usedInFile, year);

          if (seqNum > 0 && usedInFile.has(seqNum)) {
            return { ok: false, conflict: true, reason: 'ALREADY_IN_CSV' };
          }

          const target = allList.find(r => {
            const rProto = String(r.protocolo || r.numeroProtocolo || '').toUpperCase();
            if (rProto !== proto) return false;
            if (reservationId && r.reservationId === reservationId) return true;
            if (clientId && (r.clientId === clientId || r.sessionId === clientId)) return true;
            return !clientId && !reservationId;
          });

          if (!target || target.status !== 'RESERVADO') {
            return { ok: false, conflict: true, reason: 'RESERVATION_NOT_ACTIVE' };
          }

          target.expiresAt = Date.now() + RESERVATION_TTL_MS;
          await writeReservations(allList);
          return { ok: true, conflict: false, expiresAt: target.expiresAt, reservation: target };
        });

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(renewResult));
        return;
      }

      if (pathname === '/protocol/list' || pathname === '/api/storage/protocol/list') {
        const year = parseInt(url.searchParams.get('year') || '', 10) || new Date().getFullYear();
        const usedInFile = await extractExistingNumbersFromOcorrencias(year);
        const list = await readAllReservationsRaw(usedInFile, year);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: true, reservations: list }));
        return;
      }

      if ((req.method === 'GET' || req.method === 'HEAD') && (pathname === '/file' || relPath)) {
        const target = resolveSafePath(relPath);
        if (path.basename(target).toLowerCase() === 'ocorrencias.csv' && path.dirname(target) === DADOS_DIR) {
          const batchInfo = await listIndividualOccurrenceFiles();
          let legacySize = 0;
          let legacyMtime = 0;
          try {
            const lStat = await fs.stat(target);
            if (lStat.isFile() && lStat.size > 0) {
              legacySize = lStat.size;
              legacyMtime = lStat.mtimeMs;
            }
          } catch {}
          const totalSize = batchInfo.totalSize + legacySize;
          const maxMtimeMs = Math.max(batchInfo.maxMtimeMs, legacyMtime, 1);

          if (req.method === 'HEAD') {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Length', String(totalSize));
            res.setHeader('X-File-Size', String(totalSize));
            res.setHeader('X-File-Mtime', String(maxMtimeMs));
            res.end();
            return;
          }

          const chunks = [];
          const chunkSize = 64;
          for (let i = 0; i < batchInfo.files.length; i += chunkSize) {
            const slice = batchInfo.files.slice(i, i + chunkSize);
            const texts = await Promise.all(
              slice.map(f => fs.readFile(f.path, 'utf8').catch(() => ''))
            );
            for (const t of texts) {
              if (t && t.trim()) chunks.push(t.trim());
            }
          }
          if (legacySize > 0) {
            try {
              const legText = await fs.readFile(target, 'utf8');
              if (legText && legText.trim()) chunks.push(legText.trim());
            } catch {}
          }
          const combinedPayload = Buffer.from(chunks.join('\r\n'), 'utf8');
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/csv; charset=utf-8');
          res.setHeader('Content-Length', String(combinedPayload.length));
          res.setHeader('X-File-Size', String(totalSize));
          res.setHeader('X-File-Mtime', String(maxMtimeMs));
          res.end(combinedPayload);
          return;
        }

        createIfMissing = createIfMissing || url.searchParams.get('create') === '1';
        let stat;
        try {
          stat = await fs.stat(target);
        } catch (err) {
          if (err && err.code === 'ENOENT') {
            if (createIfMissing) {
              stat = await withServerFileLock(target, async () => {
                try {
                  return await fs.stat(target);
                } catch {
                  return await atomicWriteFile(target, Buffer.alloc(0));
                }
              });
            } else {
              res.statusCode = 404;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify({ error: 'NotFoundError', message: 'Arquivo não encontrado.' }));
              return;
            }
          } else {
            throw err;
          }
        }

        if (!stat.isFile()) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: 'NotFoundError', message: 'Caminho não é um arquivo.' }));
          return;
        }

        const ext = path.extname(target).toLowerCase();
        const contentType =
          ext === '.csv'
            ? 'text/csv; charset=utf-8'
            : ext === '.json'
            ? 'application/json; charset=utf-8'
            : ext === '.jpg' || ext === '.jpeg'
            ? 'image/jpeg'
            : ext === '.png'
            ? 'image/png'
            : ext === '.webp'
            ? 'image/webp'
            : 'application/octet-stream';

        if (req.method === 'HEAD') {
          res.statusCode = 200;
          res.setHeader('Content-Type', contentType);
          res.setHeader('Content-Length', String(stat.size));
          res.setHeader('X-File-Size', String(stat.size));
          res.setHeader('X-File-Mtime', String(stat.mtimeMs));
          res.end();
          return;
        }

        const data = await fs.readFile(target);
        res.statusCode = 200;
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', String(data.length));
        res.setHeader('X-File-Size', String(data.length));
        res.setHeader('X-File-Mtime', String(stat.mtimeMs));
        res.end(data);
        return;
      }

      if (req.method === 'PUT' && (pathname === '/file' || relPath)) {
        const target = resolveSafePath(relPath);
        const body = await readRawBody(req);
        const expectedMtimeHeader = req.headers['x-expected-mtime'];
        const releasedHeader = req.headers['x-released-protocol'];
        const baseNameLower = path.basename(target).toLowerCase();
        const isOccTarget = baseNameLower === 'ocorrencias.csv' || isIndividualOccurrenceFile(baseNameLower);

        let conflictDetected = false;
        let currentStatOnConflict = null;

        const stat = await withServerFileLock(target, async () => {
          if (expectedMtimeHeader !== undefined && expectedMtimeHeader !== '') {
            const expectedMtime = Number(expectedMtimeHeader);
            if (!isNaN(expectedMtime) && expectedMtime > 0) {
              try {
                const currentStat = await fs.stat(target);
                if (currentStat.size > 0 && Math.abs(currentStat.mtimeMs - expectedMtime) > 1) {
                  conflictDetected = true;
                  currentStatOnConflict = currentStat;
                  return currentStat;
                }
              } catch (statErr) {
                if (statErr.code !== 'ENOENT') throw statErr;
              }
            }
          }
          const writtenStat = await atomicWriteFile(target, body);
          if (isOccTarget) {
            lastOccurrenceMutationMs = Math.max(Date.now(), writtenStat.mtimeMs || 0);
            if (!releasedHeader) {
              invalidateOcorrenciasProtocolCache();
            }
          }
          return writtenStat;
        });

        if (conflictDetected) {
          res.statusCode = 409;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          if (currentStatOnConflict) {
            res.setHeader('X-File-Size', String(currentStatOnConflict.size));
            res.setHeader('X-File-Mtime', String(currentStatOnConflict.mtimeMs));
          }
          res.end(
            JSON.stringify({
              error: 'InvalidStateError',
              code: 'ERRO_DE_SINCRONIZACAO',
              message: 'O arquivo foi alterado simultaneamente por outro usuário.',
              mtimeMs: currentStatOnConflict?.mtimeMs
            })
          );
          return;
        }

        if (releasedHeader) {
          const protoToConfirm = String(releasedHeader).trim().toUpperCase();
          await withProtocolControlLock('Sistema', '', async () => {
            const m = /^OC-(\d{4})-(\d+)$/i.exec(protoToConfirm);
            const year = m ? parseInt(m[1], 10) : new Date().getFullYear();
            const seq = m ? parseInt(m[2], 10) : 0;
            if (seq > 0 && ocorrenciasProtocolCache.sig && ocorrenciasProtocolCache.byYear.has(year)) {
              ocorrenciasProtocolCache.byYear.get(year).add(seq);
              ocorrenciasProtocolCache.mtimeMs = stat.mtimeMs;
              ocorrenciasProtocolCache.size = stat.size;
              ocorrenciasProtocolCache.sig = ocorrenciasProtocolCache.sig.replace(
                /^ocorrencias\.csv:[^|]+\|/,
                `ocorrencias.csv:${stat.size}:${stat.mtimeMs}|`
              );
            } else {
              invalidateOcorrenciasProtocolCache();
            }
            let allList = await readAllReservationsRaw(null, year);
            const isoNow = new Date().toISOString();
            const targetRes = allList.find(r => String(r.protocolo || r.numeroProtocolo || '').toUpperCase() === protoToConfirm);
            if (targetRes) {
              targetRes.status = 'UTILIZADO';
              targetRes.confirmado = true;
              targetRes.dataHoraUtilizacao = targetRes.dataHoraUtilizacao || isoNow;
              targetRes.confirmedAt = targetRes.dataHoraUtilizacao;
            } else if (m) {
              const resId = crypto.randomUUID();
              allList.push({
                id_reserva: resId,
                reservationId: resId,
                numeroProtocolo: protoToConfirm,
                protocolo: protoToConfirm,
                id_sequencial: seq,
                usuario: 'Sistema',
                user: 'Sistema',
                sessionId: resId,
                clientId: resId,
                sessao: resId,
                year,
                status: 'UTILIZADO',
                confirmado: true,
                dataHoraReserva: isoNow,
                data_hora: isoNow,
                createdAt: Date.now(),
                expiresAt: Date.now() + RESERVATION_TTL_MS,
                dataHoraUtilizacao: isoNow,
                confirmedAt: isoNow
              });
            }
            if (seq > 0) {
              await writeProtocolCounter(year, seq);
            }
            await writeReservations(allList);
          }).catch(err => logProtocolError('confirmOnPutFile', err, { protoToConfirm }));
        }

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('X-File-Size', String(stat.size));
        res.setHeader('X-File-Mtime', String(stat.mtimeMs));
        res.end(JSON.stringify({ ok: true, size: stat.size, mtimeMs: stat.mtimeMs }));
        return;
      }

      if ((req.method === 'POST' || req.method === 'PATCH') && (pathname === '/append' || url.searchParams.get('action') === 'append')) {
        const target = resolveSafePath(relPath);
        const chunk = await readRawBody(req);
        const stat = await withServerFileLock(target, async () => {
          await fs.mkdir(path.dirname(target), { recursive: true });
          await fs.appendFile(target, chunk);
          const s = await fs.stat(target);
          if (path.basename(target).toLowerCase() === 'ocorrencias.csv') {
            invalidateOcorrenciasProtocolCache();
          }
          return s;
        });

        // Marca a reserva correspondente como UTILIZADA
        const releasedHeader = req.headers['x-released-protocol'];
        const chunkStr = chunk.toString('utf8');
        let protoToRelease = releasedHeader ? String(releasedHeader).trim() : '';
        if (!protoToRelease) {
          const m = /OC-\d{4}-\d{6}/i.exec(chunkStr);
          if (m) protoToRelease = m[0];
          else if (chunkStr.includes('SIGESP_ENC_v1:')) {
            const dec = decryptSingleEnvelope(chunkStr);
            const decMatch = /OC-\d{4}-\d{6}/i.exec(dec);
            if (decMatch) protoToRelease = decMatch[0];
          }
        }

        if (protoToRelease) {
          const protoUpper = protoToRelease.toUpperCase();
          await withProtocolControlLock('Sistema', '', async () => {
            const m = /^OC-(\d{4})-(\d+)$/i.exec(protoUpper);
            const year = m ? parseInt(m[1], 10) : new Date().getFullYear();
            const seq = m ? parseInt(m[2], 10) : 0;
            let allList = await readAllReservationsRaw(null, year);
            const isoNow = new Date().toISOString();
            const targetRes = allList.find(r => String(r.protocolo || r.numeroProtocolo || '').toUpperCase() === protoUpper);
            if (targetRes) {
              targetRes.status = 'UTILIZADO';
              targetRes.confirmado = true;
              targetRes.dataHoraUtilizacao = targetRes.dataHoraUtilizacao || isoNow;
              targetRes.confirmedAt = targetRes.dataHoraUtilizacao;
            }
            if (seq > 0) {
              await writeProtocolCounter(year, seq);
            }
            await writeReservations(allList);
          }).catch(err => logProtocolError('confirmOnAppend', err, { protoUpper }));
        }

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('X-File-Size', String(stat.size));
        res.setHeader('X-File-Mtime', String(stat.mtimeMs));
        res.end(JSON.stringify({ ok: true, size: stat.size, mtimeMs: stat.mtimeMs, appended: chunk.length }));
        return;
      }

      if (req.method === 'POST' && pathname === '/mkdir') {
        const target = resolveSafePath(relPath);
        await fs.mkdir(target, { recursive: true });
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      if (req.method === 'DELETE' && (pathname === '/file' || relPath)) {
        const target = resolveSafePath(relPath);
        const baseNameLower = path.basename(target).toLowerCase();
        await withServerFileLock(target, async () => {
          await fs.rm(target, { force: true, recursive: true });
          if (baseNameLower === 'ocorrencias.csv' || isIndividualOccurrenceFile(baseNameLower)) {
            invalidateOcorrenciasProtocolCache();
          }
        });
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      next();
    } catch (error) {
      console.error('Erro no middleware de armazenamento SIGESP:', error);
      res.statusCode = error.statusCode || 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(
        JSON.stringify({
          error: error.name || 'StorageError',
          message: error.message || 'Erro interno no armazenamento de dados.',
        })
      );
    }
  };
}

export default defineConfig({
  server: {
    port: 3000,
    host: '0.0.0.0',
    allowedHosts: true,
    hmr: process.env.DISABLE_HMR !== 'true',
    watch: process.env.DISABLE_HMR === 'true' ? null : { ignored: ['**/dados/**'] },
  },
  preview: {
    port: 3000,
    host: '0.0.0.0',
    allowedHosts: true,
  },
  plugins: [
    {
      name: 'sigesp-hybrid-storage',
      configureServer(server) {
        server.middlewares.use('/api/storage', createStorageMiddleware());
        server.middlewares.use('/dados', createStorageMiddleware());
      },
      configurePreviewServer(server) {
        server.middlewares.use('/api/storage', createStorageMiddleware());
        server.middlewares.use('/dados', createStorageMiddleware());
      },
    },
  ],
});
