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
  const chunkSize = 512;
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

// ============================================================================
// REAL-TIME BROADCAST ENGINE (SERVER-SENT EVENTS - SSE)
// ============================================================================
const sseClients = new Set();

function broadcastStorageEvent(eventType, payload = {}) {
  const data = JSON.stringify({ type: eventType, timestamp: Date.now(), ...payload });
  const msg = `data: ${data}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(msg);
    } catch {
      sseClients.delete(client);
    }
  }
}

setInterval(() => {
  for (const client of sseClients) {
    try {
      client.write(': ping\n\n');
    } catch {
      sseClients.delete(client);
    }
  }
}, 15000);

// ============================================================================
// HIGH-CONCURRENCY PROTOCOL ENGINE (IN-MEMORY ATOMIC SEQUENCE + WRITE COALESCING)
// ============================================================================
const protocolEngine = {
  initializedYears: new Set(),
  initPromises: new Map(),
  maxByYear: new Map(),
  reservations: new Map(),
  reservationsBySession: new Map(),
  reservationsByProtocol: new Map(),
  persistDebounceTimers: new Map(),
};

async function ensureProtocolEngineInitialized(year) {
  if (protocolEngine.initializedYears.has(year)) return;
  if (protocolEngine.initPromises.has(year)) {
    return await protocolEngine.initPromises.get(year);
  }
  const initPromise = (async () => {
    try {
      const counterVal = await readProtocolCounter(year);
      const usedInFiles = await extractExistingNumbersFromOcorrencias(year);
      const rawReservations = await readAllReservationsRaw(usedInFiles, year);

      let maxSeq = Math.max(0, counterVal);
      for (const n of usedInFiles) {
        if (n > maxSeq) maxSeq = n;
      }
      for (const r of rawReservations) {
        if (r.year === year && r.id_sequencial > maxSeq) {
          maxSeq = r.id_sequencial;
        }
      }
      protocolEngine.maxByYear.set(year, maxSeq);

      for (const r of rawReservations) {
        const resId = r.reservationId || r.id_reserva;
        const proto = (r.numeroProtocolo || r.protocolo || '').toUpperCase();
        if (resId && proto) {
          protocolEngine.reservations.set(resId, r);
          protocolEngine.reservationsByProtocol.set(proto, resId);
          if (r.clientId) {
            protocolEngine.reservationsBySession.set(`${r.year || year}:${r.clientId}`, resId);
          }
        }
      }
      protocolEngine.initializedYears.add(year);
    } catch (err) {
      console.error('[protocolEngine] Falha na inicialização do ano', year, err);
    } finally {
      protocolEngine.initPromises.delete(year);
    }
  })();
  protocolEngine.initPromises.set(year, initPromise);
  return await initPromise;
}

function scheduleProtocolEnginePersist(year) {
  if (protocolEngine.persistDebounceTimers.has(year)) {
    clearTimeout(protocolEngine.persistDebounceTimers.get(year));
  }
  const timer = setTimeout(async () => {
    protocolEngine.persistDebounceTimers.delete(year);
    try {
      const allList = Array.from(protocolEngine.reservations.values());
      const curMax = protocolEngine.maxByYear.get(year) || 0;
      await withServerFileLock(RESERVATIONS_FILE, async () => {
        if (curMax > 0) {
          await writeProtocolCounter(year, curMax);
        }
        await writeReservations(allList);
      });
    } catch (persistErr) {
      console.warn('[protocolEngine] Falha na persistência assíncrona:', persistErr);
    }
  }, 40);
  protocolEngine.persistDebounceTimers.set(year, timer);
}

async function reserveProtocolAtomic(payload) {
  const tReq0 = performance.now();
  const user = String(payload.user || payload.usuario || 'Sistema').trim();
  const unit = String(payload.unit || '').trim();
  const year = parseInt(payload.year, 10) || new Date().getFullYear();
  const clientId = String(payload.clientId || payload.sessionId || '').trim();
  const preferredReservationId = String(payload.reservationId || '').trim();
  const preferredProtocol = String(payload.preferredProtocol || '').trim().toUpperCase();
  const previousProtocol = String(payload.previousProtocol || '').trim().toUpperCase();
  const forceNew = Boolean(payload.forceNew);
  const traceEnabled = Boolean(payload.trace);
  const now = Date.now();

  await ensureProtocolEngineInitialized(year);

  // 1. Reutilização de reserva ativa da mesma sessão se !forceNew
  if (clientId && !forceNew) {
    const existingResId = protocolEngine.reservationsBySession.get(`${year}:${clientId}`) || preferredReservationId;
    if (existingResId) {
      const existing = protocolEngine.reservations.get(existingResId);
      if (
        existing &&
        existing.year === year &&
        existing.status === 'RESERVADO' &&
        existing.expiresAt > now
      ) {
        existing.expiresAt = now + RESERVATION_TTL_MS;
        if (unit) existing.unit = unit;
        if (user && user !== 'Sistema') {
          existing.usuario = user;
          existing.user = user;
        }
        scheduleProtocolEnginePersist(year);
        logProtocolStep(traceEnabled, 'reutilizando reserva de sessão ativa', {
          protocolo: existing.protocolo,
          clientId,
          reservationId: existing.reservationId
        });
        return { ...existing, reused: true, tempoTotalMs: +(performance.now() - tReq0).toFixed(2) };
      }
    }
  }

  // Se forceNew ou cancelando anterior da mesma sessão
  if (clientId && (forceNew || previousProtocol)) {
    for (const [rId, r] of protocolEngine.reservations.entries()) {
      if (
        r.clientId === clientId &&
        r.year === year &&
        r.status === 'RESERVADO' &&
        (!previousProtocol || r.protocolo === previousProtocol)
      ) {
        r.status = 'CANCELADO';
        r.expiresAt = now - 1;
      }
    }
  }

  // 2. Alocação atômica estrita (O(1) no event loop - ZERO conflito)
  let curMax = protocolEngine.maxByYear.get(year) || 0;
  curMax++;
  protocolEngine.maxByYear.set(year, curMax);

  const proto = `OC-${year}-${String(curMax).padStart(6, '0')}`;
  const resId = crypto.randomUUID();
  const effectiveSessionId = clientId || resId;
  const isoNow = new Date(now).toISOString();

  const item = {
    id_reserva: resId,
    reservationId: resId,
    numeroProtocolo: proto,
    protocolo: proto,
    id_sequencial: curMax,
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

  protocolEngine.reservations.set(resId, item);
  protocolEngine.reservationsByProtocol.set(proto, resId);
  if (clientId) {
    protocolEngine.reservationsBySession.set(`${year}:${clientId}`, resId);
  }

  scheduleProtocolEnginePersist(year);
  broadcastStorageEvent('protocol_reserved', { protocolo: proto, reservationId: resId, user, unit });
  logProtocolStep(traceEnabled, 'reserva atômica concluída com sucesso', {
    protocolo: proto,
    reservationId: resId,
    tempoMs: +(performance.now() - tReq0).toFixed(2)
  });

  return {
    ...item,
    reused: false,
    tempoTotalMs: +(performance.now() - tReq0).toFixed(2)
  };
}

async function confirmProtocolAtomic(payload) {
  const proto = String(payload.protocolo || payload.numeroProtocolo || '').trim().toUpperCase();
  const user = String(payload.user || payload.usuario || 'Sistema').trim();
  const unit = String(payload.unit || '').trim();
  const clientId = String(payload.clientId || payload.sessionId || '').trim();
  const reservationId = String(payload.reservationId || '').trim();
  const idInterno = String(payload.id_interno || '').trim();
  const markUtilized = Boolean(payload.markUtilized);
  const now = Date.now();
  const isoNow = new Date(now).toISOString();

  const yearMatch = /^OC-(\d{4})-(\d+)$/i.exec(proto);
  const year = yearMatch ? parseInt(yearMatch[1], 10) : (parseInt(payload.year, 10) || new Date().getFullYear());
  const seqNum = yearMatch ? parseInt(yearMatch[2], 10) : 0;

  await ensureProtocolEngineInitialized(year);

  const existingResId = protocolEngine.reservationsByProtocol.get(proto);
  const existingItem = existingResId ? protocolEngine.reservations.get(existingResId) : null;

  const utilizedByOther = existingItem &&
    (existingItem.status === 'UTILIZADO' || existingItem.confirmado) &&
    ((idInterno && existingItem.id_interno && existingItem.id_interno !== idInterno) ||
     (!idInterno && clientId && existingItem.clientId && existingItem.clientId !== clientId) ||
     (reservationId && existingItem.reservationId && existingItem.reservationId !== reservationId));

  const hasConflict = !proto || seqNum <= 0 || utilizedByOther;

  if (hasConflict) {
    let curMax = protocolEngine.maxByYear.get(year) || 0;
    curMax++;
    protocolEngine.maxByYear.set(year, curMax);

    const newProto = `OC-${year}-${String(curMax).padStart(6, '0')}`;
    const newResId = crypto.randomUUID();
    const effectiveSessionId = clientId || newResId;

    const newItem = {
      id_reserva: newResId,
      reservationId: newResId,
      numeroProtocolo: newProto,
      protocolo: newProto,
      id_sequencial: curMax,
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

    protocolEngine.reservations.set(newResId, newItem);
    protocolEngine.reservationsByProtocol.set(newProto, newResId);
    if (clientId) {
      protocolEngine.reservationsBySession.set(`${year}:${clientId}`, newResId);
    }
    scheduleProtocolEnginePersist(year);
    broadcastStorageEvent('protocol_confirmed', { protocolo: newProto, previousProtocol: proto, reallocated: true });

    return {
      ok: true,
      conflict: true,
      conflictResolved: true,
      reallocated: true,
      previousProtocol: proto,
      protocolo: newProto,
      numeroProtocolo: newProto,
      id_sequencial: curMax,
      reservationId: newResId,
      reservation: newItem
    };
  }

  if (existingItem) {
    existingItem.expiresAt = now + RESERVATION_TTL_MS;
    if (idInterno) existingItem.id_interno = idInterno;
    if (clientId) {
      existingItem.clientId = clientId;
      existingItem.sessionId = clientId;
    }
    if (markUtilized) {
      existingItem.status = 'UTILIZADO';
      existingItem.confirmado = true;
      existingItem.dataHoraUtilizacao = isoNow;
      existingItem.confirmedAt = isoNow;
      const curMax = protocolEngine.maxByYear.get(year) || 0;
      if (seqNum > curMax) protocolEngine.maxByYear.set(year, seqNum);
    }
    scheduleProtocolEnginePersist(year);
    broadcastStorageEvent('protocol_confirmed', { protocolo: proto, reallocated: false });
    return {
      ok: true,
      conflict: false,
      conflictResolved: false,
      reallocated: false,
      protocolo: proto,
      numeroProtocolo: proto,
      id_sequencial: existingItem.id_sequencial || seqNum,
      reservationId: existingItem.reservationId,
      reservation: existingItem
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
  const curMax = protocolEngine.maxByYear.get(year) || 0;
  if (seqNum > curMax) protocolEngine.maxByYear.set(year, seqNum);
  protocolEngine.reservations.set(newResId, createdItem);
  protocolEngine.reservationsByProtocol.set(proto, newResId);
  scheduleProtocolEnginePersist(year);
  broadcastStorageEvent('protocol_confirmed', { protocolo: proto, reallocated: false });
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
}

async function releaseProtocolAtomic(payload) {
  const proto = String(payload.protocolo || payload.numeroProtocolo || '').trim().toUpperCase();
  const confirmedUse = Boolean(payload.confirmed || payload.utilized);
  const clientId = String(payload.clientId || payload.sessionId || '').trim();
  const reservationId = String(payload.reservationId || '').trim();
  const idInterno = String(payload.id_interno || '').trim();
  const seqMatch = /^OC-(\d{4})-(\d+)$/i.exec(proto);
  const year = seqMatch ? parseInt(seqMatch[1], 10) : new Date().getFullYear();
  const seqNum = seqMatch ? parseInt(seqMatch[2], 10) : 0;
  const now = Date.now();
  const isoNow = new Date(now).toISOString();

  await ensureProtocolEngineInitialized(year);

  const existingResId = protocolEngine.reservationsByProtocol.get(proto) || reservationId;
  if (existingResId) {
    const existing = protocolEngine.reservations.get(existingResId);
    if (existing) {
      if (confirmedUse) {
        existing.status = 'UTILIZADO';
        existing.confirmado = true;
        existing.dataHoraUtilizacao = isoNow;
        existing.confirmedAt = isoNow;
        if (idInterno) existing.id_interno = idInterno;
        const curMax = protocolEngine.maxByYear.get(year) || 0;
        if (seqNum > curMax) protocolEngine.maxByYear.set(year, seqNum);
      } else {
        if (!clientId || existing.clientId === clientId || !reservationId || existing.reservationId === reservationId) {
          existing.status = 'CANCELADO';
          existing.expiresAt = now - 1;
        }
      }
      scheduleProtocolEnginePersist(year);
    }
  }
  return { ok: true, released: proto };
}

async function renewProtocolAtomic(payload) {
  const proto = String(payload.protocolo || payload.numeroProtocolo || '').trim().toUpperCase();
  const clientId = String(payload.clientId || payload.sessionId || '').trim();
  const reservationId = String(payload.reservationId || '').trim();
  const seqMatch = /^OC-(\d{4})-(\d+)$/i.exec(proto);
  const year = seqMatch ? parseInt(seqMatch[1], 10) : new Date().getFullYear();
  const now = Date.now();

  await ensureProtocolEngineInitialized(year);

  const existingResId = protocolEngine.reservationsByProtocol.get(proto) || reservationId;
  if (!existingResId) {
    return { ok: false, conflict: true, reason: 'RESERVATION_NOT_ACTIVE' };
  }
  const target = protocolEngine.reservations.get(existingResId);
  if (!target || target.status !== 'RESERVADO') {
    return { ok: false, conflict: true, reason: 'RESERVATION_NOT_ACTIVE' };
  }
  target.expiresAt = now + RESERVATION_TTL_MS;
  scheduleProtocolEnginePersist(year);
  return { ok: true, conflict: false, expiresAt: target.expiresAt, reservation: target };
}

async function withProtocolControlLock(owner, clientId, operation, traceEnabled = false) {
  return await operation();
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
  const now = Date.now();
  // Mantém reservas ativas, utilizadas ou criadas nas últimas 2 horas
  const activeOrRecent = (Array.isArray(list) ? list : []).filter(r => {
    if (!r) return false;
    if (r.status === 'UTILIZADO' || r.status === 'CONFIRMADO') return true;
    if (r.status === 'RESERVADO' && r.expiresAt > now) return true;
    if (r.createdAt && now - r.createdAt < 2 * 60 * 60 * 1000) return true;
    return false;
  });
  const payload = Buffer.from(JSON.stringify(activeOrRecent, null, 2), 'utf8');
  await atomicWriteFile(RESERVATIONS_FILE, payload);
  return activeOrRecent;
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
  await fs.mkdir(DADOS_DIR, { recursive: true });

  const entries = await fs.readdir(DADOS_DIR, { withFileTypes: true });
  const occNames = [];
  for (const e of entries) {
    if (e.isFile() && isIndividualOccurrenceFile(e.name)) {
      occNames.push(e.name);
    }
  }
  occNames.sort();

  const filesToScan = ['ocorrencias.csv', 'registros_apagados.csv'];
  let combinedSig = `INDIV:${occNames.length}:${occNames[0] || ''}:${occNames[occNames.length - 1] || ''}:`;
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
    ocorrenciasProtocolCache.byYear &&
    ocorrenciasProtocolCache.byYear.has(year)
  ) {
    return new Set(ocorrenciasProtocolCache.byYear.get(year));
  }

  const used = new Set();
  const regex = new RegExp(`OC-${year}-(\\d{1,8})`, 'gi');
  const fileNameProtoRegex = new RegExp(`OC-${year}-(\\d{1,8})`, 'i');

  for (const fileName of occNames) {
    const nameMatch = fileNameProtoRegex.exec(fileName);
    if (nameMatch) {
      const num = parseInt(nameMatch[1], 10);
      if (!isNaN(num) && num > 0) {
        used.add(num);
      }
    }
  }

  // Lê apenas arquivos consolidados stats (ocorrencias.csv e registros_apagados.csv) com regex ultrarrápida
  for (const item of stats) {
    if (item.size <= 0) continue;
    try {
      const raw = await fs.readFile(item.path, 'utf8');
      let m;
      regex.lastIndex = 0;
      while ((m = regex.exec(raw)) !== null) {
        const num = parseInt(m[1], 10);
        if (!isNaN(num) && num > 0) used.add(num);
      }
    } catch {}
  }

  if (ocorrenciasProtocolCache.sig !== combinedSig) {
    ocorrenciasProtocolCache = {
      mtimeMs: stats[0]?.mtimeMs || 0,
      size: occNames.length || stats[0]?.size || 0,
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
        pathname !== '/bundle' &&
        pathname !== '/api/storage/bundle' &&
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

      if (req.method === 'GET' && (pathname === '/bundle' || pathname === '/api/storage/bundle')) {
        await fs.mkdir(DADOS_DIR, { recursive: true });
        await fs.mkdir(path.resolve(DADOS_DIR, 'anexos'), { recursive: true }).catch(() => {});

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

        const effectiveOccSig = legacySize > 0
          ? `${batchInfo.sig}:L:${legacySize}:${Math.round(legacyMtime)}`
          : batchInfo.sig;
        const effectiveOccTotalSize = batchInfo.totalSize + legacySize;
        const effectiveOccMaxMtime = Math.max(batchInfo.maxMtimeMs, legacyMtime);

        const standardFiles = [
          'usuarios.csv',
          'chaves.csv',
          'movimentacao_chaves.csv',
          'historico_sistema.csv',
          'supervisoes_unidades.csv',
          'naturezas_ocorrencias.csv',
          'inspecao_fumaca_preta.csv',
          'registros_apagados.csv'
        ];

        const filesData = {};
        const sigParts = [effectiveOccSig];

        await Promise.all(standardFiles.map(async (fileName) => {
          const fullPath = path.resolve(DADOS_DIR, fileName);
          try {
            const st = await fs.stat(fullPath);
            if (st.isFile()) {
              sigParts.push(`${fileName}:${st.size}:${Math.round(st.mtimeMs)}`);
            }
          } catch {}
        }));

        const bundleSig = sigParts.join('|');

        if (knownSig && knownSig === bundleSig) {
          const respBuf = Buffer.from(JSON.stringify({
            ok: true,
            unchanged: true,
            sig: bundleSig
          }), 'utf8');
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Content-Length', String(respBuf.length));
          res.end(respBuf);
          return;
        }

        await Promise.all(standardFiles.map(async (fileName) => {
          const fullPath = path.resolve(DADOS_DIR, fileName);
          try {
            const st = await fs.stat(fullPath);
            if (st.isFile()) {
              const rawText = await fs.readFile(fullPath, 'utf8');
              filesData[fileName] = {
                name: fileName,
                rawText,
                size: st.size,
                mtimeMs: st.mtimeMs
              };
            }
          } catch {}
        }));

        const loadedOccFiles = [];
        const chunkSize = 512;
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
            if (item && item.rawText) loadedOccFiles.push(item);
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
          sig: bundleSig,
          files: filesData,
          occurrencesBatch: {
            sig: effectiveOccSig,
            count: loadedOccFiles.length,
            totalSize: effectiveOccTotalSize,
            maxMtimeMs: effectiveOccMaxMtime,
            files: loadedOccFiles,
            legacyRawText
          }
        }), 'utf8');

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Length', String(respPayload.length));
        res.end(respPayload);
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
        const chunkSize = 512;
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

      // Server-Sent Events (SSE) para Notificações em Tempo Real (< 50ms)
      if (pathname === '/events' || pathname === '/api/storage/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*'
        });
        res.write(': sse connected\n\n');
        sseClients.add(res);
        req.on('close', () => {
          sseClients.delete(res);
        });
        return;
      }

      // Endpoints de Reserva e Confirmação Centralizada de Protocolo (Concorrência Multiusuário Instantânea)
      if (pathname === '/protocol/reserve' || pathname === '/api/storage/protocol/reserve') {
        const bodyBuf = await readRawBody(req);
        let payload = {};
        try { payload = JSON.parse(bodyBuf.toString('utf8')); } catch {}
        const reservation = await reserveProtocolAtomic(payload);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: true, ...reservation, reservation }));
        return;
      }

      if (pathname === '/protocol/confirm' || pathname === '/api/storage/protocol/confirm') {
        const bodyBuf = await readRawBody(req);
        let payload = {};
        try { payload = JSON.parse(bodyBuf.toString('utf8')); } catch {}
        const result = await confirmProtocolAtomic(payload);
        res.statusCode = result.ok ? 200 : 409;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(result));
        return;
      }

      if (pathname === '/protocol/release' || pathname === '/api/storage/protocol/release') {
        const bodyBuf = await readRawBody(req);
        let payload = {};
        try { payload = JSON.parse(bodyBuf.toString('utf8')); } catch {}
        const result = await releaseProtocolAtomic(payload);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(result));
        return;
      }

      if (pathname === '/protocol/renew' || pathname === '/api/storage/protocol/renew') {
        const bodyBuf = await readRawBody(req);
        let payload = {};
        try { payload = JSON.parse(bodyBuf.toString('utf8')); } catch {}
        const result = await renewProtocolAtomic(payload);
        res.statusCode = result.ok ? 200 : 409;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(result));
        return;
      }

      if (pathname === '/protocol/list' || pathname === '/api/storage/protocol/list') {
        const year = parseInt(url.searchParams.get('year') || '', 10) || new Date().getFullYear();
        await ensureProtocolEngineInitialized(year);
        const list = Array.from(protocolEngine.reservations.values()).filter(r => Number(r.year) === year);
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

        broadcastStorageEvent('storage_mutation', {
          action: 'put',
          fileName: baseNameLower,
          isOccurrence: isOccTarget,
          mtimeMs: stat.mtimeMs,
          size: stat.size,
          protocol: releasedHeader || null,
          rawText: isOccTarget && buffer.length < 131072 ? buffer.toString('utf8') : undefined
        });

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

        const baseNameAppend = path.basename(target).toLowerCase();
        const isOccAppend = baseNameAppend === 'ocorrencias.csv' || isIndividualOccurrenceFile(baseNameAppend);
        broadcastStorageEvent('storage_mutation', {
          action: 'append',
          fileName: baseNameAppend,
          isOccurrence: isOccAppend,
          mtimeMs: stat.mtimeMs,
          size: stat.size,
          protocol: protoToRelease || null,
          rawText: isOccAppend && chunk.length < 131072 ? chunkStr : undefined
        });

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
        broadcastStorageEvent('storage_mutation', {
          action: 'delete',
          fileName: baseNameLower
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
