const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const http = require('http');

const SYSTEM_MASTER_SECRET = 'SIGESP_ENTERPRISE_SYSTEM_SECRET_KEY_v1_SECURE_2026';
const DADOS_DIR = path.resolve(__dirname, 'dados');
const OCORRENCIAS_FILE = path.join(DADOS_DIR, 'ocorrencias.csv');
const COUNTER_FILE = path.join(DADOS_DIR, 'protocolo_contador.json');

function decryptSingleEnvelope(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed.startsWith('SIGESP_ENC_v1:')) return '';
  const jsonStr = trimmed.slice('SIGESP_ENC_v1:'.length);
  const envelope = JSON.parse(jsonStr);
  const salt = Buffer.from(envelope.salt, 'base64');
  const key = crypto.pbkdf2Sync(SYSTEM_MASTER_SECRET, salt, 100000, 32, 'sha256');
  const iv = Buffer.from(envelope.iv, 'base64');
  const ctAndTag = Buffer.from(envelope.ct, 'base64');
  const tag = ctAndTag.subarray(ctAndTag.length - 16);
  const ct = ctAndTag.subarray(0, ctAndTag.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  let dec = decipher.update(ct, null, 'utf8');
  dec += decipher.final('utf8');
  return dec;
}

function parseCsvLine(line, delimiter = ';') {
  const result = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === delimiter && !inQuotes) {
      result.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  result.push(cur);
  return result;
}

async function requestHttp(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, rawData: data });
        }
      });
    });
    req.on('error', reject);
    if (postData) {
      req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

async function runVerification() {
  console.log('=== TESTE DE INTEGRIDADE E COMPATIBILIDADE - 30.000 OCORRÊNCIAS ===');

  // 1. Descriptografia e contagem
  console.log('\n[1/5] Verificando integridade física e criptográfica de ocorrencias.csv...');
  const t0 = Date.now();
  const raw = fs.readFileSync(OCORRENCIAS_FILE, 'utf8');
  console.log(`Arquivo lido em ${Date.now() - t0}ms. Tamanho: ${(Buffer.byteLength(raw) / (1024 * 1024)).toFixed(2)} MB`);
  
  const tDec0 = Date.now();
  const dec = decryptSingleEnvelope(raw);
  console.log(`Descriptografado com AES-GCM 256 bits em ${Date.now() - tDec0}ms!`);

  const lines = dec.split(/\r?\n/).filter(Boolean);
  console.log(`Total de linhas obtidas: ${lines.length}`);
  if (lines.length !== 30001) {
    throw new Error(`Esperado 30001 linhas (1 cabeçalho + 30000 ocorrências), obtido: ${lines.length}`);
  }

  const header = parseCsvLine(lines[0].replace(/^\ufeff/, ''));
  console.log(`Cabeçalho validado: ${header.length} colunas.`);

  // 2. Unicidade e integridade dos campos
  console.log('\n[2/5] Validando integridade de colunas, unicidade de IDs e protocolos...');
  const idSet = new Set();
  const uuidSet = new Set();
  const protoSet = new Set();
  let malformedCount = 0;

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (cols.length !== 36) {
      malformedCount++;
      if (malformedCount <= 3) console.error(`Linha ${i} possui ${cols.length} colunas.`);
    }

    const id = cols[0];
    const uuid = cols[1];
    const proto = cols[2];

    if (idSet.has(id)) {
      throw new Error(`ID duplicado detectado: ${id} na linha ${i}`);
    }
    idSet.add(id);

    if (uuidSet.has(uuid)) {
      throw new Error(`UUID duplicado detectado: ${uuid} na linha ${i}`);
    }
    uuidSet.add(uuid);

    if (protoSet.has(proto)) {
      throw new Error(`Protocolo duplicado detectado: ${proto} na linha ${i}`);
    }
    protoSet.add(proto);
  }

  if (malformedCount > 0) {
    throw new Error(`Total de linhas com colunas incorretas: ${malformedCount}`);
  }

  console.log(`Sucesso: 30.000 IDs únicos (de ${Math.min(...Array.from(idSet).map(Number))} a ${Math.max(...Array.from(idSet).map(Number))})`);
  console.log(`Sucesso: 30.000 Protocolos únicos (Primeiro: ${lines[1].split(';')[2]} | Último: ${lines[lines.length - 1].split(';')[2]})`);
  console.log(`Sucesso: 30.000 UUIDs únicos`);

  // 3. Contador de protocolos
  console.log('\n[3/5] Validando arquivo de contador de protocolos...');
  const counterRaw = fs.readFileSync(COUNTER_FILE, 'utf8');
  const counter = JSON.parse(counterRaw);
  console.log('Conteúdo do contador:', counter);
  if (counter['2026'] !== 30000 || counter.lastSeq !== 30000) {
    throw new Error(`Contador não está em 30000: ${counterRaw}`);
  }

  // 4. Teste de Endpoint Batch do Servidor
  console.log('\n[4/5] Testando endpoint /api/storage/occurrences/batch...');
  const batchRes = await requestHttp({
    hostname: 'localhost',
    port: 3000,
    path: '/api/storage/occurrences/batch',
    method: 'GET'
  });
  console.log(`Endpoint batch respondeu com status: ${batchRes.status}`);
  if (batchRes.status !== 200 || !batchRes.data?.ok) {
    throw new Error(`Endpoint batch falhou: ${JSON.stringify(batchRes)}`);
  }
  console.log(`Batch sig: ${batchRes.data.sig}, totalSize: ${(batchRes.data.totalSize / (1024 * 1024)).toFixed(2)} MB`);

  // 5. Teste de Concorrência Multi-Usuário de Reserva de Protocolo
  console.log('\n[5/5] Testando reserva de protocolo concorrente multi-usuário (simulação de 10 usuários simultâneos)...');
  const concurrentPromises = [];
  for (let u = 1; u <= 10; u++) {
    const payload = {
      usuario: `operador_${u}`,
      clientId: `client_session_${u}_${Date.now()}`,
      year: 2026,
      id_interno: crypto.randomUUID()
    };
    concurrentPromises.push(requestHttp({
      hostname: 'localhost',
      port: 3000,
      path: '/api/storage/protocol/reserve',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, payload));
  }

  const results = await Promise.all(concurrentPromises);
  const reservedProtocols = [];
  for (const r of results) {
    if (r.status !== 200 || !r.data?.numeroProtocolo) {
      throw new Error(`Falha na reserva concorrente: ${JSON.stringify(r)}`);
    }
    reservedProtocols.push(r.data.numeroProtocolo);
  }

  console.log('Protocolos reservados simultaneamente:', reservedProtocols);
  const reservedSet = new Set(reservedProtocols);
  if (reservedSet.size !== 10) {
    throw new Error('Colisão detectada na reserva simultânea de protocolos!');
  }

  // Verificar que os protocolos atribuídos são estritamente sequenciais começando em OC-2026-030001
  const sortedSeq = reservedProtocols.map(p => parseInt(p.replace('OC-2026-', ''), 10)).sort((a, b) => a - b);
  console.log('Sequência atribuída ordenada:', sortedSeq);
  if (sortedSeq[0] !== 30001 || sortedSeq[9] !== 30010) {
    throw new Error(`Sequência esperada 30001 a 30010, obtido: ${sortedSeq[0]} a ${sortedSeq[9]}`);
  }

  // Cancelar as 10 reservas de teste para restaurar o estado limpo
  console.log('Liberando reservas de teste...');
  for (const r of results) {
    const resId = r.data.reservationId || r.data.id_reserva;
    if (resId) {
      await requestHttp({
        hostname: 'localhost',
        port: 3000,
        path: '/api/storage/protocol/cancel',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, {
        reservationId: resId,
        numeroProtocolo: r.data.numeroProtocolo,
        usuario: 'admin'
      });
    }
  }

  // Restaurar contador para 30000 e reservas para []
  fs.writeFileSync(COUNTER_FILE, JSON.stringify({
    "2026": 30000,
    "year": 2026,
    "lastSeq": 30000,
    "ultimoProtocoloConfirmado": "OC-2026-030000",
    "updatedAt": new Date().toISOString()
  }, null, 2), 'utf8');
  fs.writeFileSync(path.join(DADOS_DIR, 'reservas_protocolos.json'), '[]\n', 'utf8');

  console.log('\n============================================================');
  console.log('TODAS AS 5 ETAPAS DE VERIFICAÇÃO PASSARAM COM 100% DE SUCESSO!');
  console.log('============================================================');
}

runVerification().catch(err => {
  console.error('ERRO NO TESTE DE VERIFICAÇÃO:', err);
  process.exit(1);
});
