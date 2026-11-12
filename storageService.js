/**
 * SIGESP — StorageService
 * Camada centralizada de persistência e orquestração de dados criptografados.
 * Nenhuma leitura ou gravação de arquivos de dados deve contornar esta camada.
 * Padrão SecDevOps: Código defensivo, integridade autenticada e auditoria imediata pós-gravação.
 */
'use strict';

const StorageService = (() => {
  // Catálogo canônico de recuperação de integridade (resiliência corporativa)
  const CANONICAL_SEEDS = {
    'usuarios.csv': {
      headers: ['id_usuario', 'nome', 'login', 'senha_hash', 'perfil', 'unidades_permitidas', 'supervisao_id', 'status', 'data_criacao', 'ultimo_acesso', 'versao_registro', 'data_atualizacao', 'usuario_ultima_alteracao'],
      rows: [
        { id_usuario: 'U1', nome: 'Administrador Homologação', login: 'admin', senha_hash: '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9', perfil: 'Administrador', unidades_permitidas: '*', supervisao_id: '', status: 'Ativo', data_criacao: '2026-10-15T08:00:00-03:00', ultimo_acesso: '', versao_registro: '1', data_atualizacao: '2026-10-15T08:00:00-03:00', usuario_ultima_alteracao: 'Sistema' },
        { id_usuario: 'U2', nome: 'Carlos Supervisor', login: 'supervisor', senha_hash: '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9', perfil: 'Supervisor', unidades_permitidas: '', supervisao_id: 'e0098929-390d-494e-8d7d-632e581ecf7b', status: 'Ativo', data_criacao: '2026-10-15T08:00:00-03:00', ultimo_acesso: '', versao_registro: '1', data_atualizacao: '2026-10-15T08:00:00-03:00', usuario_ultima_alteracao: 'admin' },
        { id_usuario: 'U3', nome: 'Marcos Líder Operacional', login: 'lider', senha_hash: '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9', perfil: 'Líder', unidades_permitidas: 'ead8a31c-2697-4ff0-b7f3-ed1a6dda62e3|c952f09f-1c75-4d1e-a23a-a55ff6dcb21f', supervisao_id: 'e0098929-390d-494e-8d7d-632e581ecf7b', status: 'Ativo', data_criacao: '2026-10-15T08:00:00-03:00', ultimo_acesso: '', versao_registro: '1', data_atualizacao: '2026-10-15T08:00:00-03:00', usuario_ultima_alteracao: 'admin' },
        { id_usuario: 'U4', nome: 'João Operador Portaria', login: 'operador', senha_hash: '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9', perfil: 'Operador', unidades_permitidas: 'ead8a31c-2697-4ff0-b7f3-ed1a6dda62e3', supervisao_id: 'e0098929-390d-494e-8d7d-632e581ecf7b', status: 'Ativo', data_criacao: '2026-10-15T08:00:00-03:00', ultimo_acesso: '', versao_registro: '1', data_atualizacao: '2026-10-15T08:00:00-03:00', usuario_ultima_alteracao: 'admin' }
      ]
    },
    'supervisoes.csv': {
      headers: ['id_supervisao', 'nome'],
      rows: [
        { id_supervisao: 'e0098929-390d-494e-8d7d-632e581ecf7b', nome: 'DISTRIBUIÇÃO' },
        { id_supervisao: 'f1098929-390d-494e-8d7d-632e581ecf8c', nome: 'OPERAÇÕES INDUSTRIAIS' }
      ]
    },
    'unidades.csv': {
      headers: ['id_unidade', 'nome', 'id_supervisao'],
      rows: [
        { id_unidade: 'ead8a31c-2697-4ff0-b7f3-ed1a6dda62e3', nome: 'Mogi das Cruzes', id_supervisao: 'e0098929-390d-494e-8d7d-632e581ecf7b' },
        { id_unidade: 'c952f09f-1c75-4d1e-a23a-a55ff6dcb21f', nome: 'Valença', id_supervisao: 'e0098929-390d-494e-8d7d-632e581ecf7b' },
        { id_unidade: '66b2a9bc-bef9-462d-9dd6-30f785aa5e38', nome: 'CSN - CAMAÇARI', id_supervisao: 'e0098929-390d-494e-8d7d-632e581ecf7b' },
        { id_unidade: '77b2a9bc-bef9-462d-9dd6-30f785aa5e49', nome: 'Usina Presidente Vargas', id_supervisao: 'f1098929-390d-494e-8d7d-632e581ecf8c' }
      ]
    },
    'supervisoes_unidades.csv': {
      headers: ['tipo', 'id', 'nome', 'supervisao_id', 'ativo', 'aliases'],
      rows: [
        { tipo: 'SUPERVISAO', id: 'e0098929-390d-494e-8d7d-632e581ecf7b', nome: 'DISTRIBUIÇÃO', supervisao_id: '', ativo: '1', aliases: '[]' },
        { tipo: 'SUPERVISAO', id: 'f1098929-390d-494e-8d7d-632e581ecf8c', nome: 'OPERAÇÕES INDUSTRIAIS', supervisao_id: '', ativo: '1', aliases: '[]' },
        { tipo: 'UNIDADE', id: 'ead8a31c-2697-4ff0-b7f3-ed1a6dda62e3', nome: 'Mogi das Cruzes', supervisao_id: 'e0098929-390d-494e-8d7d-632e581ecf7b', ativo: '1', aliases: '[]' },
        { tipo: 'UNIDADE', id: 'c952f09f-1c75-4d1e-a23a-a55ff6dcb21f', nome: 'Valença', supervisao_id: 'e0098929-390d-494e-8d7d-632e581ecf7b', ativo: '1', aliases: '[]' },
        { tipo: 'UNIDADE', id: '66b2a9bc-bef9-462d-9dd6-30f785aa5e38', nome: 'CSN - CAMAÇARI', supervisao_id: 'e0098929-390d-494e-8d7d-632e581ecf7b', ativo: '1', aliases: '[]' },
        { tipo: 'UNIDADE', id: '77b2a9bc-bef9-462d-9dd6-30f785aa5e49', nome: 'Usina Presidente Vargas', supervisao_id: 'f1098929-390d-494e-8d7d-632e581ecf8c', ativo: '1', aliases: '[]' }
      ]
    },
    'naturezas_ocorrencias.csv': {
      headers: ['id_natureza', 'nome', 'ativo', 'aliases'],
      rows: [
        { id_natureza: 'nat-01', nome: 'Portaria', ativo: '1', aliases: '[]' },
        { id_natureza: 'nat-02', nome: 'Acesso Indevido', ativo: '1', aliases: '[]' },
        { id_natureza: 'nat-03', nome: 'Furto / Tentativa', ativo: '1', aliases: '[]' },
        { id_natureza: 'nat-04', nome: 'Dano ao Patrimônio', ativo: '1', aliases: '[]' },
        { id_natureza: 'nat-05', nome: 'Averiguação Preventiva', ativo: '1', aliases: '[]' },
        { id_natureza: 'nat-06', nome: 'Acidente Sem Vítima', ativo: '1', aliases: '[]' },
        { id_natureza: 'nat-07', nome: 'Inspeção de Segurança', ativo: '1', aliases: '[]' },
        { id_natureza: 'nat-08', nome: 'Descumprimento de Norma', ativo: '1', aliases: '[]' }
      ]
    },
    'chaves.csv': {
      headers: ['id_chave', 'codigo', 'descricao', 'setor', 'unidade', 'status', 'observacoes', 'versao_registro', 'data_atualizacao', 'usuario_ultima_alteracao'],
      rows: [
        { id_chave: 'key-01', codigo: 'CH-MC-01', descricao: 'Porta Principal Almoxarifado', setor: 'Almoxarifado', unidade: 'Mogi das Cruzes', status: 'Disponível', observacoes: 'Chave mola dupla', versao_registro: '1', data_atualizacao: '2026-10-15T08:00:00Z', usuario_ultima_alteracao: 'admin' },
        { id_chave: 'key-02', codigo: 'CH-MC-02', descricao: 'Subestação Elétrica 01', setor: 'Manutenção Elétrica', unidade: 'Mogi das Cruzes', status: 'Retirada', observacoes: 'Acesso restrito para eletricistas credenciados', versao_registro: '1', data_atualizacao: '2026-10-16T09:00:00Z', usuario_ultima_alteracao: 'admin' },
        { id_chave: 'key-03', codigo: 'CH-VAL-01', descricao: 'Sala de TI e Servidores', setor: 'Tecnologia da Informação', unidade: 'Valença', status: 'Disponível', observacoes: 'Retirada sob autorização do coordenador', versao_registro: '1', data_atualizacao: '2026-10-15T08:00:00Z', usuario_ultima_alteracao: 'admin' }
      ]
    },
    'movimentacao_chaves.csv': {
      headers: ['id_movimento', 'id_chave', 'codigo_chave', 'tipo_movimento', 'retirante', 'matricula_documento', 'data_hora_retirada', 'data_hora_devolucao', 'observacoes', 'usuario_registro', 'versao_registro', 'data_atualizacao'],
      rows: [
        { id_movimento: 'mov-01', id_chave: 'key-02', codigo_chave: 'CH-MC-02', tipo_movimento: 'Retirada', retirante: 'Carlos Silva', matricula_documento: 'MT-5541', data_hora_retirada: '2026-10-16T09:00:00Z', data_hora_devolucao: '', observacoes: 'Manutenção preventiva no painel de comando', usuario_registro: 'admin', versao_registro: '1', data_atualizacao: '2026-10-16T09:00:00Z' }
      ]
    },
    'ocorrencias.csv': {
      headers: ['id_ocorrencia', 'id_interno', 'numero_protocolo', 'data_ocorrencia', 'hora_ocorrencia', 'gerencia', 'supervisao', 'unidade', 'area', 'local_especifico', 'natureza_ocorrencia', 'tipo_vinculo', 'nome_envolvido', 'empresa_envolvido', 'matricula_id', 'telefone', 'documento', 'placa_veiculo', 'gerencia_envolvido', 'gerencia_geral', 'diretoria', 'relato_detalhado', 'providencias_adotadas', 'prioridade', 'status', 'anexos_referencias', 'responsavel_registro', 'perfil_registro', 'data_registro', 'versao_registro', 'usuario_ultima_alteracao', 'status_validacao', 'data_envio_validacao', 'validado_por', 'data_validacao', 'observacao_validacao', 'status_apuracao', 'apuracao_notas', 'apuracao_conclusao', 'apuracao_plano_acao', 'apuracao_responsavel', 'apuracao_data'],
      rows: []
    },
    'ocorrencias_pendentes.csv': {
      headers: ['id_ocorrencia', 'id_interno', 'numero_protocolo', 'data_ocorrencia', 'hora_ocorrencia', 'gerencia', 'supervisao', 'unidade', 'area', 'local_especifico', 'natureza_ocorrencia', 'tipo_vinculo', 'nome_envolvido', 'empresa_envolvido', 'matricula_id', 'telefone', 'documento', 'placa_veiculo', 'gerencia_envolvido', 'gerencia_geral', 'diretoria', 'relato_detalhado', 'providencias_adotadas', 'prioridade', 'status', 'anexos_referencias', 'responsavel_registro', 'perfil_registro', 'data_registro', 'versao_registro', 'usuario_ultima_alteracao', 'status_validacao', 'data_envio_validacao', 'validado_por', 'data_validacao', 'observacao_validacao', 'status_apuracao', 'apuracao_notas', 'apuracao_conclusao', 'apuracao_plano_acao', 'apuracao_responsavel', 'apuracao_data'],
      rows: []
    },
    'inspecao_fumaca_preta.csv': {
      headers: ['id', 'data', 'realizar_monitoramento', 'motivo_nao_execucao', 'placa', 'transportadora', 'nota', 'laudo', 'observacao', 'responsavel', 'matricula_responsavel', 'usuario_registro', 'data_hora_registro', 'data_hora_alteracao', 'alterado_por', 'unidade', 'supervisao'],
      rows: [
        { id: 'amb-01', data: '2026-10-16', realizar_monitoramento: 'Sim', motivo_nao_execucao: '', placa: 'ABC-1234', transportadora: 'TransVale Cargas', nota: '2.0', laudo: 'Aprovado', observacao: 'Escala Ringelmann padrão 1 (20% opacidade). Veículo operando dentro dos padrões ambientais normativos.', responsavel: 'Administrador Homologação', matricula_responsavel: '', usuario_registro: 'admin', data_hora_registro: '2026-10-16T11:00:00Z', data_hora_alteracao: '', alterado_por: '', unidade: 'Mogi das Cruzes', supervisao: 'DISTRIBUIÇÃO' },
        { id: 'amb-02', data: '2026-10-15', realizar_monitoramento: 'Sim', motivo_nao_execucao: '', placa: 'XYZ-9876', transportadora: 'Rápido Sudeste Ltda', nota: '3.5', laudo: 'Reprovado', observacao: 'Emissão contínua de fumaça densa atingindo padrão 3 da escala Ringelmann. Notificado condutor.', responsavel: 'Administrador Homologação', matricula_responsavel: '', usuario_registro: 'admin', data_hora_registro: '2026-10-15T15:20:00Z', data_hora_alteracao: '', alterado_por: '', unidade: 'Valença', supervisao: 'DISTRIBUIÇÃO' },
        { id: 'amb-03', data: '2026-10-14', realizar_monitoramento: 'Não', motivo_nao_execucao: 'Condição climática adversa / dia nublado / chuva', placa: '', transportadora: '', nota: '', laudo: '', observacao: '', responsavel: 'Administrador Homologação', matricula_responsavel: '', usuario_registro: 'admin', data_hora_registro: '2026-10-14T14:00:00Z', data_hora_alteracao: '', alterado_por: '', unidade: 'CSN - CAMAÇARI', supervisao: 'DISTRIBUIÇÃO' }
      ]
    },
    'historico_sistema.csv': {
      headers: ['id_auditoria', 'data_hora', 'usuario', 'perfil', 'modulo', 'acao', 'id_registro', 'codigo_registro', 'detalhes'],
      rows: [
        { id_auditoria: '8b764bea-878a-4e6a-bf69-d3e89229598b', data_hora: '2026-10-16T16:22:08.876Z', usuario: 'admin', perfil: 'Administrador', modulo: 'ORGANIZACAO', acao: 'UNIDADE_CADASTRADA', id_registro: '66b2a9bc-bef9-462d-9dd6-30f785aa5e38', codigo_registro: 'CSN - CAMAÇARI', detalhes: 'CSN - CAMAÇARI' },
        { id_auditoria: 'ef1c9d5f-790c-43a2-ad4b-f762b29c4acd', data_hora: '2026-10-16T16:21:52.733Z', usuario: 'admin', perfil: 'Administrador', modulo: 'ORGANIZACAO', acao: 'SUPERVISAO_CADASTRADA', id_registro: 'e0098929-390d-494e-8d7d-632e581ecf7b', codigo_registro: 'DISTRIBUIÇÃO', detalhes: 'DISTRIBUIÇÃO' }
      ]
    },
    'registros_apagados.csv': {
      headers: ['id_exclusao', 'modulo_origem', 'data_hora_exclusao', 'administrador', 'id_registro', 'codigo_registro', 'dados_originais', 'motivo_exclusao'],
      rows: []
    }
  };

  // Mutex e fila de escrita serializada (Write Queue) para exclusão mútua em nível de arquivo
  const storageLocks = new Map();
  const _activeLocks = new Set();
  // Cache volátil em memória do texto criptografado -> linhas consolidadas
  const _rawFileCache = new Map();
  // Cache individual por arquivo de ocorrência (fileName -> { rawSig, mtimeMs, size, rows })
  const _individualOccFileCache = new Map();
  // Mapa de chave canônica de ocorrência -> nome do arquivo individual atual no disco
  const _recordKeyToFileMap = new Map();
  // Tombstones de ocorrências excluídas para evitar ressuscitação durante sincronizações concorrentes
  const _deletedOccurrencesTombstones = new Map();
  // Mapa de validações ativas recentes para proteger o estado contra sobrescrita por leituras do disco em trânsito
  const _pendingValidationsMap = new Map();
  let _lastKnownBatchSig = '';
  let _lastKnownBundleSig = '';
  let _preloadedOccurrencesBatch = null;
  let _clientSessionId = null;
  let _legacyDiskSyncTimer = null;
  let _legacyDiskSyncPromise = Promise.resolve();

  function isTombstonedOccurrence(record) {
    if (!record || typeof record !== 'object') return false;
    const now = Date.now();
    const idInt = String(record.id_interno || '').trim().toUpperCase();
    const idOcc = String(record.id_ocorrencia || '').trim().toUpperCase();
    const proto = String(record.numero_protocolo || '').trim().toUpperCase();

    const keys = [idInt, idOcc, proto].filter(Boolean);
    for (const k of keys) {
      const exp = _deletedOccurrencesTombstones.get(k);
      if (exp) {
        if (now < exp) return true;
        _deletedOccurrencesTombstones.delete(k);
      }
    }
    return false;
  }

  function addOccurrenceTombstone(idOrProto, ttlMs = 3600000) {
    if (!idOrProto) return;
    const norm = String(idOrProto).trim().toUpperCase();
    const clean = norm.replace(/[^A-Z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    const exp = Date.now() + ttlMs;
    _deletedOccurrencesTombstones.set(norm, exp);
    if (clean) _deletedOccurrencesTombstones.set(clean, exp);
  }

  function registerPendingValidation(record, ttlMs = 120000) {
    if (!record || typeof record !== 'object') return;
    const exp = Date.now() + ttlMs;
    const proto = String(record.numero_protocolo || '').trim().toUpperCase();
    const occ = String(record.id_ocorrencia || '').trim().toUpperCase();
    const idInt = String(record.id_interno || '').trim().toUpperCase();
    const entry = { record: { ...record }, expiresAt: exp };
    if (proto) _pendingValidationsMap.set(`PROTO:${proto}`, entry);
    if (occ) _pendingValidationsMap.set(`OCC:${occ}`, entry);
    if (idInt) _pendingValidationsMap.set(`INT:${idInt}`, entry);
  }

  function getActivePendingValidation(record) {
    if (!record) return null;
    const now = Date.now();
    let keys = [];
    if (typeof record === 'string') {
      const norm = record.trim().toUpperCase();
      keys = [`PROTO:${norm}`, `OCC:${norm}`, `INT:${norm}`, norm];
    } else if (typeof record === 'object') {
      const proto = String(record.numero_protocolo || '').trim().toUpperCase();
      const occ = String(record.id_ocorrencia || '').trim().toUpperCase();
      const idInt = String(record.id_interno || '').trim().toUpperCase();
      keys = [
        idInt ? `INT:${idInt}` : '',
        occ ? `OCC:${occ}` : '',
        proto ? `PROTO:${proto}` : ''
      ].filter(Boolean);
    }
    for (const k of keys) {
      const entry = _pendingValidationsMap.get(k);
      if (entry) {
        if (now < entry.expiresAt) return entry.record;
        _pendingValidationsMap.delete(k);
      }
    }
    return null;
  }

  function isIndividualOccurrenceFileName(fileName) {
    return /^(?:ocorrencia_).+\.csv$/i.test(String(fileName || '').trim());
  }

  function getIndividualOccurrenceFileName(record) {
    if (!record || typeof record !== 'object') {
      return `ocorrencia_${Date.now()}.csv`;
    }
    const rawIdentifier = String(
      record.numero_protocolo ||
      record.id_ocorrencia ||
      record.id_interno ||
      generateUUID()
    ).trim();
    const safeId = rawIdentifier.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || String(Date.now());
    return `ocorrencia_${safeId}.csv`;
  }

  function perfStart(label) {
    if (typeof window !== 'undefined' && window.SIGESP_PERF_TRACE && typeof console.time === 'function') {
      console.time(label);
    }
  }

  function perfEnd(label) {
    if (typeof window !== 'undefined' && window.SIGESP_PERF_TRACE && typeof console.timeEnd === 'function') {
      console.timeEnd(label);
    }
  }

  const RESERVATION_TTL_MS = 10 * 60 * 1000;
  const LOCK_TTL_MS = 15 * 1000;

  function logProtocolStep(traceEnabled, step, details = {}) {
    const isTrace = traceEnabled ||
      (typeof window !== 'undefined' && window.SIGESP_PROTOCOL_TRACE === true) ||
      (typeof process !== 'undefined' && process.env?.SIGESP_PROTOCOL_TRACE === '1');
    if (!isTrace) return;
    console.log(`[PROTOCOLO] ${step}`, details);
  }

  function logProtocolError(step, error, details = {}) {
    console.error(`[PROTOCOLO:ERRO] ${step}`, {
      erro: error?.message || String(error),
      ...details
    });
  }

  function getClientSessionId() {
    if (!_clientSessionId) {
      try {
        if (typeof sessionStorage !== 'undefined') {
          const saved = sessionStorage.getItem('SIGESP_CLIENT_SESSION_ID');
          if (saved && saved.trim()) {
            _clientSessionId = saved.trim();
            return _clientSessionId;
          }
        }
      } catch {}

      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        _clientSessionId = crypto.randomUUID();
      } else {
        _clientSessionId = `client_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      }

      try {
        if (typeof sessionStorage !== 'undefined') {
          sessionStorage.setItem('SIGESP_CLIENT_SESSION_ID', _clientSessionId);
        }
      } catch {}
    }
    return _clientSessionId;
  }

  /**
   * Obtém o manipulador de diretório atual
   */
  function getActiveDirectoryHandle() {
    if (typeof S !== 'undefined' && S.dir) {
      return S.dir;
    }
    return null;
  }

  function isNativeSharedDirectory() {
    const dir = getActiveDirectoryHandle();
    return Boolean(dir && !dir.isServer && typeof dir.getFileHandle === 'function');
  }

  function serializeSingleRow(record, headers) {
    const resolvedHeaders = headers && headers.length ? headers : Object.keys(record);
    return resolvedHeaders.map(h => {
      const val = record[h] ?? '';
      const str = String(val);
      if (/[;"\r\n]/.test(str)) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    }).join(';');
  }

  /**
   * Serializador de CSV compatível com RFC 4180
   * Preserva quebras de linha, ponto-e-vírgula e aspas com proteção total.
   */
  function serializeCsv(rows, headers) {
    if (!headers || !headers.length) {
      if (rows && rows.length) {
        headers = Object.keys(rows[0]);
      } else {
        return '\ufeff';
      }
    }
    const lines = [headers.join(';')];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] || {};
      const line = headers.map(h => {
        const val = r[h] ?? '';
        const str = String(val);
        if (/[;"\r\n]/.test(str)) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      }).join(';');
      lines.push(line);
    }
    return '\ufeff' + lines.join('\r\n');
  }

  /**
   * Detecta automaticamente o delimitador do CSV (;, ,, \t)
   */
  function detectDelimiter(text) {
    const s = String(text ?? '').replace(/^\ufeff/, '').trimStart();
    if (!s) return ';';
    const nlIdx = s.indexOf('\n');
    const firstLine = (nlIdx >= 0 ? s.slice(0, nlIdx) : s).replace(/\r$/, '');
    let inQuotes = false;
    let semicolons = 0, commas = 0, tabs = 0;
    for (let i = 0; i < firstLine.length; i++) {
      const ch = firstLine[i];
      if (ch === '"') {
        if (firstLine[i + 1] === '"') i++;
        else inQuotes = !inQuotes;
      } else if (!inQuotes) {
        if (ch === ';') semicolons++;
        else if (ch === ',') commas++;
        else if (ch === '\t') tabs++;
      }
    }
    if (semicolons > 0 && semicolons >= commas) return ';';
    if (commas > semicolons) return ',';
    if (tabs > semicolons && tabs > commas) return '\t';
    return ';';
  }

  /**
   * Deserializador de CSV RFC 4180 baseado em máquina de estados
   * Suporta delimitadores dinâmicos (; , \t), campos multilinhas e aspas escapadas.
   */
  function parseCsv(text) {
    const s = String(text ?? '').replace(/^\ufeff/, '');
    if (!s.trim()) return [];
    const delimiter = detectDelimiter(s);
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (inQuotes) {
        if (ch === '"') {
          if (s[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === delimiter) {
          row.push(field);
          field = '';
        } else if (ch === '\n') {
          if (field.endsWith('\r')) field = field.slice(0, -1);
          row.push(field);
          rows.push(row);
          row = [];
          field = '';
        } else if (ch === '\r') {
          if (s[i + 1] !== '\n') {
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
          }
        } else {
          field += ch;
        }
      }
    }
    if (field || row.length > 0) {
      if (field.endsWith('\r')) field = field.slice(0, -1);
      row.push(field);
      rows.push(row);
    }

    if (rows.length === 0) return [];
    const headers = rows[0].map(h => String(h || '').replace(/^["'\s]+|["'\s]+$/g, '').trim());
    const CANONICAL_OCC_HEADERS = CANONICAL_SEEDS['ocorrencias.csv']?.headers || [
      'id_ocorrencia', 'id_interno', 'numero_protocolo', 'data_ocorrencia', 'hora_ocorrencia', 'gerencia', 'supervisao', 'unidade', 'area', 'local_especifico', 'natureza_ocorrencia', 'tipo_vinculo', 'nome_envolvido', 'empresa_envolvido', 'matricula_id', 'telefone', 'documento', 'placa_veiculo', 'gerencia_envolvido', 'gerencia_geral', 'diretoria', 'relato_detalhado', 'providencias_adotadas', 'prioridade', 'status', 'anexos_referencias', 'responsavel_registro', 'perfil_registro', 'data_registro', 'versao_registro', 'usuario_ultima_alteracao', 'status_validacao', 'data_envio_validacao', 'validado_por', 'data_validacao', 'observacao_validacao'
    ];
    const isLegacyOccHdr = headers.some(h => {
      const lower = String(h || '').toLowerCase();
      return lower === 'arma_envolvida' || lower === 'camera_relacionada' || lower === 'operador_responsavel' || (lower === 'data_hora_registro' && headers.includes('local_ocorrencia'));
    });

    const result = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || r.length === 0 || (r.length === 1 && r[0] === '')) continue;
      const c0 = String(r[0] ?? '').trim();
      if (c0.toLowerCase() === 'id_ocorrencia' && String(r[1] ?? '').trim().toLowerCase() === 'id_interno') continue;
      let hasAnyValue = c0 !== '';
      if (!hasAnyValue) {
        for (let k = 1; k < r.length; k++) {
          if (String(r[k] ?? '').trim() !== '') {
            hasAnyValue = true;
            break;
          }
        }
      }
      if (!hasAnyValue) continue;

      if (isLegacyOccHdr) {
        const col23 = String(r[23] ?? '').trim().toLowerCase();
        const col24 = String(r[24] ?? '').trim().toLowerCase();
        const col21Len = String(r[21] ?? '').trim().length;
        const isCanonicalOccRow = ['baixa', 'média', 'media', 'alta', 'crítica', 'critica'].includes(col23) ||
          ['validada', 'pendente', 'rascunho', 'registrada', 'em apuração', 'encerrada', 'pendente de validação'].includes(col24) ||
          col21Len >= 15;

        if (isCanonicalOccRow) {
          const obj = {};
          for (let j = 0; j < CANONICAL_OCC_HEADERS.length; j++) {
            obj[CANONICAL_OCC_HEADERS[j]] = r[j] ?? '';
          }
          result.push(obj);
          continue;
        } else {
          const rawObj = {};
          for (let j = 0; j < headers.length; j++) {
            rawObj[headers[j]] = r[j] ?? '';
          }
          const obj = {
            id_ocorrencia: rawObj.id_ocorrencia || '',
            id_interno: rawObj.id_interno || '',
            numero_protocolo: rawObj.numero_protocolo || '',
            data_ocorrencia: rawObj.data_ocorrencia || '',
            hora_ocorrencia: rawObj.hora_ocorrencia || '',
            gerencia: rawObj.gerencia || 'GSP/SP',
            supervisao: rawObj.supervisao || rawObj.local_ocorrencia || 'GSP/SP',
            unidade: rawObj.unidade || rawObj.setor || '',
            area: rawObj.area || rawObj.tipo_ocorrencia || '',
            local_especifico: rawObj.local_especifico || rawObj.natureza_ocorrencia || 'Geral',
            natureza_ocorrencia: rawObj.natureza_ocorrencia || rawObj.tipo_ocorrencia || 'Geral',
            tipo_vinculo: rawObj.tipo_vinculo || rawObj.envolvido_vinculo || rawObj.envolvido_tipo || 'Terceiro',
            nome_envolvido: rawObj.nome_envolvido || rawObj.envolvido_nome || '',
            empresa_envolvido: rawObj.empresa_envolvido || rawObj.acao_imediata || '',
            matricula_id: rawObj.matricula_id || '',
            telefone: rawObj.telefone || rawObj.envolvido_documento || '',
            documento: rawObj.documento || rawObj.envolvido_documento || '',
            placa_veiculo: rawObj.placa_veiculo || rawObj.veiculo_envolvido || '',
            gerencia_envolvido: rawObj.gerencia_envolvido || '',
            gerencia_geral: rawObj.gerencia_geral || '',
            diretoria: rawObj.diretoria || '',
            relato_detalhado: rawObj.relato_detalhado || rawObj.descricao_ocorrencia || rawObj.arma_envolvida || '',
            providencias_adotadas: rawObj.providencias_adotadas || rawObj.acao_imediata || rawObj.Camera_relacionada || '',
            prioridade: rawObj.prioridade || rawObj.classificacao || rawObj.nivel_risco || 'Média',
            status: rawObj.status || (String(rawObj.perfil_registro || '').trim().toLowerCase() === 'operador' && !rawObj.validado_por ? 'pendente' : 'validada'),
            anexos_referencias: rawObj.anexos_referencias || rawObj.anexos || rawObj.equipe_plantao || '',
            responsavel_registro: rawObj.responsavel_registro || rawObj.operador_responsavel || '',
            matricula_responsavel: rawObj.matricula_responsavel || rawObj.id_operador || '',
            perfil_registro: rawObj.perfil_registro || 'Operador',
            data_registro: rawObj.data_registro || rawObj.data_hora_registro || rawObj.data_ultima_alteracao || '',
            versao_registro: rawObj.versao_registro || '1',
            usuario_ultima_alteracao: rawObj.usuario_ultima_alteracao || rawObj.operador_responsavel || '',
            status_validacao: rawObj.status_validacao || (String(rawObj.perfil_registro || '').trim().toLowerCase() === 'operador' && !rawObj.validado_por ? 'Pendente de validação' : 'Validada'),
            data_envio_validacao: rawObj.data_envio_validacao || '',
            validado_por: rawObj.validado_por || '',
            data_validacao: rawObj.data_validacao || '',
            observacao_validacao: rawObj.observacao_validacao || ''
          };
          result.push(obj);
          continue;
        }
      }

      const obj = {};
      for (let j = 0; j < headers.length; j++) {
        obj[headers[j]] = r[j] ?? '';
      }
      result.push(obj);
    }
    return result;
  }

  async function parseCsvAsync(text) {
    const s = String(text ?? '').replace(/^\ufeff/, '');
    if (s.length <= 250000) {
      return parseCsv(s);
    }
    const delimiter = detectDelimiter(s);
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    let nextYieldAt = 300000;

    for (let i = 0; i < s.length; i++) {
      if (i >= nextYieldAt) {
        nextYieldAt = i + 300000;
        await new Promise(r => setTimeout(r, 0));
      }
      const ch = s[i];
      if (inQuotes) {
        if (ch === '"') {
          if (s[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === delimiter) {
          row.push(field);
          field = '';
        } else if (ch === '\n') {
          if (field.endsWith('\r')) field = field.slice(0, -1);
          row.push(field);
          rows.push(row);
          row = [];
          field = '';
        } else if (ch === '\r') {
          if (s[i + 1] !== '\n') {
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
          }
        } else {
          field += ch;
        }
      }
    }
    if (field || row.length > 0) {
      if (field.endsWith('\r')) field = field.slice(0, -1);
      row.push(field);
      rows.push(row);
    }

    if (rows.length === 0) return [];
    const headers = rows[0].map(h => String(h || '').replace(/^["'\s]+|["'\s]+$/g, '').trim());
    const result = [];
    for (let i = 1; i < rows.length; i++) {
      if ((i & 4095) === 0) {
        await new Promise(r => setTimeout(r, 0));
      }
      const r = rows[i];
      if (!r || r.length === 0 || (r.length === 1 && r[0] === '')) continue;
      const c0 = String(r[0] ?? '').trim();
      if (c0.toLowerCase() === 'id_ocorrencia' && String(r[1] ?? '').trim().toLowerCase() === 'id_interno') continue;
      let hasAnyValue = c0 !== '';
      if (!hasAnyValue) {
        for (let k = 1; k < r.length; k++) {
          if (String(r[k] ?? '').trim() !== '') {
            hasAnyValue = true;
            break;
          }
        }
      }
      if (!hasAnyValue) continue;
      const obj = {};
      for (let j = 0; j < headers.length; j++) {
        obj[headers[j]] = r[j] ?? '';
      }
      result.push(obj);
    }
    return result;
  }

  function isRowPending(r) {
    if (!r || typeof r !== 'object') return false;
    const stVal = String(r.status_validacao || '').trim().toLowerCase();
    const st = String(r.status || '').trim().toLowerCase();
    const validadoPor = String(r.validado_por || '').trim();
    const perfil = String(r.perfil_registro || r.perfil || '').trim().toLowerCase();

    if (stVal === 'validada' || validadoPor) return false;
    if (stVal.includes('pendente') || st === 'pendente' || st === 'pendente de validação') return true;
    if (perfil === 'operador' && !validadoPor) return true;
    return false;
  }

  function isRowValidated(r) {
    if (!r || typeof r !== 'object') return false;
    if (isRowPending(r)) return false;
    const stVal = String(r.status_validacao || '').trim().toLowerCase();
    const st = String(r.status || '').trim().toLowerCase();
    const validadoPor = String(r.validado_por || '').trim();
    if (stVal === 'validada' || validadoPor || st === 'validada' || st === 'em apuração' || st === 'em apuracao' || st === 'encerrada') return true;
    const perfil = String(r.perfil_registro || r.perfil || '').trim().toLowerCase();
    if (st === 'registrada' && perfil !== 'operador') return true;
    return false;
  }

  /**
   * Consolida registros versionados (Event Sourcing / Append-Only)
   * Agrupa ocorrências por id_interno / id_ocorrencia / numero_protocolo
   * garantindo que um registro validado SEMPRE substitua versões pendentes anteriores
   * mesmo que o número de protocolo ou id_ocorrencia tenha sido ajustado por anti-colisão.
   */
  function consolidateVersionedRows(rows) {
    if (!Array.isArray(rows) || !rows.length) return [];
    const map = new Map();
    const order = [];
    const byIdInterno = new Map();
    const byIdOcorrencia = new Map();
    const byProtocolo = new Map();

    for (let i = 0; i < rows.length; i++) {
      let r = rows[i];
      if (!r || typeof r !== 'object') continue;

      const isOcc = Boolean(r.id_ocorrencia || r.id_interno || r.numero_protocolo);
      let key = '';

      if (isOcc) {
        if (isTombstonedOccurrence(r)) continue;
        const activeVal = getActivePendingValidation(r);
        if (activeVal) {
          r = { ...r, ...activeVal, status_validacao: 'Validada', status: activeVal.status || 'Registrada' };
        }
        const idInt = String(r.id_interno || '').trim();
        const idOcc = String(r.id_ocorrencia || '').trim();
        const proto = String(r.numero_protocolo || '').trim().toUpperCase();

        const candidateKeys = [];
        if (idInt && byIdInterno.has(idInt)) candidateKeys.push(byIdInterno.get(idInt));
        if (idOcc && byIdOcorrencia.has(idOcc)) candidateKeys.push(byIdOcorrencia.get(idOcc));
        if (proto && byProtocolo.has(proto)) candidateKeys.push(byProtocolo.get(proto));

        if (candidateKeys.length > 0) {
          key = candidateKeys[0];
          // Se múltiplos identificadores apontavam para chaves distintas, unifica no map
          for (let c = 1; c < candidateKeys.length; c++) {
            const otherKey = candidateKeys[c];
            if (otherKey !== key && map.has(otherKey)) {
              const otherVal = map.get(otherKey);
              map.delete(otherKey);
              const curVal = map.get(key);
              if (curVal && otherVal) {
                const curValid = isRowValidated(curVal);
                const othValid = isRowValidated(otherVal);
                if (othValid && !curValid) {
                  map.set(key, { ...curVal, ...otherVal });
                } else {
                  map.set(key, { ...otherVal, ...curVal });
                }
              }
            }
          }
        } else {
          key = idInt ? `INT:${idInt}` : (idOcc ? `OCC:${idOcc}` : `PROTO:${proto}`);
        }

        if (idInt) byIdInterno.set(idInt, key);
        if (idOcc) byIdOcorrencia.set(idOcc, key);
        if (proto) byProtocolo.set(proto, key);
      } else if (r.id_chave || r.codigo_chave || r.codigo) {
        key = String(r.id_chave || r.codigo_chave || r.codigo || '').trim().toUpperCase();
      } else if (r.id_movimento) {
        key = String(r.id_movimento).trim().toUpperCase();
      } else if (r.id) {
        key = String(r.id).trim().toUpperCase();
      } else if (r.id_usuario || r.login) {
        key = String(r.id_usuario || r.login).trim().toLowerCase();
      } else if (r.id_auditoria) {
        key = String(r.id_auditoria).trim();
      } else if (r.id_exclusao) {
        key = String(r.id_exclusao).trim();
      } else if (r.tipo && r.id) {
        key = `${r.tipo}:${r.id}`;
      } else if (r.id_natureza) {
        key = String(r.id_natureza).trim();
      } else if (r.id_unidade) {
        key = String(r.id_unidade).trim();
      } else if (r.id_supervisao) {
        key = String(r.id_supervisao).trim();
      } else {
        key = `row_${i}`;
      }
      if (!key) continue;

      if (!map.has(key)) {
        map.set(key, r);
        order.push(key);
      } else {
        const existing = map.get(key);
        const vExist = parseInt(existing.versao_registro || existing.versao || '0', 10) || 0;
        const vNew = parseInt(r.versao_registro || r.versao || '0', 10) || 0;
        const existValid = isRowValidated(existing);
        const newValid = isRowValidated(r);
        const newPend = isRowPending(r);

        // 1. Linha pendente NUNCA pode sobrescrever uma ocorrência já validada
        if (existValid && newPend) {
          continue;
        }

        // 2. Se a versão existente for estritamente mais recente que a versão de r, preserva existing
        if (vExist > vNew) {
          // Registro existente possui versão incremental superior; o registro legado/antigo não pode reverter
          continue;
        }

        // 3. Validação estrita de precedência de ciclo de vida e versão
        if (newValid && !existValid) {
          // Ocorrência validada sempre substitui versão pendente anterior
        } else if (vNew > vExist) {
          // Versão incremental superior sempre prevalece (r substitui existing)
        } else if (vNew === vExist) {
          // Em empate numérico de versões, desempata por timestamp e avanço de apuração
          const tExist = Date.parse(existing.data_atualizacao || existing.apuracao_data || existing.data_registro || '') || 0;
          const tNew = Date.parse(r.data_atualizacao || r.apuracao_data || r.data_registro || '') || 0;
          const sExist = String(existing.status_apuracao || existing.status || '').trim().toLowerCase();
          const sNew = String(r.status_apuracao || r.status || '').trim().toLowerCase();
          const existHasApur = sExist === 'em apuração' || sExist === 'em apuracao' || sExist === 'encerrada' || Boolean(existing.apuracao_notas || existing.apuracao_conclusao);
          const newHasApur = sNew === 'em apuração' || sNew === 'em apuracao' || sNew === 'encerrada' || Boolean(r.apuracao_notas || r.apuracao_conclusao);

          if (existHasApur && !newHasApur) {
            continue;
          }
          if (tExist > tNew && existHasApur === newHasApur) {
            continue;
          }
        } else if (!newValid && existValid) {
          // Versão legada não validada não pode reverter registro já validado
          continue;
        }

        // A versão r é mais recente ou tem precedência válida sobre existing
        const merged = { ...existing, ...r };
        // Preserva campos de apuração caso r venha de fonte que omitiu propriedades parciais
        if (existing.status_apuracao && !r.status_apuracao) merged.status_apuracao = existing.status_apuracao;
        if (existing.apuracao_notas && !r.apuracao_notas) merged.apuracao_notas = existing.apuracao_notas;
        if (existing.apuracao_conclusao && !r.apuracao_conclusao) merged.apuracao_conclusao = existing.apuracao_conclusao;
        if (existing.apuracao_plano_acao && !r.apuracao_plano_acao) merged.apuracao_plano_acao = existing.apuracao_plano_acao;
        if (existing.apuracao_responsavel && !r.apuracao_responsavel) merged.apuracao_responsavel = existing.apuracao_responsavel;
        if (existing.apuracao_data && !r.apuracao_data) merged.apuracao_data = existing.apuracao_data;

        if (newPend && !existValid && !newValid) {
          merged.status_validacao = 'Pendente de validação';
          merged.status = 'pendente';
        } else if (newValid || existValid) {
          merged.status_validacao = 'Validada';
          const sLower = String(r.status_apuracao || r.status || existing.status_apuracao || existing.status || '').trim().toLowerCase();
          if (sLower === 'em apuração' || sLower === 'em apuracao') {
            merged.status = 'Em Apuração';
            merged.status_apuracao = 'Em Apuração';
          } else if (sLower === 'encerrada' || sLower === 'concluída' || sLower === 'concluida') {
            merged.status = 'Encerrada';
            merged.status_apuracao = 'Encerrada';
          } else if (sLower === 'registrada' || sLower === 'validada') {
            merged.status = 'Registrada';
          } else if (r.status && !r.status.toLowerCase().includes('pendente')) {
            merged.status = r.status;
          } else if (!merged.status || merged.status.toLowerCase().includes('pendente')) {
            merged.status = 'Registrada';
          }
        }
        map.set(key, merged);
        if (isOcc) {
          const mInt = String(merged.id_interno || '').trim();
          const mOcc = String(merged.id_ocorrencia || '').trim();
          const mProto = String(merged.numero_protocolo || '').trim().toUpperCase();
          if (mInt) byIdInterno.set(mInt, key);
          if (mOcc) byIdOcorrencia.set(mOcc, key);
          if (mProto) byProtocolo.set(mProto, key);
        }
      }
    }

    const out = [];
    const seenFinalKeys = new Set();
    for (const k of order) {
      if (seenFinalKeys.has(k)) continue;
      seenFinalKeys.add(k);
      const val = map.get(k);
      if (val) out.push(val);
    }

    // Passagem de limpeza estrita: garante que nenhum registro pendente permaneça
    // se qualquer versão correspondente já estiver validada
    const valProtos = new Set();
    const valInts = new Set();
    const valOccs = new Set();
    for (const item of out) {
      if (isRowValidated(item)) {
        const p = String(item.numero_protocolo || '').trim().toUpperCase();
        const intId = String(item.id_interno || '').trim();
        const occId = String(item.id_ocorrencia || '').trim();
        if (p) valProtos.add(p);
        if (intId) valInts.add(intId);
        if (occId) valOccs.add(occId);
      }
    }

    const finalOut = [];
    for (const item of out) {
      if (isTombstonedOccurrence(item)) {
        continue;
      }
      if (isRowPending(item)) {
        const p = String(item.numero_protocolo || '').trim().toUpperCase();
        const intId = String(item.id_interno || '').trim();
        const occId = String(item.id_ocorrencia || '').trim();
        if ((p && valProtos.has(p)) || (intId && valInts.has(intId)) || (occId && valOccs.has(occId))) {
          continue;
        }
      }
      finalOut.push(item);
    }

    Object.defineProperty(finalOut, '_consolidated', { value: true, enumerable: false, configurable: true });
    return finalOut;
  }

  /**
   * Gera UUID v4 criptograficamente seguro (RFC 4122)
   */
  function generateUUID() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }

  function getCanonicalRecordKey(fileName, r) {
    if (!r || typeof r !== 'object') return '';
    if (fileName === 'ocorrencias.csv' || fileName === 'ocorrencias_pendentes.csv') {
      return String(r.id_interno || r.id_ocorrencia || r.numero_protocolo || '').trim();
    }
    if (fileName === 'chaves.csv') {
      return String(r.id_chave || r.codigo_chave || r.codigo || '').trim().toUpperCase();
    }
    if (fileName === 'movimentacao_chaves.csv') {
      return String(r.id_movimento || '').trim().toUpperCase();
    }
    if (fileName === 'inspecao_fumaca_preta.csv') {
      return String(r.id || '').trim();
    }
    if (fileName === 'usuarios.csv') {
      return String(r.id_usuario || r.login || '').trim().toLowerCase();
    }
    if (fileName === 'historico_sistema.csv') {
      return String(r.id_auditoria || '').trim();
    }
    if (fileName === 'registros_apagados.csv') {
      return String(r.id_exclusao || '').trim();
    }
    if (fileName === 'supervisoes_unidades.csv') {
      return `${r.tipo || 'ITEM'}:${r.id || ''}`;
    }
    return String(r.id || r.id_ocorrencia || r.id_chave || r.id_usuario || r.codigo || Object.values(r)[0] || '');
  }

  const IndexedDBEngine = {
    DB_NAME: 'SIGESP_DB',
    DB_VERSION: 3,

    open() {
      if (typeof indexedDB === 'undefined') return Promise.resolve(null);
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(this.DB_NAME, this.DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('config')) {
            db.createObjectStore('config');
          }
          if (!db.objectStoreNames.contains('CONFIG')) {
            db.createObjectStore('CONFIG');
          }
          if (!db.objectStoreNames.contains('records')) {
            const store = db.createObjectStore('records', { keyPath: 'key' });
            store.createIndex('by_file', 'fileName', { unique: false });
            store.createIndex('by_updated', 'updatedAt', { unique: false });
          }
          if (!db.objectStoreNames.contains('sync_outbox')) {
            const store = db.createObjectStore('sync_outbox', { keyPath: 'id' });
            store.createIndex('by_status', 'status', { unique: false });
            store.createIndex('by_created', 'createdAt', { unique: false });
          }
          if (!db.objectStoreNames.contains('sync_metadata')) {
            db.createObjectStore('sync_metadata', { keyPath: 'fileName' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        req.onblocked = () => {
          console.warn('[IndexedDBEngine] Banco bloqueado por outra sessão.');
          resolve(null);
        };
      });
    },

    async saveRecordLocally(fileName, record) {
      if (typeof indexedDB === 'undefined') return;
      try {
        const db = await this.open();
        if (!db || !db.objectStoreNames.contains('records')) return;
        const recId = getCanonicalRecordKey(fileName, record) || generateUUID();
        const item = {
          key: `${fileName}:${recId}`,
          fileName,
          recordId: recId,
          data: { ...record },
          updatedAt: Date.now()
        };
        await new Promise((res, rej) => {
          const tx = db.transaction('records', 'readwrite');
          tx.objectStore('records').put(item);
          tx.oncomplete = () => res();
          tx.onerror = () => rej(tx.error);
          tx.onabort = () => rej(tx.error);
        });
        db.close();
      } catch (err) {
        console.warn('[IndexedDBEngine:saveRecordLocally] Falha ao persistir no IndexedDB:', err);
      }
    },

    async saveRecordsBulkLocally(fileName, records) {
      if (typeof indexedDB === 'undefined' || !Array.isArray(records) || !records.length) return;
      if (records.length > 500) return;
      try {
        const db = await this.open();
        if (!db || !db.objectStoreNames.contains('records')) return;
        await new Promise((res, rej) => {
          const tx = db.transaction('records', 'readwrite');
          const store = tx.objectStore('records');
          const now = Date.now();
          for (let i = 0; i < records.length; i++) {
            const r = records[i];
            const recId = getCanonicalRecordKey(fileName, r) || `row_${i}`;
            store.put({
              key: `${fileName}:${recId}`,
              fileName,
              recordId: recId,
              data: { ...r },
              updatedAt: now
            });
          }
          tx.oncomplete = () => res();
          tx.onerror = () => rej(tx.error);
          tx.onabort = () => rej(tx.error);
        });
        db.close();
      } catch (err) {
        console.warn('[IndexedDBEngine:saveRecordsBulkLocally] Falha bulk no IndexedDB:', err);
      }
    },

    async loadRecordsLocally(fileName) {
      if (typeof indexedDB === 'undefined') return null;
      try {
        const db = await this.open();
        if (!db || !db.objectStoreNames.contains('records')) return null;
        const records = await new Promise((res, rej) => {
          const tx = db.transaction('records', 'readonly');
          const store = tx.objectStore('records');
          const index = store.index('by_file');
          const req = index.getAll(fileName);
          req.onsuccess = () => {
            const items = (req.result || []).map(x => x.data).filter(Boolean);
            res(items);
          };
          req.onerror = () => rej(req.error);
        });
        db.close();
        return records;
      } catch (err) {
        console.warn('[IndexedDBEngine:loadRecordsLocally] Falha ao ler do IndexedDB:', err);
        return null;
      }
    },

    async removeRecord(fileName, recordId) {
      if (typeof indexedDB === 'undefined' || !recordId) return;
      try {
        const db = await this.open();
        if (!db || !db.objectStoreNames.contains('records')) return;
        await new Promise((res, rej) => {
          const tx = db.transaction('records', 'readwrite');
          const store = tx.objectStore('records');
          store.delete(`${fileName}:${recordId}`);
          tx.oncomplete = () => res();
          tx.onerror = () => rej(tx.error);
          tx.onabort = () => rej(tx.error);
        });
        db.close();
      } catch (err) {
        console.warn('[IndexedDBEngine:removeRecord] Falha ao remover do IndexedDB:', err);
      }
    },

    async enqueueOutbox(job) {
      if (typeof indexedDB === 'undefined') return job.id;
      try {
        const db = await this.open();
        if (!db || !db.objectStoreNames.contains('sync_outbox')) return job.id;
        await new Promise((res, rej) => {
          const tx = db.transaction('sync_outbox', 'readwrite');
          tx.objectStore('sync_outbox').put(job);
          tx.oncomplete = () => res();
          tx.onerror = () => rej(tx.error);
          tx.onabort = () => rej(tx.error);
        });
        db.close();
        return job.id;
      } catch (err) {
        console.warn('[IndexedDBEngine:enqueueOutbox] Falha ao enfileirar job:', err);
        return job.id;
      }
    },

    async getPendingOutboxJobs() {
      if (typeof indexedDB === 'undefined') return [];
      try {
        const db = await this.open();
        if (!db || !db.objectStoreNames.contains('sync_outbox')) return [];
        const jobs = await new Promise((res, rej) => {
          const tx = db.transaction('sync_outbox', 'readonly');
          const store = tx.objectStore('sync_outbox');
          const req = store.getAll();
          req.onsuccess = () => {
            const all = req.result || [];
            const now = Date.now();
            const eligible = all.filter(j => {
              if (!j) return false;
              // Descarta jobs antigos órfãos (> 24h) ou com excesso de retentativas (> 15)
              if (j.createdAt && (now - j.createdAt > 86400000)) return false;
              if (j.attempts && j.attempts > 15) return false;
              return j.status === 'pending' || (j.status === 'retry' && now >= (j.nextRetry || 0));
            });
            eligible.sort((a, b) => a.createdAt - b.createdAt);
            res(eligible);
          };
          req.onerror = () => rej(req.error);
        });
        db.close();
        return jobs;
      } catch (err) {
        console.warn('[IndexedDBEngine:getPendingOutboxJobs] Falha ao listar jobs:', err);
        return [];
      }
    },

    async removeOutboxJob(jobId) {
      if (typeof indexedDB === 'undefined') return;
      try {
        const db = await this.open();
        if (!db || !db.objectStoreNames.contains('sync_outbox')) return;
        await new Promise((res, rej) => {
          const tx = db.transaction('sync_outbox', 'readwrite');
          tx.objectStore('sync_outbox').delete(jobId);
          tx.oncomplete = () => res();
          tx.onerror = () => rej(tx.error);
          tx.onabort = () => rej(tx.error);
        });
        db.close();
      } catch (err) {
        console.warn('[IndexedDBEngine:removeOutboxJob] Falha ao remover job:', err);
      }
    },

    async removeOutboxJobsForRecord(recordIdentifiers) {
      if (typeof indexedDB === 'undefined' || !recordIdentifiers) return;
      const rawList = Array.isArray(recordIdentifiers) ? recordIdentifiers : [recordIdentifiers];
      const ids = rawList.filter(Boolean).map(x => String(x).trim().toUpperCase());
      if (!ids.length) return;
      try {
        const db = await this.open();
        if (!db || !db.objectStoreNames.contains('sync_outbox')) return;
        await new Promise((res, rej) => {
          const tx = db.transaction('sync_outbox', 'readwrite');
          const store = tx.objectStore('sync_outbox');
          const req = store.getAll();
          req.onsuccess = () => {
            const all = req.result || [];
            for (const j of all) {
              const r = j.record || {};
              const proto = String(r.numero_protocolo || '').trim().toUpperCase();
              const occ = String(r.id_ocorrencia || '').trim().toUpperCase();
              const idInt = String(r.id_interno || '').trim().toUpperCase();
              const fName = String(j.individualFileName || '').trim().toUpperCase();
              const match = ids.some(id => id === proto || id === occ || id === idInt || (id.length >= 4 && fName.includes(id)));
              if (match) {
                store.delete(j.id);
              }
            }
          };
          tx.oncomplete = () => res();
          tx.onerror = () => rej(tx.error);
          tx.onabort = () => rej(tx.error);
        });
        db.close();
      } catch (err) {
        console.warn('[IndexedDBEngine:removeOutboxJobsForRecord] Falha:', err);
      }
    },

    async updateOutboxJob(job) {
      if (typeof indexedDB === 'undefined') return;
      try {
        const db = await this.open();
        if (!db || !db.objectStoreNames.contains('sync_outbox')) return;
        await new Promise((res, rej) => {
          const tx = db.transaction('sync_outbox', 'readwrite');
          tx.objectStore('sync_outbox').put(job);
          tx.oncomplete = () => res();
          tx.onerror = () => rej(tx.error);
          tx.onabort = () => rej(tx.error);
        });
        db.close();
      } catch (err) {
        console.warn('[IndexedDBEngine:updateOutboxJob] Falha ao atualizar job:', err);
      }
    },

    async saveSyncMetadata(fileName, meta) {
      if (typeof indexedDB === 'undefined') return;
      try {
        const db = await this.open();
        if (!db || !db.objectStoreNames.contains('sync_metadata')) return;
        await new Promise((res, rej) => {
          const tx = db.transaction('sync_metadata', 'readwrite');
          tx.objectStore('sync_metadata').put({ fileName, ...meta, lastSyncTime: Date.now() });
          tx.oncomplete = () => res();
          tx.onerror = () => rej(tx.error);
        });
        db.close();
      } catch (err) {}
    }
  };

  let _isProcessingOutbox = false;
  let _backgroundSyncTimer = null;

  function scheduleBackgroundSync(delayMs = 0) {
    if (_backgroundSyncTimer) clearTimeout(_backgroundSyncTimer);
    _backgroundSyncTimer = setTimeout(() => {
      _backgroundSyncTimer = null;
      processBackgroundSyncQueue().catch(err => {
        console.warn('[StorageService:BackgroundSync] Erro na execução da fila:', err);
      });
    }, delayMs);
  }

  async function processBackgroundSyncQueue() {
    if (_isProcessingOutbox) return;
    _isProcessingOutbox = true;
    try {
      const dir = getActiveDirectoryHandle();
      if (!dir) return;

      const jobs = await IndexedDBEngine.getPendingOutboxJobs();
      if (!jobs || !jobs.length) return;

      for (const job of jobs) {
        const { id, fileName, record, headers, options, attempts = 0 } = job;
        try {
          if (fileName === 'ocorrencias.csv' || isIndividualOccurrenceFileName(fileName)) {
            const indivFileName = isIndividualOccurrenceFileName(fileName)
              ? fileName
              : (job.individualFileName || getIndividualOccurrenceFileName(record));
            const resolvedHeaders = (headers && headers.length)
              ? headers
              : (CANONICAL_SEEDS['ocorrencias.csv']?.headers || Object.keys(record));
            const singleFileCsv = serializeCsv([record], resolvedHeaders);
            const encPayload = await window.CryptoService.encrypt(singleFileCsv, {
              fileName: indivFileName,
              rowCount: 1
            });

            const idInt = String(record.id_interno || '').trim();
            const idOcc = String(record.id_ocorrencia || '').trim();
            const prevMappedFile = (idInt && _recordKeyToFileMap.get(`INT:${idInt}`)) || (idOcc && _recordKeyToFileMap.get(`OCC:${idOcc}`)) || null;

            const writeMeta = await StorageService.writeRawFile(indivFileName, encPayload, options);
            const rawSig = `${encPayload.length}:${encPayload.slice(0, 48)}:${encPayload.slice(-48)}`;
            _individualOccFileCache.set(indivFileName, {
              rawSig,
              mtimeMs: writeMeta?.mtimeMs || Date.now(),
              size: writeMeta?.size || encPayload.length,
              rows: [{ ...record }]
            });
            if (idInt) _recordKeyToFileMap.set(`INT:${idInt}`, indivFileName);
            if (idOcc) _recordKeyToFileMap.set(`OCC:${idOcc}`, indivFileName);
            if (record.numero_protocolo) {
              _recordKeyToFileMap.set(`PROTO:${String(record.numero_protocolo).trim().toUpperCase()}`, indivFileName);
            }

            if (prevMappedFile && prevMappedFile !== indivFileName) {
              _individualOccFileCache.delete(prevMappedFile);
              await StorageService.deleteFile(prevMappedFile).catch(() => {});
            }

            await IndexedDBEngine.removeOutboxJob(id);

            if (options?.releasedProtocol) {
              await StorageService._markNativeProtocolUtilized(options.releasedProtocol, record.id_interno || '').catch(() => {});
            }

            const effMtime = writeMeta?.mtimeMs || Date.now();
            const effSize = writeMeta?.size || encPayload.length;
            const cachedEntry = _rawFileCache.get('ocorrencias.csv');
            if (cachedEntry) {
              cachedEntry.mtimeMs = effMtime;
            }
            if (typeof window !== 'undefined' && typeof window.syncFreshCsvMeta === 'function') {
              window.syncFreshCsvMeta('ocorrencias.csv', effMtime, cachedEntry?.size || effSize);
            }
            continue;
          }

          const singleRowCsv = serializeSingleRow(record, headers);
          const encLine = await window.CryptoService.encrypt(singleRowCsv, {
            fileName,
            rowCount: 1,
            isAppend: true
          });

          if (dir.isServer && !dir.relPath) {
            const blob = new Blob(['\r\n' + encLine], { type: 'text/csv; charset=utf-8' });
            const res = await fetchServerStorage(fileName, 'POST', blob, { action: 'append', ...options });
            if (!res.ok) throw new Error(`HTTP ${res.status} ao sincronizar ${fileName}`);
          } else {
            const fh = await dir.getFileHandle(fileName, { create: true });
            const file = await fh.getFile();
            const currentSize = file.size;

            if (currentSize === 0) {
              const initialCsv = serializeCsv([record], headers);
              const enc = await window.CryptoService.encrypt(initialCsv, { fileName, rowCount: 1 });
              const w = await fh.createWritable({ keepExistingData: false });
              await w.write(enc);
              await w.close();
            } else {
              const w = await fh.createWritable({ keepExistingData: true });
              try {
                await w.seek(currentSize);
                await w.write('\r\n' + encLine);
                await w.close();
              } catch (wErr) {
                try { await w.abort(); } catch {}
                throw wErr;
              }
            }
          }

          await IndexedDBEngine.removeOutboxJob(id);

          if (options?.releasedProtocol && fileName === 'ocorrencias.csv') {
            await StorageService._markNativeProtocolUtilized(options.releasedProtocol, record.id_interno || '').catch(() => {});
          }

          const stat = await StorageService.getFileStat(fileName).catch(() => null);
          const cachedEntry = _rawFileCache.get(fileName);
          if (cachedEntry && stat) {
            cachedEntry.mtimeMs = stat.mtimeMs;
            cachedEntry.size = stat.size;
          } else if (!stat) {
            _rawFileCache.delete(fileName);
          }
          if (stat) {
            await IndexedDBEngine.saveSyncMetadata(fileName, stat);
            if (typeof window !== 'undefined' && typeof window.syncFreshCsvMeta === 'function') {
              window.syncFreshCsvMeta(fileName, stat.mtimeMs, stat.size);
            }
          }
        } catch (writeErr) {
          const nextAttempts = (attempts || 0) + 1;
          const backoffDelay = Math.min(30000, Math.floor(250 * Math.pow(1.5, nextAttempts) + Math.random() * 200));
          console.warn(`[BackgroundSync] Concorrência/Lock em ${fileName} (tentativa ${nextAttempts}). Retentando em ${backoffDelay}ms.`);

          await IndexedDBEngine.updateOutboxJob({
            ...job,
            status: 'retry',
            attempts: nextAttempts,
            lastAttempt: Date.now(),
            nextRetry: Date.now() + backoffDelay,
            error: String(writeErr?.message || writeErr)
          });

          scheduleBackgroundSync(backoffDelay);
          break;
        }
      }
    } finally {
      _isProcessingOutbox = false;
    }
  }

  return {
    CANONICAL_SEEDS,
    serializeCsv,
    parseCsv,
    consolidateVersionedRows,
    generateUUID,
    getClientSessionId,
    IndexedDBEngine,
    scheduleBackgroundSync,
    processBackgroundSyncQueue,

    isIndividualOccurrenceFileName,
    getIndividualOccurrenceFileName,

    invalidateCache(fileName = null) {
      this._nativeHandlesCache = null;
      if (fileName) {
        _rawFileCache.delete(fileName);
        if (fileName === 'ocorrencias.csv') {
          _lastKnownBatchSig = '';
        } else if (isIndividualOccurrenceFileName(fileName)) {
          _individualOccFileCache.delete(fileName);
          _rawFileCache.delete('ocorrencias.csv');
          _lastKnownBatchSig = '';
        }
      } else {
        // Invalidação global segura: preserva registros decodificados válidos por assinatura
        // para garantir reconexão instantânea sem re-computação criptográfica
        _lastKnownBatchSig = '';
        _lastKnownBundleSig = '';
        _preloadedOccurrencesBatch = null;
        _rawFileCache.delete('ocorrencias.csv');
      }
    },

    /**
     * Indexa rapidamente entradas de uma pasta nativa em uma única passada
     * e pré-carrega os arquivos padrão em paralelo
     */
    async _scanAndIndexNativeDirectory(dir) {
      if (!dir || dir.isServer) return;
      const fileMap = new Map();
      const occHandles = [];
      try {
        if (typeof dir.entries === 'function') {
          for await (const [name, handle] of dir.entries()) {
            if (handle.kind === 'file') {
              fileMap.set(name, handle);
              if (isIndividualOccurrenceFileName(name)) {
                occHandles.push({ name, handle });
              }
            }
          }
        } else if (typeof dir.values === 'function') {
          for await (const handle of dir.values()) {
            if (handle.kind === 'file') {
              fileMap.set(handle.name, handle);
              if (isIndividualOccurrenceFileName(handle.name)) {
                occHandles.push({ name, handle: handle });
              }
            }
          }
        }
      } catch (err) {
        console.warn('[StorageService] Falha ao indexar diretório nativo:', err);
      }
      occHandles.sort((a, b) => a.name.localeCompare(b.name));
      this._nativeFilesMap = fileMap;
      this._nativeHandlesCache = { dir, ts: Date.now(), handles: occHandles };

      // Pré-carregamento e descriptografia paralela dos arquivos CSV nativos
      const standardFiles = [
        'usuarios.csv', 'chaves.csv', 'movimentacao_chaves.csv',
        'historico_sistema.csv', 'supervisoes_unidades.csv',
        'naturezas_ocorrencias.csv', 'inspecao_fumaca_preta.csv',
        'registros_apagados.csv'
      ];
      await Promise.all(standardFiles.map(async (name) => {
        const fh = fileMap.get(name);
        if (!fh) return;
        try {
          const f = await fh.getFile();
          const mtime = Number(f.lastModified || 0);
          const size = Number(f.size || 0);
          const cached = _rawFileCache.get(name);
          if (cached && cached.mtimeMs === mtime && cached.size === size && Array.isArray(cached.rows)) {
            return;
          }
          const rawText = await f.text();
          const rawSig = `${rawText.length}:${rawText.slice(0, 48)}:${rawText.slice(-48)}`;
          if (cached && cached.rawSig === rawSig && Array.isArray(cached.rows)) {
            cached.mtimeMs = mtime;
            cached.size = size;
            return;
          }
          _rawFileCache.set(name, { rawSig, rawText, mtimeMs: mtime, size });
          await this.readEncryptedCsv(name).catch(() => []);
        } catch {}
      }));
    },

    /**
     * Inicializa a camada de armazenamento com sincronização instantânea em lote (Bundle API / Native Index)
     */
    async initializeStorage(handle = null) {
      if (handle && typeof S !== 'undefined') {
        S.dir = handle;
      }
      const dir = getActiveDirectoryHandle();
      if (!dir) {
        return false;
      }

      // Fast-path 1: Servidor de desenvolvimento / API bundle unificada de 3ms
      if (dir.isServer && !dir.relPath) {
        try {
          const bundleUrl = `/api/storage/bundle?knownSig=${encodeURIComponent(_lastKnownBundleSig || '')}&_t=${Date.now()}`;
          const res = await fetch(bundleUrl, { method: 'GET', headers: { 'Cache-Control': 'no-cache' } });
          if (res.ok) {
            const data = await res.json();
            if (data && data.ok) {
              if (data.unchanged && _lastKnownBundleSig === data.sig) {
                scheduleBackgroundSync(100);
                return true;
              }
              _lastKnownBundleSig = data.sig || '';

              if (data.files && typeof data.files === 'object') {
                for (const [fName, fileObj] of Object.entries(data.files)) {
                  if (fileObj && typeof fileObj.rawText === 'string') {
                    const rawText = fileObj.rawText;
                    const rawSig = `${rawText.length}:${rawText.slice(0, 48)}:${rawText.slice(-48)}`;
                    const existing = _rawFileCache.get(fName);
                    if (existing && existing.rawSig === rawSig && Array.isArray(existing.rows)) {
                      existing.mtimeMs = Number(fileObj.mtimeMs || existing.mtimeMs);
                      existing.size = Number(fileObj.size || existing.size);
                      continue;
                    }
                    _rawFileCache.set(fName, {
                      rawSig,
                      rawText,
                      mtimeMs: Number(fileObj.mtimeMs || Date.now()),
                      size: Number(fileObj.size || rawText.length)
                    });
                  }
                }
              }

              if (data.occurrencesBatch) {
                _preloadedOccurrencesBatch = data.occurrencesBatch;
                if (data.occurrencesBatch.sig) {
                  _lastKnownBatchSig = String(data.occurrencesBatch.sig);
                }
              }

              // Pré-decodifica todos os arquivos padrão em paralelo para que qualquer read() seja 0ms
              const stdFiles = Object.keys(data.files || {});
              await Promise.all(stdFiles.map(name => this.readEncryptedCsv(name).catch(() => [])));
            }
          }
        } catch (bundleErr) {
          console.warn('[StorageService] Falha no bundle unificado do servidor:', bundleErr);
        }
        scheduleBackgroundSync(100);
        return true;
      }

      // Fast-path 2: Pasta nativa do sistema operacional (scan instantâneo de diretório)
      try {
        await this._scanAndIndexNativeDirectory(dir);
      } catch (scanErr) {
        console.warn('[StorageService] Falha no scan nativo:', scanErr);
      }

      scheduleBackgroundSync(100);
      return true;
    },

    /**
     * Obtém metadados rápidos (tamanho e mtime) sem transferir ou descriptografar o arquivo
     */
    async getFileStat(fileName) {
      const dir = getActiveDirectoryHandle();
      if (!dir) {
        throw new Error('Pasta de dados indisponível.');
      }

      if (dir.isServer && !dir.relPath) {
        if (fileName === 'ocorrencias.csv') {
          try {
            const batchUrl = `/api/storage/occurrences/batch?knownSig=${encodeURIComponent(_lastKnownBatchSig || '')}&_t=${Date.now()}`;
            const res = await fetch(batchUrl, { method: 'GET', headers: { 'Cache-Control': 'no-cache' } });
            if (res.ok) {
              const payload = await res.json();
              if (payload && !payload.unchanged) {
                _preloadedOccurrencesBatch = payload;
              }
              const size = Number(payload?.totalSize ?? payload?.size ?? 0);
              const mtimeMs = Number(payload?.maxMtimeMs ?? payload?.mtimeMs ?? 0);
              return { exists: size > 0 || (payload?.count || 0) > 0, size, mtimeMs, sig: payload?.sig || '' };
            }
          } catch {}
        }
        if (typeof fetchServerStorage !== 'function') {
          throw new Error('fetchServerStorage indisponível no cliente.');
        }
        const res = await fetchServerStorage(fileName, 'HEAD');
        if (res.status === 404) {
          return { exists: false, size: 0, mtimeMs: 0 };
        }
        if (!res.ok) {
          throw new Error(`Falha ao verificar metadados (${res.status}): ${fileName}`);
        }
        const sizeHeader = res.headers.get('X-File-Size') ?? res.headers.get('Content-Length');
        const mtimeHeader = res.headers.get('X-File-Mtime');
        return {
          exists: true,
          size: sizeHeader !== null ? Number(sizeHeader) : 0,
          mtimeMs: mtimeHeader !== null ? Number(mtimeHeader) : 0
        };
      }

      // Handle nativo com indexação em memória
      if (this._nativeFilesMap && !this._nativeFilesMap.has(fileName) && fileName !== 'ocorrencias.csv') {
        return { exists: false, size: 0, mtimeMs: 0 };
      }

      if (fileName === 'ocorrencias.csv') {
        try {
          const handles = await this._listNativeOccurrenceFileHandles(dir);
          let totalSize = 0;
          let maxMtime = 0;
          let hasAny = handles.length > 0;
          if (handles.length > 0) {
            const chunkSize = 64;
            for (let i = 0; i < handles.length; i += chunkSize) {
              const slice = handles.slice(i, i + chunkSize);
              const stats = await Promise.all(slice.map(async h => {
                try {
                  const f = await h.handle.getFile();
                  return { size: Number(f.size || 0), mtimeMs: Number(f.lastModified || 0) };
                } catch {
                  return { size: 0, mtimeMs: 0 };
                }
              }));
              for (const st of stats) {
                totalSize += st.size;
                if (st.mtimeMs > maxMtime) maxMtime = st.mtimeMs;
              }
            }
          }
          try {
            const fh = this._nativeFilesMap?.get(fileName) || await dir.getFileHandle(fileName, { create: false });
            const f = await fh.getFile();
            const fSize = Number(f.size || 0);
            const fMtime = Number(f.lastModified || 0);
            if (fSize > 0) {
              hasAny = true;
              totalSize += fSize;
              if (fMtime > maxMtime) maxMtime = fMtime;
            }
          } catch {}
          const nativeSig = `${handles.length}:${maxMtime}:${totalSize}`;
          return { exists: hasAny, size: totalSize, mtimeMs: maxMtime, sig: nativeSig };
        } catch {}
      }

      try {
        const fh = this._nativeFilesMap?.get(fileName) || await dir.getFileHandle(fileName, { create: false });
        const f = await fh.getFile();
        return {
          exists: true,
          size: Number(f.size || 0),
          mtimeMs: Number(f.lastModified || 0)
        };
      } catch (err) {
        if (err?.name === 'NotFoundError') {
          return { exists: false, size: 0, mtimeMs: 0 };
        }
        throw err;
      }
    },

    /**
     * Lê o conteúdo bruto e metadados de versão/mtime do arquivo
     */
    async readRawFileWithMeta(fileName) {
      const dir = getActiveDirectoryHandle();
      if (!dir) {
        throw new Error('Pasta de dados indisponível.');
      }

      if (dir.isServer && !dir.relPath) {
        const cachedRaw = _rawFileCache.get(fileName);
        if (cachedRaw && typeof cachedRaw.rawText === 'string') {
          return {
            rawText: cachedRaw.rawText,
            size: cachedRaw.size,
            mtimeMs: cachedRaw.mtimeMs
          };
        }
        if (typeof fetchServerStorage !== 'function') {
          throw new Error('fetchServerStorage indisponível no cliente.');
        }
        const res = await fetchServerStorage(fileName, 'GET');
        if (res.status === 404) {
          const err = new Error(`Arquivo não encontrado: ${fileName}`);
          err.name = 'NotFoundError';
          throw err;
        }
        if (!res.ok) {
          throw new Error(`Falha ao ler arquivo (${res.status}): ${fileName}`);
        }
        const sizeHeader = res.headers.get('X-File-Size') ?? res.headers.get('Content-Length');
        const mtimeHeader = res.headers.get('X-File-Mtime');
        const rawText = await res.text();
        return {
          rawText,
          size: sizeHeader !== null ? Number(sizeHeader) : rawText.length,
          mtimeMs: mtimeHeader !== null ? Number(mtimeHeader) : 0
        };
      }

      const h = this._nativeFilesMap?.get(fileName) || await dir.getFileHandle(fileName);
      const f = await h.getFile();
      const rawText = await f.text();
      return {
        rawText,
        size: Number(f.size || rawText.length),
        mtimeMs: Number(f.lastModified || 0)
      };
    },

    /**
     * Lê diretamente o conteúdo bruto gravado no disco/servidor
     */
    async readRawFile(fileName) {
      const { rawText } = await this.readRawFileWithMeta(fileName);
      return rawText;
    },

    /**
     * Grava conteúdo bruto diretamente no arquivo físico/servidor com confirmação de persistência
     */
    async writeRawFile(fileName, content, options = {}) {
      const dir = getActiveDirectoryHandle();
      if (!dir) {
        throw new Error('Pasta de dados indisponível.');
      }

      const strContent = typeof content === 'string' ? content : String(content ?? '');

      if (dir.isServer && !dir.relPath) {
        if (typeof fetchServerStorage !== 'function') {
          throw new Error('fetchServerStorage indisponível no cliente.');
        }
        const blob = new Blob([strContent], { type: 'text/csv; charset=utf-8' });
        const extraParams = {};
        if (options?.releasedProtocol) extraParams.releasedProtocol = options.releasedProtocol;
        if (options?.expectedMtime !== undefined && options?.expectedMtime !== null && options?.expectedMtime > 0) {
          extraParams.expectedMtime = options.expectedMtime;
        }
        const res = await fetchServerStorage(fileName, 'PUT', blob, extraParams);
        if (res.status === 409) {
          const conflictErr = new Error(`Conflito de concorrência ao gravar ${fileName}: o arquivo foi modificado por outro usuário.`);
          conflictErr.name = 'InvalidStateError';
          conflictErr.code = 'ERRO_DE_SINCRONIZACAO';
          throw conflictErr;
        }
        if (!res.ok) {
          throw new Error(`Falha ao gravar arquivo (${res.status}): ${fileName}`);
        }
        const info = await res.json().catch(() => null);
        if (info && typeof info.size === 'number' && info.size !== blob.size) {
          throw new Error(`Verificação de persistência falhou para ${fileName}: tamanho divergente.`);
        }
        if (isIndividualOccurrenceFileName(fileName) || fileName === 'ocorrencias.csv') {
          _rawFileCache.delete('ocorrencias.csv');
          _lastKnownBatchSig = '';
        }
        return {
          ok: true,
          size: info?.size ?? blob.size,
          mtimeMs: info?.mtimeMs ?? Date.now()
        };
      }

      // Gravação em handle nativo com escrita segura e confirmação pós-gravação
      const fh = await dir.getFileHandle(fileName, { create: true });
      if (options?.expectedMtime && options.expectedMtime > 0) {
        try {
          const currentFile = await fh.getFile();
          if (currentFile.lastModified && Math.abs(currentFile.lastModified - options.expectedMtime) > 5) {
            const conflictErr = new Error(`Conflito de concorrência ao gravar ${fileName}: o arquivo foi modificado externamente.`);
            conflictErr.name = 'InvalidStateError';
            conflictErr.code = 'ERRO_DE_SINCRONIZACAO';
            throw conflictErr;
          }
        } catch (checkErr) {
          if (checkErr?.name === 'InvalidStateError') throw checkErr;
        }
      }

      const signal = options?.signal;
      if (signal?.aborted) {
        throw signal.reason || new Error('Operação de salvamento abortada.');
      }

      const w = await fh.createWritable();
      let abortListener = null;
      if (signal) {
        abortListener = async () => {
          try { await w.abort(); } catch {}
        };
        signal.addEventListener('abort', abortListener, { once: true });
        if (signal.aborted) {
          try { await w.abort(); } catch {}
          throw signal.reason || new Error('Operação de salvamento abortada.');
        }
      }

      try {
        await w.write(strContent);
        if (signal?.aborted) {
          try { await w.abort(); } catch {}
          throw signal.reason || new Error('Operação de salvamento abortada.');
        }
        await w.close();
        const verifyFile = await fh.getFile();
        if (strContent.length > 0 && verifyFile.size === 0) {
          throw new Error(`Confirmação de persistência falhou: ${fileName} ficou vazio após gravação.`);
        }
        if (this._nativeFilesMap) {
          this._nativeFilesMap.set(fileName, fh);
        }
        this._nativeHandlesCache = null;
        if (isIndividualOccurrenceFileName(fileName) || fileName === 'ocorrencias.csv') {
          _rawFileCache.delete('ocorrencias.csv');
          _lastKnownBatchSig = '';
        }
        if (options?.releasedProtocol && fileName === 'ocorrencias.csv') {
          await this._markNativeProtocolUtilized(options.releasedProtocol, options.id_interno || '').catch(err => {
            logProtocolError('markNativeProtocolUtilized', err, { protocolo: options.releasedProtocol });
          });
        }
        return {
          ok: true,
          size: Number(verifyFile.size || strContent.length),
          mtimeMs: Number(verifyFile.lastModified || Date.now())
        };
      } catch (err) {
        try { await w.abort(); } catch {}
        throw err;
      } finally {
        if (signal && abortListener) {
          signal.removeEventListener('abort', abortListener);
        }
      }
    },

    /**
     * Adiciona conteúdo bruto no final do arquivo de forma segura (Modo Append nativo)
     * Enfileirado via Write Queue / withFileLock para eliminar race conditions em saves concorrentes.
     */
    async appendRawFile(fileName, content, extraParams = {}) {
      return await this.withFileLock(fileName, async () => {
        const dir = getActiveDirectoryHandle();
        if (!dir) throw new Error('Pasta de dados indisponível.');
        const strContent = typeof content === 'string' ? content : String(content ?? '');
        if (!strContent) return true;
        const signal = extraParams?.signal;

        if (signal?.aborted) {
          throw signal.reason || new Error('Operação de salvamento abortada.');
        }

        if (dir.isServer && !dir.relPath) {
          if (typeof fetchServerStorage !== 'function') {
            throw new Error('fetchServerStorage indisponível no cliente.');
          }
          const blob = new Blob([strContent], { type: 'text/csv; charset=utf-8' });
          const res = await fetchServerStorage(fileName, 'POST', blob, { action: 'append', ...extraParams });
          if (!res.ok) {
            throw new Error(`Falha ao adicionar dados ao arquivo (${res.status}): ${fileName}`);
          }
          _rawFileCache.delete(fileName);
          return true;
        }

        let lastErr = null;
        for (let attempt = 0; attempt < 5; attempt++) {
          if (signal?.aborted) {
            throw signal.reason || new Error('Operação de salvamento abortada.');
          }
          let w = null;
          let abortListener = null;
          try {
            const fh = await dir.getFileHandle(fileName, { create: true });
            const file = await fh.getFile();
            const currentSize = file.size;

            if (signal?.aborted) {
              throw signal.reason || new Error('Operação de salvamento abortada.');
            }

            // Abre a stream preservando os bytes anteriores
            w = await fh.createWritable({ keepExistingData: true });

            if (signal) {
              abortListener = async () => {
                if (w) try { await w.abort(); } catch {}
              };
              signal.addEventListener('abort', abortListener, { once: true });
              if (signal.aborted) {
                if (w) try { await w.abort(); } catch {}
                throw signal.reason || new Error('Operação de salvamento abortada.');
              }
            }

            // Posiciona o ponteiro de gravação exatamente no byte final (stream.seek)
            await w.seek(currentSize);
            await w.write(strContent);

            if (signal?.aborted) {
              if (w) try { await w.abort(); } catch {}
              throw signal.reason || new Error('Operação de salvamento abortada.');
            }

            await w.close();
            w = null;

            if (extraParams?.releasedProtocol && fileName === 'ocorrencias.csv') {
              await this._markNativeProtocolUtilized(extraParams.releasedProtocol, extraParams.id_interno || '').catch(err => {
                logProtocolError('markNativeProtocolUtilized', err, { protocolo: extraParams.releasedProtocol });
              });
            }

            _rawFileCache.delete(fileName);
            return true;
          } catch (writeErr) {
            if (w) {
              try { await w.abort(); } catch {}
            }
            lastErr = writeErr;
            if (signal?.aborted || writeErr?.name === 'AbortError' || writeErr?.name === 'TimeoutError') {
              throw writeErr;
            }
            const isConflict = writeErr?.name === 'InvalidStateError' || /state had changed|Conflito/i.test(String(writeErr?.message || ''));
            if (isConflict && attempt < 4) {
              const delay = 30 + Math.random() * 50 * (attempt + 1);
              await new Promise(r => setTimeout(r, delay));
              continue;
            }
            throw writeErr;
          } finally {
            if (signal && abortListener) {
              signal.removeEventListener('abort', abortListener);
            }
          }
        }
        throw lastErr;
      });
    },

    /**
     * Verifica se o conteúdo do arquivo está cifrado
     */
    isEncryptedFile(content) {
      if (!window.CryptoService) return false;
      return window.CryptoService.isEncryptedFile(content);
    },

    async _listNativeOccurrenceFileHandles(dir, options = {}) {
      if (!dir) return [];
      const now = Date.now();
      if (!options?.force && this._nativeHandlesCache && this._nativeHandlesCache.dir === dir && (now - this._nativeHandlesCache.ts < 2000)) {
        return this._nativeHandlesCache.handles;
      }
      const found = [];
      let count = 0;
      let scanned = false;
      try {
        if (typeof dir.entries === 'function') {
          for await (const [name, handle] of dir.entries()) {
            if (handle.kind === 'file') {
              if (this._nativeFilesMap) {
                this._nativeFilesMap.set(name, handle);
              }
              if (isIndividualOccurrenceFileName(name)) {
                found.push({ name, handle });
              }
            }
            if ((++count & 255) === 0) {
              await new Promise(r => setTimeout(r, 0));
            }
          }
          scanned = true;
        } else if (typeof dir.values === 'function') {
          for await (const handle of dir.values()) {
            if (handle.kind === 'file') {
              if (this._nativeFilesMap) {
                this._nativeFilesMap.set(handle.name, handle);
              }
              if (isIndividualOccurrenceFileName(handle.name)) {
                found.push({ name: handle.name, handle });
              }
            }
            if ((++count & 255) === 0) {
              await new Promise(r => setTimeout(r, 0));
            }
          }
          scanned = true;
        }
      } catch (err) {
        console.warn('[StorageService] Falha ao varrer diretório nativo para ocorrências:', err);
      }

      if (!scanned && this._nativeFilesMap) {
        for (const [name, handle] of this._nativeFilesMap.entries()) {
          if (isIndividualOccurrenceFileName(name)) {
            found.push({ name, handle });
          }
        }
      }

      found.sort((a, b) => a.name.localeCompare(b.name));
      this._nativeHandlesCache = { dir, ts: Date.now(), handles: found };
      return found;
    },

    async _decryptIndividualOccurrenceText(indivName, rawText, mtimeMs = 0, size = 0) {
      const trimmed = String(rawText || '').trim();
      if (!trimmed) return [];
      const rawSig = `${trimmed.length}:${trimmed.slice(0, 48)}:${trimmed.slice(-48)}`;
      const cached = _individualOccFileCache.get(indivName);
      if (cached && cached.rawSig === rawSig && Array.isArray(cached.rows)) {
        cached.mtimeMs = mtimeMs || cached.mtimeMs;
        cached.size = size || cached.size;
        return cached.rows;
      }

      let csvPlain = trimmed;
      if (this.isEncryptedFile(trimmed)) {
        csvPlain = await window.CryptoService.decrypt(trimmed);
      }
      const parsed = csvPlain.length > 250000 ? await parseCsvAsync(csvPlain) : parseCsv(csvPlain);
      if (parsed.length > 5000) {
        await new Promise(r => setTimeout(r, 0));
      }
      const rows = (!parsed || !parsed.length) ? [] : consolidateVersionedRows(parsed);
      _individualOccFileCache.set(indivName, {
        rawSig,
        mtimeMs: mtimeMs || Date.now(),
        size: size || trimmed.length,
        rows
      });
      if (indivName !== '__legacy_ocorrencias.csv__') {
        for (const r of rows) {
          const idInt = String(r.id_interno || '').trim();
          const idOcc = String(r.id_ocorrencia || '').trim();
          const proto = String(r.numero_protocolo || '').trim().toUpperCase();
          if (idInt) _recordKeyToFileMap.set(`INT:${idInt}`, indivName);
          if (idOcc) _recordKeyToFileMap.set(`OCC:${idOcc}`, indivName);
          if (proto) _recordKeyToFileMap.set(`PROTO:${proto}`, indivName);
        }
      }
      return rows;
    },

    async _readOccurrencesBatchFromStorage(options = {}) {
      const fileName = 'ocorrencias.csv';
      const cached = _rawFileCache.get(fileName);
      if (cached && !options?.force && Array.isArray(cached.rows)) {
        return cached.rows.slice();
      }

      const dir = getActiveDirectoryHandle();
      if (!dir) {
        if (options?.optional) return [];
        throw new Error('Pasta de dados indisponível.');
      }

      perfStart('[SIGESP:Perf] leitura em lote ocorrencias');
      try {
        // MODO 1: Servidor de desenvolvimento / API local (/api/storage/occurrences/batch)
        if (dir.isServer && !dir.relPath) {
          try {
            let payload = _preloadedOccurrencesBatch;
            _preloadedOccurrencesBatch = null;

            if (!payload) {
              const batchUrl = `/api/storage/occurrences/batch?knownSig=${encodeURIComponent(_lastKnownBatchSig || '')}&_t=${Date.now()}`;
              const res = await fetch(batchUrl, { method: 'GET' });
              if (res.ok) {
                payload = await res.json();
              }
            }

            if (payload) {
              if (payload && payload.unchanged && cached && Array.isArray(cached.rows)) {
                const effMtime = Number(payload?.maxMtimeMs ?? payload?.mtimeMs ?? cached.mtimeMs);
                const effSize = Number(payload?.totalSize ?? payload?.size ?? cached.size);
                cached.mtimeMs = effMtime;
                cached.size = effSize;
                if (typeof window !== 'undefined' && typeof window.syncFreshCsvMeta === 'function') {
                  window.syncFreshCsvMeta(fileName, effMtime, effSize);
                }
                return cached.rows.slice();
              }

              const files = Array.isArray(payload?.files) ? payload.files : [];
              const activeNames = new Set(files.map(f => f.name));
              if (payload?.legacyRawText) activeNames.add('__legacy_ocorrencias.csv__');
              for (const k of _individualOccFileCache.keys()) {
                if (!activeNames.has(k)) _individualOccFileCache.delete(k);
              }

              let allRows = [];
              const chunkSize = 128;
              for (let i = 0; i < files.length; i += chunkSize) {
                const slice = files.slice(i, i + chunkSize);
                const decodedLists = await Promise.all(
                  slice.map(f =>
                    this._decryptIndividualOccurrenceText(f.name, f.rawText, f.mtimeMs, f.size).catch(err => {
                      console.warn(`[StorageService] Ignorando arquivo de ocorrência inválido (${f.name}):`, err);
                      return [];
                    })
                  )
                );
                for (const list of decodedLists) {
                  for (const r of list) allRows.push(r);
                }
                if (i + chunkSize < files.length) {
                  await new Promise(r => setTimeout(r, 0));
                }
              }

              let legacyRows = [];
              if (payload?.legacyRawText && String(payload.legacyRawText).trim()) {
                try {
                  legacyRows = await this._decryptIndividualOccurrenceText(
                    '__legacy_ocorrencias.csv__',
                    payload.legacyRawText,
                    payload.maxMtimeMs || payload.mtimeMs,
                    payload.totalSize || payload.size
                  );
                } catch (legacyDecErr) {
                  console.warn('[StorageService] Falha ao descriptografar base legada batch:', legacyDecErr);
                }
              }

              let consolidated;
              if (files.length === 0 && legacyRows.length > 0) {
                consolidated = legacyRows;
              } else {
                for (const r of legacyRows) allRows.push(r);
                if (allRows.length > 5000) await new Promise(r => setTimeout(r, 0));
                consolidated = consolidateVersionedRows(allRows);
              }

              const finalMtime = Number(payload?.maxMtimeMs ?? payload?.mtimeMs ?? Date.now());
              const finalSize = Number(payload?.totalSize ?? payload?.size ?? 0);
              const batchSig = String(payload?.sig || `${files.length}:${finalMtime}:${finalSize}`);
              _lastKnownBatchSig = batchSig;

              _rawFileCache.set(fileName, {
                rawSig: batchSig,
                rows: consolidated,
                mtimeMs: finalMtime,
                size: finalSize
              });
              if (typeof window !== 'undefined' && typeof window.syncFreshCsvMeta === 'function') {
                window.syncFreshCsvMeta(fileName, finalMtime, finalSize);
              }

              return consolidated;
            }
          } catch (batchNetErr) {
            console.warn('[StorageService] Falha na rota batch de ocorrências, acionando fallback direto:', batchNetErr);
          }

          // Fallback resiliente direto para ocorrencias.csv via readRawFileWithMeta
          try {
            const { rawText, mtimeMs, size } = await this.readRawFileWithMeta('ocorrencias.csv');
            if (rawText && rawText.trim()) {
              const legacyRows = await this._decryptIndividualOccurrenceText(
                '__legacy_ocorrencias.csv__',
                rawText,
                mtimeMs,
                size
              );
              const batchSig = `1:${mtimeMs}:${size}`;
              _lastKnownBatchSig = batchSig;
              _rawFileCache.set(fileName, {
                rawSig: batchSig,
                rows: legacyRows,
                mtimeMs: mtimeMs || Date.now(),
                size: size || rawText.length
              });
              if (typeof window !== 'undefined' && typeof window.syncFreshCsvMeta === 'function') {
                window.syncFreshCsvMeta(fileName, mtimeMs, size);
              }
              return legacyRows;
            }
          } catch (directErr) {
            console.warn('[StorageService] Falha na leitura direta de ocorrencias.csv:', directErr);
            if (cached && Array.isArray(cached.rows)) {
              return cached.rows.slice();
            }
            if (options?.optional) return [];
            throw directErr;
          }
        }

        // MODO 2: Pasta Local Nativa (FileSystemDirectoryHandle)
        const handles = await this._listNativeOccurrenceFileHandles(dir, options);
        let legacyFile = null;
        try {
          const legFh = await dir.getFileHandle('ocorrencias.csv', { create: false });
          legacyFile = await legFh.getFile();
        } catch {}

        if (handles.length === 0 && (!legacyFile || legacyFile.size === 0)) {
          _rawFileCache.set(fileName, { rawSig: '0:0:0', rows: [], mtimeMs: 0, size: 0 });
          if (typeof window !== 'undefined' && typeof window.syncFreshCsvMeta === 'function') {
            window.syncFreshCsvMeta(fileName, 0, 0);
          }
          return [];
        }

        const activeNames = new Set(handles.map(h => h.name));
        if (legacyFile && legacyFile.size > 0) activeNames.add('__legacy_ocorrencias.csv__');
        for (const k of _individualOccFileCache.keys()) {
          if (!activeNames.has(k)) _individualOccFileCache.delete(k);
        }

        let totalSize = 0;
        let maxMtime = 0;
        const allRows = [];
        const chunkSize = 128;

        for (let i = 0; i < handles.length; i += chunkSize) {
          const slice = handles.slice(i, i + chunkSize);
          const decodedLists = await Promise.all(
            slice.map(async ({ name, handle }) => {
              try {
                const f = await handle.getFile();
                const fSize = Number(f.size || 0);
                const fMtime = Number(f.lastModified || 0);
                totalSize += fSize;
                if (fMtime > maxMtime) maxMtime = fMtime;

                const cachedFile = _individualOccFileCache.get(name);
                if (cachedFile && cachedFile.mtimeMs > 0 && cachedFile.mtimeMs === fMtime && cachedFile.size === fSize) {
                  return cachedFile.rows;
                }
                const rawText = await f.text();
                return await this._decryptIndividualOccurrenceText(name, rawText, fMtime, fSize);
              } catch (err) {
                console.warn(`[StorageService] Falha ao ler arquivo individual ${name}:`, err);
                return [];
              }
            })
          );
          for (const list of decodedLists) {
            for (const r of list) allRows.push(r);
          }
          if (i + chunkSize < handles.length) {
            await new Promise(r => setTimeout(r, 0));
          }
        }

        let legacyRows = [];
        if (legacyFile && legacyFile.size > 0) {
          try {
            const lSize = Number(legacyFile.size || 0);
            const lMtime = Number(legacyFile.lastModified || 0);
            totalSize += lSize;
            if (lMtime > maxMtime) maxMtime = lMtime;

            const cachedLeg = _individualOccFileCache.get('__legacy_ocorrencias.csv__');
            if (cachedLeg && cachedLeg.mtimeMs > 0 && cachedLeg.mtimeMs === lMtime && cachedLeg.size === lSize && Array.isArray(cachedLeg.rows)) {
              legacyRows = cachedLeg.rows;
            } else {
              const legText = await legacyFile.text();
              legacyRows = await this._decryptIndividualOccurrenceText(
                '__legacy_ocorrencias.csv__',
                legText,
                lMtime,
                lSize
              );
            }
          } catch {}
        }

        let consolidated;
        if (handles.length === 0 && legacyRows.length > 0) {
          consolidated = legacyRows;
        } else {
          for (const r of legacyRows) allRows.push(r);
          if (allRows.length > 5000) await new Promise(r => setTimeout(r, 0));
          consolidated = consolidateVersionedRows(allRows);
        }

        const batchSig = `${handles.length}:${maxMtime}:${totalSize}`;
        _lastKnownBatchSig = batchSig;

        _rawFileCache.set(fileName, {
          rawSig: batchSig,
          rows: consolidated,
          mtimeMs: maxMtime || Date.now(),
          size: totalSize
        });
        if (typeof window !== 'undefined' && typeof window.syncFreshCsvMeta === 'function') {
          window.syncFreshCsvMeta(fileName, maxMtime || Date.now(), totalSize);
        }

        return consolidated;
      } finally {
        perfEnd('[SIGESP:Perf] leitura em lote ocorrencias');
      }
    },

    async _writeOccurrencesBatchToStorage(rows, headers, options = {}) {
      const dir = getActiveDirectoryHandle();
      if (!dir) {
        throw new Error('Pasta de dados indisponível.');
      }

      const nowFn = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
      const tProc0 = nowFn();
      const safeRows = Array.isArray(rows) ? rows : [];
      const consolidatedRows = (options?.alreadyConsolidated || safeRows._consolidated) ? safeRows : consolidateVersionedRows(safeRows);
      const tProc1 = nowFn();

      const resolvedHeaders = (headers && headers.length)
        ? headers
        : (CANONICAL_SEEDS['ocorrencias.csv']?.headers || (consolidatedRows.length ? Object.keys(consolidatedRows[0]) : (typeof H !== 'undefined' ? H.occ : [])));

      if (!window.CryptoService) {
        throw new Error('CryptoService não carregado.');
      }

      let existingNames = [];
      let hasLegacyBase = false;
      if (dir.isServer && !dir.relPath) {
        try {
          const batchRes = await fetch(`/api/storage/occurrences/batch?_t=${Date.now()}`, { method: 'GET' });
          if (batchRes.ok) {
            const bData = await batchRes.json();
            if (Array.isArray(bData?.files)) {
              existingNames = bData.files.map(f => f.name);
            }
            if (bData?.sig && String(bData.sig).includes(':L:')) {
              hasLegacyBase = true;
            }
          }
        } catch {}
      } else {
        this._nativeHandlesCache = null;
        const handles = await this._listNativeOccurrenceFileHandles(dir);
        existingNames = handles.map(h => h.name);
        try {
          const legFh = await dir.getFileHandle('ocorrencias.csv', { create: false });
          const legF = await legFh.getFile();
          if (legF && legF.size > 0) hasLegacyBase = true;
        } catch {}
      }

      const existingNameSet = new Set(existingNames);
      const targetFileSet = new Set();
      let totalSize = 0;
      let maxMtime = Date.now();
      const tWrite0 = nowFn();

      // Se existe base legada massiva (> 250 registros), preserva a base em ocorrencias.csv e grava individualmente apenas os arquivos individuais ativos
      if (hasLegacyBase && consolidatedRows.length > 250) {
        const indivRowsToWrite = [];
        const legacyRowsToKeep = [];
        for (const r of consolidatedRows) {
          const indivFileName = getIndividualOccurrenceFileName(r);
          const idInt = String(r.id_interno || '').trim();
          const idOcc = String(r.id_ocorrencia || '').trim();
          const proto = String(r.numero_protocolo || '').trim().toUpperCase();
          const isMappedIndiv = existingNameSet.has(indivFileName) ||
            (idInt && _recordKeyToFileMap.has(`INT:${idInt}`)) ||
            (idOcc && _recordKeyToFileMap.has(`OCC:${idOcc}`)) ||
            (proto && _recordKeyToFileMap.has(`PROTO:${proto}`));
          if (isMappedIndiv) {
            targetFileSet.add(indivFileName);
            indivRowsToWrite.push({ record: r, indivFileName });
          } else {
            legacyRowsToKeep.push(r);
          }
        }

        const chunkSize = 32;
        for (let i = 0; i < indivRowsToWrite.length; i += chunkSize) {
          const slice = indivRowsToWrite.slice(i, i + chunkSize);
          await Promise.all(slice.map(async ({ record, indivFileName }) => {
            const cachedIndiv = _individualOccFileCache.get(indivFileName);
            if (cachedIndiv && existingNameSet.has(indivFileName) && Array.isArray(cachedIndiv.rows) && cachedIndiv.rows.length === 1) {
              if (JSON.stringify(cachedIndiv.rows[0]) === JSON.stringify(record)) {
                totalSize += cachedIndiv.size || 0;
                if (cachedIndiv.mtimeMs > maxMtime) maxMtime = cachedIndiv.mtimeMs;
                return;
              }
            }
            const singleCsv = serializeCsv([record], resolvedHeaders);
            const encPayload = await window.CryptoService.encrypt(singleCsv, { fileName: indivFileName, rowCount: 1 });
            const writeMeta = await this.writeRawFile(indivFileName, encPayload);
            const fSize = writeMeta?.size || encPayload.length;
            const fMtime = writeMeta?.mtimeMs || Date.now();
            totalSize += fSize;
            if (fMtime > maxMtime) maxMtime = fMtime;
            const rawSig = `${encPayload.length}:${encPayload.slice(0, 48)}:${encPayload.slice(-48)}`;
            _individualOccFileCache.set(indivFileName, { rawSig, mtimeMs: fMtime, size: fSize, rows: [{ ...record }] });
          }));
          if (i + chunkSize < indivRowsToWrite.length) {
            await new Promise(r => setTimeout(r, 0));
          }
        }

        const toDelete = existingNames.filter(name => !targetFileSet.has(name));
        if (toDelete.length > 0) {
          await Promise.all(toDelete.map(async delName => {
            _individualOccFileCache.delete(delName);
            await this.deleteFile(delName).catch(() => {});
          }));
        }

        const cachedLeg = _individualOccFileCache.get('__legacy_ocorrencias.csv__');
        if (!cachedLeg || !Array.isArray(cachedLeg.rows) || cachedLeg.rows.length !== legacyRowsToKeep.length) {
          const legCsv = serializeCsv(legacyRowsToKeep, resolvedHeaders);
          const legEnc = await window.CryptoService.encrypt(legCsv, { fileName: 'ocorrencias.csv', rowCount: legacyRowsToKeep.length });
          const legMeta = await this.writeRawFile('ocorrencias.csv', legEnc);
          const lSize = legMeta?.size || legEnc.length;
          const lMtime = legMeta?.mtimeMs || Date.now();
          totalSize += lSize;
          if (lMtime > maxMtime) maxMtime = lMtime;
          const legSig = `${legEnc.length}:${legEnc.slice(0, 48)}:${legEnc.slice(-48)}`;
          _individualOccFileCache.set('__legacy_ocorrencias.csv__', { rawSig: legSig, mtimeMs: lMtime, size: lSize, rows: legacyRowsToKeep });
        } else {
          totalSize += cachedLeg.size || 0;
          if (cachedLeg.mtimeMs > maxMtime) maxMtime = cachedLeg.mtimeMs;
        }
      } else {
        const chunkSize = 32;
        for (let i = 0; i < consolidatedRows.length; i += chunkSize) {
          const slice = consolidatedRows.slice(i, i + chunkSize);
          await Promise.all(
            slice.map(async (record, idx) => {
              const indivFileName = getIndividualOccurrenceFileName(record);
              targetFileSet.add(indivFileName);

              const idInt = String(record.id_interno || '').trim();
              const idOcc = String(record.id_ocorrencia || '').trim();
              const proto = String(record.numero_protocolo || '').trim().toUpperCase();
              if (idInt) _recordKeyToFileMap.set(`INT:${idInt}`, indivFileName);
              if (idOcc) _recordKeyToFileMap.set(`OCC:${idOcc}`, indivFileName);
              if (proto) _recordKeyToFileMap.set(`PROTO:${proto}`, indivFileName);

              const cachedIndiv = _individualOccFileCache.get(indivFileName);
              if (cachedIndiv && existingNameSet.has(indivFileName) && Array.isArray(cachedIndiv.rows) && cachedIndiv.rows.length === 1) {
                const prevRec = cachedIndiv.rows[0];
                if (JSON.stringify(prevRec) === JSON.stringify(record)) {
                  totalSize += cachedIndiv.size || 0;
                  if (cachedIndiv.mtimeMs > maxMtime) maxMtime = cachedIndiv.mtimeMs;
                  return;
                }
              }

              const singleCsv = serializeCsv([record], resolvedHeaders);
              const encPayload = await window.CryptoService.encrypt(singleCsv, {
                fileName: indivFileName,
                rowCount: 1
              });

              const writeOpts = (i === 0 && idx === 0 && options?.releasedProtocol)
                ? { releasedProtocol: options.releasedProtocol, id_interno: record.id_interno }
                : {};
              const writeMeta = await this.writeRawFile(indivFileName, encPayload, writeOpts);
              const fSize = writeMeta?.size || encPayload.length;
              const fMtime = writeMeta?.mtimeMs || Date.now();
              totalSize += fSize;
              if (fMtime > maxMtime) maxMtime = fMtime;

              const rawSig = `${encPayload.length}:${encPayload.slice(0, 48)}:${encPayload.slice(-48)}`;
              _individualOccFileCache.set(indivFileName, {
                rawSig,
                mtimeMs: fMtime,
                size: fSize,
                rows: [{ ...record }]
              });
            })
          );
          if (i + chunkSize < consolidatedRows.length) {
            await new Promise(r => setTimeout(r, 0));
          }
        }

        const toDelete = existingNames.filter(name => !targetFileSet.has(name));
        if (toDelete.length > 0) {
          await Promise.all(
            toDelete.map(async delName => {
              _individualOccFileCache.delete(delName);
              await this.deleteFile(delName).catch(() => {});
            })
          );
        }
      }

      this._nativeHandlesCache = null;
      const tWrite1 = nowFn();
      const batchSig = `${targetFileSet.size}:${maxMtime}:${totalSize}`;
      _lastKnownBatchSig = batchSig;

      _rawFileCache.set('ocorrencias.csv', {
        rawSig: batchSig,
        rows: consolidatedRows,
        mtimeMs: maxMtime,
        size: totalSize,
        lastWriteTimings: {
          processamento: +(tProc1 - tProc0).toFixed(2),
          serializacao: 0,
          criptografia: 0,
          gravacao: +(tWrite1 - tWrite0).toFixed(2)
        }
      });

      if (typeof window !== 'undefined' && typeof window.syncFreshCsvMeta === 'function') {
        window.syncFreshCsvMeta('ocorrencias.csv', maxMtime, totalSize);
      }

      return consolidatedRows.slice();
    },

    async fetchFreshOccurrencesCsv(options = {}, metaMap = null) {
      const fileName = 'ocorrencias.csv';
      const prevMeta = metaMap ? metaMap.get(fileName) : null;
      const isForce = Boolean(options?.force);
      const stat = await this.getFileStat(fileName).catch(() => ({ exists: false, size: 0, mtimeMs: 0 }));

      if (options?.onlyIfChanged && prevMeta && !isForce) {
        if (stat.sig && prevMeta.rawSig && stat.sig === prevMeta.rawSig && stat.size === prevMeta.size) {
          return null;
        }
        if (!stat.sig && stat.mtimeMs > 0 && Math.abs(stat.mtimeMs - prevMeta.mtimeMs) <= 2 && stat.size === prevMeta.size) {
          return null;
        }
      }

      const prevSig = _lastKnownBatchSig;
      const rows = await this._readOccurrencesBatchFromStorage({ force: true, optional: true });
      const cached = _rawFileCache.get(fileName);
      if (options?.onlyIfChanged && !isForce && prevSig && cached?.rawSig && cached.rawSig === prevSig && cached.rawSig === prevMeta?.rawSig) {
        if (metaMap && cached) {
          metaMap.set(fileName, { mtimeMs: cached.mtimeMs, size: cached.size, rawSig: cached.rawSig });
        }
        return null;
      }

      const headers = CANONICAL_SEEDS[fileName]?.headers || (rows.length ? Object.keys(rows[0]) : []);
      const csvText = rows.length > 0 ? serializeCsv(rows, headers) : '';

      if (metaMap) {
        metaMap.set(fileName, {
          mtimeMs: cached?.mtimeMs || stat.mtimeMs || Date.now(),
          size: cached?.size || stat.size || csvText.length,
          rawSig: cached?.rawSig || `${rows.length}:${stat.mtimeMs}:${stat.size}`
        });
      }
      return csvText;
    },

    /**
     * Ingestão ultra-rápida de delta: recupera ou decodifica apenas um único arquivo individual de ocorrência
     */
    async fetchSingleOccurrenceRecord(fileName, rawText = null) {
      if (!fileName || !isIndividualOccurrenceFileName(fileName)) return null;
      let text = rawText;
      if (!text) {
        text = await this.readRawFile(fileName).catch(() => null);
      }
      if (!text) return null;
      const rows = await this._decryptIndividualOccurrenceText(fileName, text);
      return (rows && rows.length) ? { ...rows[0] } : null;
    },

    /**
     * Lê e descriptografa um arquivo CSV armazenado com integridade total e cache de envelope.
     */
    async readEncryptedCsv(fileName, options = {}) {
      if (fileName === 'ocorrencias.csv') {
        return await this._readOccurrencesBatchFromStorage(options);
      }
      const tReadStart = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      let meta = null;
      try {
        const cached = _rawFileCache.get(fileName);
        if (cached && Array.isArray(cached.rows) && !options?.force) {
          return cached.rows.map(r => ({ ...r }));
        }
        if (options?.force) {
          const stat = await this.getFileStat(fileName);
          if (!stat.exists || stat.size === 0) {
            _rawFileCache.set(fileName, { rawSig: '0::', rows: [], mtimeMs: stat?.mtimeMs || 0, size: 0 });
            return [];
          }
          if (cached && cached.mtimeMs > 0 && Array.isArray(cached.rows) && Math.abs(stat.mtimeMs - cached.mtimeMs) <= 2 && stat.size === cached.size) {
            return cached.rows.map(r => ({ ...r }));
          }
        }
        perfStart(`[SIGESP:Perf] leitura CSV (${fileName})`);
        meta = await this.readRawFileWithMeta(fileName);
        perfEnd(`[SIGESP:Perf] leitura CSV (${fileName})`);
      } catch (err) {
        perfEnd(`[SIGESP:Perf] leitura CSV (${fileName})`);
        if (err?.name === 'NotFoundError' || err?.code === 'ARQUIVO_NAO_ENCONTRADO' || options?.optional) {
          return [];
        }
        throw (typeof classifyCsvError === 'function' ? classifyCsvError(err, fileName, 'read', options) : err);
      }

      const rawText = meta?.rawText || '';
      if (!rawText || !rawText.trim()) {
        _rawFileCache.set(fileName, { rawSig: '0::', rows: [], mtimeMs: meta?.mtimeMs || 0, size: 0 });
        if (typeof window !== 'undefined' && typeof window.syncFreshCsvMeta === 'function') {
          window.syncFreshCsvMeta(fileName, meta?.mtimeMs || 0, 0);
        }
        return [];
      }

      const rawSig = `${rawText.length}:${rawText.slice(0, 48)}:${rawText.slice(-48)}`;
      const cachedByContent = _rawFileCache.get(fileName);
      if (cachedByContent && cachedByContent.rawSig === rawSig && Array.isArray(cachedByContent.rows)) {
        cachedByContent.mtimeMs = meta?.mtimeMs || cachedByContent.mtimeMs;
        cachedByContent.size = meta?.size || cachedByContent.size;
        if (typeof window !== 'undefined' && typeof window.syncFreshCsvMeta === 'function') {
          window.syncFreshCsvMeta(fileName, cachedByContent.mtimeMs, cachedByContent.size);
        }
        return cachedByContent.rows.map(r => ({ ...r }));
      }

      const isEnc = this.isEncryptedFile(rawText);

      // CASO 1: Arquivo está criptografado com o envelope AES-GCM
      if (isEnc) {
        try {
          perfStart(`[SIGESP:Perf] descriptografia (${fileName})`);
          const decryptedCsv = await window.CryptoService.decrypt(rawText);
          perfEnd(`[SIGESP:Perf] descriptografia (${fileName})`);

          perfStart(`[SIGESP:Perf] interpretacao registros (${fileName})`);
          const rawRows = parseCsv(decryptedCsv);
          const rows = consolidateVersionedRows(rawRows);
          perfEnd(`[SIGESP:Perf] interpretacao registros (${fileName})`);

          const finalMtime = meta?.mtimeMs || Date.now();
          const finalSize = meta?.size || rawText.length;
          _rawFileCache.set(fileName, {
            rawSig,
            rows: rows.map(r => ({ ...r })),
            mtimeMs: finalMtime,
            size: finalSize
          });
          if (typeof window !== 'undefined' && typeof window.syncFreshCsvMeta === 'function') {
            window.syncFreshCsvMeta(fileName, finalMtime, finalSize);
          }
          return rows;
        } catch (decErr) {
          perfEnd(`[SIGESP:Perf] descriptografia (${fileName})`);
          console.error('[StorageService:readEncryptedCsv]', {
            modulo: 'StorageService',
            funcao: 'readEncryptedCsv',
            operacao: 'decrypt',
            arquivo: fileName,
            etapa: 'descriptografia',
            erro: decErr?.message || String(decErr)
          });
          throw (typeof classifyCsvError === 'function' ? classifyCsvError(decErr, fileName, 'decrypt') : decErr);
        }
      }

      // CASO 2: Arquivo em texto plano legado -> interpreta e migra automaticamente para AES-GCM 256 bits
      perfStart(`[SIGESP:Perf] interpretacao registros (${fileName})`);
      const rawRows = parseCsv(rawText);
      const rows = consolidateVersionedRows(rawRows);
      perfEnd(`[SIGESP:Perf] interpretacao registros (${fileName})`);

      if (window.CryptoService && !options?.skipAutoEncrypt) {
        try {
          const resolvedHeaders = CANONICAL_SEEDS[fileName]?.headers ||
            (rows.length ? Object.keys(rows[0]) : (typeof H !== 'undefined' ? H[fileName.replace('.csv', '')] : []));
          if (resolvedHeaders && resolvedHeaders.length) {
            await this.writeEncryptedCsv(fileName, rows, resolvedHeaders);
          }
        } catch (migErr) {
          console.warn(`[StorageService] Migração transparente de ${fileName} adiada:`, migErr?.message || migErr);
        }
      }

      return rows;
    },

    /**
     * Serializa registros em CSV, criptografa com AES-GCM 256 bits e persiste no disco.
     */
    async writeEncryptedCsv(fileName, rows, headers, options = {}) {
      if (fileName === 'ocorrencias.csv') {
        return await this._writeOccurrencesBatchToStorage(rows, headers, options);
      }
      const dir = getActiveDirectoryHandle();
      if (!dir) {
        throw new Error('Pasta de dados indisponível.');
      }

      const nowFn = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
      const tProc0 = nowFn();
      const safeRows = Array.isArray(rows) ? rows : [];
      const consolidatedRows = options?.alreadyConsolidated ? safeRows : consolidateVersionedRows(safeRows);
      const tProc1 = nowFn();

      const resolvedHeaders = (headers && headers.length)
        ? headers
        : (CANONICAL_SEEDS[fileName]?.headers || (consolidatedRows.length ? Object.keys(consolidatedRows[0]) : (typeof H !== 'undefined' ? H[fileName.replace('.csv', '')] : [])));

      const tSer0 = nowFn();
      const csvString = serializeCsv(consolidatedRows, resolvedHeaders);
      const tSer1 = nowFn();

      if (!window.CryptoService) {
        throw new Error('CryptoService não carregado.');
      }

      perfStart(`[SIGESP:Perf] criptografia (${fileName})`);
      const tEnc0 = nowFn();
      const encryptedPayload = await window.CryptoService.encrypt(csvString, {
        fileName,
        rowCount: consolidatedRows.length
      });
      const tEnc1 = nowFn();
      perfEnd(`[SIGESP:Perf] criptografia (${fileName})`);

      perfStart(`[SIGESP:Perf] gravacao (${fileName})`);
      const tWrite0 = nowFn();
      const writeMeta = await this.writeRawFile(fileName, encryptedPayload, options);
      const tWrite1 = nowFn();
      perfEnd(`[SIGESP:Perf] gravacao (${fileName})`);

      const finalMtime = writeMeta?.mtimeMs || Date.now();
      const finalSize = writeMeta?.size || encryptedPayload.length;
      const rawSig = `${encryptedPayload.length}:${encryptedPayload.slice(0, 48)}:${encryptedPayload.slice(-48)}`;
      const cloned = consolidatedRows.map(r => ({ ...r }));

      _rawFileCache.set(fileName, {
        rawSig,
        rows: cloned,
        mtimeMs: finalMtime,
        size: finalSize,
        lastWriteTimings: {
          processamento: +(tProc1 - tProc0).toFixed(2),
          serializacao: +(tSer1 - tSer0).toFixed(2),
          criptografia: +(tEnc1 - tEnc0).toFixed(2),
          gravacao: +(tWrite1 - tWrite0).toFixed(2)
        }
      });

      if (typeof window !== 'undefined' && typeof window.syncFreshCsvMeta === 'function') {
        window.syncFreshCsvMeta(fileName, finalMtime, finalSize);
      }

      return cloned.map(r => ({ ...r }));
    },

    /**
     * Mutex / Fila de Escrita (Write Queue) serializada por arquivo com suporte a reentrância.
     * Garante serialização estrita (FIFO) de operações concorrentes sem deadlocks nem race conditions.
     */
    async withFileLock(fileName, operation) {
      const lockKey = `SIGESP:LOCK:${fileName}`;
      if (_activeLocks.has(lockKey)) {
        return await operation();
      }

      const previous = storageLocks.get(lockKey) || Promise.resolve();
      const current = previous
        .catch(() => {})
        .then(async () => {
          _activeLocks.add(lockKey);
          try {
            if (typeof navigator !== 'undefined' && navigator.locks?.request) {
              return await navigator.locks.request(lockKey, { mode: 'exclusive' }, operation);
            }
            return await operation();
          } finally {
            _activeLocks.delete(lockKey);
          }
        });

      storageLocks.set(lockKey, current);
      return current.finally(() => {
        if (storageLocks.get(lockKey) === current) {
          storageLocks.delete(lockKey);
        }
      });
    },

    /**
     * Adiciona ou atualiza atomicamente um registro no arquivo CSV criptografado.
     * Em modo Append (padrão para inserções), grava diretamente no final do arquivo (seek)
     * sem ler ou reescrever a base inteira, eliminando o gargalo de I/O e concorrência.
     */
    async appendRecord(fileName, record, headers, options = {}) {
      return await this.appendSingleRecord(fileName, record, headers, { isNewRecord: true, ...options });
    },

    async appendSingleRecord(fileName, record, headers, options = {}) {
      const nowFn = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
      const tTotal0 = nowFn();

      if (!record.id_ocorrencia && !record.id_chave && !record.id_usuario && !record.id && !record.id_exclusao && !record.id_auditoria && !record.id_movimento) {
        record.id_ocorrencia = generateUUID();
      }
      if (!record.versao_registro) {
        record.versao_registro = '1';
      }

      const resolvedHeaders = (headers && headers.length)
        ? headers
        : (CANONICAL_SEEDS[fileName]?.headers || (typeof H !== 'undefined' ? H[fileName.replace('.csv', '')] : Object.keys(record)));

      const isNewRecord = options?.isNewRecord !== false;

      // 1. BUFFER DE ALTA PERFORMANCE: PERSISTÊNCIA IMEDIATA NO INDEXEDDB LOCAL
      // Salva instantaneamente no IndexedDB liberando a operação antes de qualquer I/O de rede
      await IndexedDBEngine.saveRecordLocally(fileName, record);

      // 2. ATUALIZAÇÃO INCREMENTAL DO ESTADO EM MEMÓRIA (O(1))
      const cached = _rawFileCache.get(fileName);
      let existingRows = [];
      if (cached && Array.isArray(cached.rows) && cached.rows.length > 0) {
        existingRows = cached.rows;
      } else if (typeof CSVService !== 'undefined' && CSVService.cache.has(fileName)) {
        existingRows = CSVService.cache.get(fileName).rows;
      } else if (typeof S !== 'undefined') {
        let sList = null;
        if (fileName === 'ocorrencias.csv') sList = S.occ;
        else if (fileName === 'ocorrencias_pendentes.csv') sList = S.pending;
        else if (fileName === 'inspecao_fumaca_preta.csv') sList = S.inspecoes;
        else if (fileName === 'chaves.csv') sList = S.keys;
        else if (fileName === 'historico_sistema.csv') sList = S.audits;
        else if (fileName === 'registros_apagados.csv') sList = S.deletedRecords;
        else if (fileName === 'usuarios.csv') sList = S.users;
        existingRows = Array.isArray(sList) ? sList : [];
      }

      const recKey = getCanonicalRecordKey(fileName, record);
      let nextRows = [];
      if (isNewRecord) {
        // Validação anti-colisão em memória para novo protocolo
        if (fileName === 'ocorrencias.csv' && record.numero_protocolo) {
          const recProto = String(record.numero_protocolo).trim().toUpperCase();
          const recIdInt = String(record.id_interno || '').trim();
          const protoCollision = existingRows.some(r => {
            const rProto = String(r.numero_protocolo || '').trim().toUpperCase();
            const rInt = String(r.id_interno || '').trim();
            return rProto === recProto && (!recIdInt || rInt !== recIdInt);
          });
          if (protoCollision) {
            const conflictErr = new Error(`O protocolo ${record.numero_protocolo} já foi utilizado.`);
            conflictErr.code = 'CONFLITO_DE_PROTOCOLO';
            conflictErr.name = 'ProtocolConflictError';
            throw conflictErr;
          }
        }
        nextRows = [...existingRows, { ...record }];
      } else {
        const idx = existingRows.findIndex(r => {
          const rKey = getCanonicalRecordKey(fileName, r);
          if (rKey && rKey === recKey) return true;
          if (fileName === 'ocorrencias.csv' || fileName === 'ocorrencias_pendentes.csv') {
            const rInt = String(r.id_interno || '').trim();
            const recInt = String(record.id_interno || '').trim();
            if (rInt && recInt && rInt === recInt) return true;
            const rOcc = String(r.id_ocorrencia || '').trim();
            const recOcc = String(record.id_ocorrencia || '').trim();
            if (rOcc && recOcc && rOcc === recOcc) return true;
            const rProto = String(r.numero_protocolo || '').trim().toUpperCase();
            const recProto = String(record.numero_protocolo || '').trim().toUpperCase();
            if (rProto && recProto && rProto === recProto) return true;
          }
          return false;
        });
        if (idx >= 0) {
          nextRows = existingRows.map((r, i) => (i === idx ? { ...r, ...record } : r));
        } else {
          nextRows = [...existingRows, { ...record }];
        }
      }
      nextRows = consolidateVersionedRows(nextRows);

      _rawFileCache.set(fileName, {
        rawSig: '',
        rows: nextRows,
        mtimeMs: Date.now(),
        size: (cached?.size || 1024) + 128,
        lastWriteTimings: {
          processamento: +(nowFn() - tTotal0).toFixed(2),
          serializacao: 0,
          criptografia: 0,
          gravacao: 0
        }
      });

      if (typeof CSVService !== 'undefined') {
        CSVService.buildEntry(fileName, nextRows);
      }

      // 3. FILA DE ESCRITA EM SEGUNDO PLANO (APPEND-ONLY OUTBOX / ARQUIVO INDIVIDUAL POR OCORRÊNCIA)
      if (fileName === 'ocorrencias.csv') {
        if (record.status_validacao === 'Validada') {
          registerPendingValidation(record);
        }
        if (!isNewRecord) {
          await IndexedDBEngine.removeOutboxJobsForRecord([record.numero_protocolo, record.id_ocorrencia, record.id_interno]);
        }
      }

      const individualFileName = fileName === 'ocorrencias.csv'
        ? getIndividualOccurrenceFileName(record)
        : null;
      const outboxJob = {
        id: `out_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        fileName,
        individualFileName,
        record: { ...record },
        headers: resolvedHeaders,
        isNewRecord,
        options: {
          releasedProtocol: options?.releasedProtocol || record.numero_protocolo,
          id_interno: record.id_interno
        },
        status: 'pending',
        attempts: 0,
        createdAt: Date.now(),
        lastAttempt: 0,
        nextRetry: 0,
        error: null
      };

      await IndexedDBEngine.enqueueOutbox(outboxJob);

      // Para ocorrências individuais, executa o flush imediato do arquivo CSV individual (1 linha = sub-milissegundo)
      if (fileName === 'ocorrencias.csv') {
        await processBackgroundSyncQueue();
      } else {
        scheduleBackgroundSync(0);
      }

      const perfSummary = {
        arquivo: fileName,
        modo: 'INDEXEDDB_BUFFER_APPEND_OUTBOX',
        tempoLocal: +(nowFn() - tTotal0).toFixed(2),
        TOTAL: +(nowFn() - tTotal0).toFixed(2)
      };
      if (typeof window !== 'undefined') {
        window.SIGESP_PERF_LAST = perfSummary;
      }

      // 4. LIBERAÇÃO IMEDIATA DA INTERFACE (LATÊNCIA ZERO)
      return {
        ...record,
        row: { ...record },
        _verified: true,
        _usedFastCache: true,
        _allRows: nextRows,
        _perf: perfSummary
      };
    },

    normalizeReservationObject(r, now = Date.now(), usedNumbers = null) {
      if (!r || typeof r !== 'object') return null;
      const proto = String(r.numeroProtocolo || r.protocolo || '').trim().toUpperCase();
      const seqMatch = /^OC-(\d{4})-(\d+)$/i.exec(proto);
      const year = Number(r.year || (seqMatch ? parseInt(seqMatch[1], 10) : new Date().getFullYear()));
      const seq = Number(r.id_sequencial || (seqMatch ? parseInt(seqMatch[2], 10) : 0));
      const resId = String(r.reservationId || r.id_reserva || generateUUID()).trim();
      const sessId = String(r.sessionId || r.clientId || r.sessao || resId).trim();
      const user = String(r.usuario || r.user || 'Sistema').trim();
      const createdAt = Number(r.createdAt || (r.dataHoraReserva ? Date.parse(r.dataHoraReserva) : (r.data_hora ? Date.parse(r.data_hora) : now))) || now;
      const isoCreated = r.dataHoraReserva || r.data_hora || new Date(createdAt).toISOString();
      const rawStatus = String(r.status || 'RESERVADO').trim().toUpperCase();
      const inFile = Boolean(usedNumbers && seq > 0 && usedNumbers.has(seq));
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
    },

    async _acquireNativeProtocolLock(owner = 'Sistema', clientId = '', traceEnabled = false) {
      const dir = getActiveDirectoryHandle();
      if (!dir) throw new Error('Pasta de dados indisponível para adquirir lock de protocolo.');
      const lockId = generateUUID();
      const maxAttempts = 80;
      const nowFn = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
      const tLock0 = nowFn();
      logProtocolStep(traceEnabled, 'tentando adquirir lock', { lockId, usuario: owner, sessionId: clientId });

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const now = Date.now();
        try {
          // 1. Verifica se já existe um lock ativo de outra instância/computador
          let existingLock = null;
          let existingMtime = 0;
          try {
            const fhCheck = await dir.getFileHandle('protocolo.lock', { create: false });
            const fCheck = await fhCheck.getFile();
            existingMtime = Number(fCheck.lastModified || 0);
            const rawCheck = await fCheck.text();
            if (rawCheck && rawCheck.trim()) {
              existingLock = JSON.parse(rawCheck);
            }
          } catch (readErr) {
            if (readErr?.name !== 'NotFoundError') {
              // arquivo em escrita por outro processo
              existingLock = { expiresAt: now + 2000, lockId: 'BUSY' };
            }
          }

          if (existingLock && existingLock.lockId && existingLock.lockId !== lockId) {
            const isExpired = typeof existingLock.expiresAt === 'number' && now > existingLock.expiresAt;
            if (!isExpired) {
              await new Promise(r => setTimeout(r, 20 + Math.random() * 40));
              continue;
            }
            // Se expirou, verifica se reservas_protocolos.json não está sendo gravado neste exato segundo
            try {
              const resFh = await dir.getFileHandle('reservas_protocolos.json', { create: false });
              const resFile = await resFh.getFile();
              if (now - Number(resFile.lastModified || 0) < 1000) {
                await new Promise(r => setTimeout(r, 25 + Math.random() * 35));
                continue;
              }
            } catch {}
          } else if (!existingLock && existingMtime > 0 && now - existingMtime < 1500) {
            await new Promise(r => setTimeout(r, 20 + Math.random() * 35));
            continue;
          }

          // 2. Escreve o nosso lock no arquivo compartilhado protocolo.lock
          const payload = JSON.stringify({
            lockId,
            owner,
            sessionId: clientId,
            clientId,
            createdAt: now,
            expiresAt: now + LOCK_TTL_MS,
            state: 'ACTIVE'
          });
          const fhWrite = await dir.getFileHandle('protocolo.lock', { create: true });
          const w = await fhWrite.createWritable();
          await w.write(payload);
          await w.close();

          // 3. Confirmação pós-escrita de posse exclusiva do lock (evita condição de corrida em rede)
          await new Promise(r => setTimeout(r, 12 + Math.random() * 10));
          const fVerify = await (await dir.getFileHandle('protocolo.lock', { create: false })).getFile();
          const parsedVerify = JSON.parse(await fVerify.text());
          if (parsedVerify && parsedVerify.lockId === lockId) {
            logProtocolStep(traceEnabled, 'lock adquirido', {
              lockId,
              usuario: owner,
              sessionId: clientId,
              tentativas: attempt + 1,
              tempoMs: +(nowFn() - tLock0).toFixed(2)
            });
            return lockId;
          }
        } catch {}

        await new Promise(r => setTimeout(r, 20 + Math.random() * 45));
      }

      const err = new Error('Não foi possível adquirir o lock exclusivo de protocolo na pasta compartilhada.');
      logProtocolError('_acquireNativeProtocolLock', err, { owner, clientId });
      throw err;
    },

    async _releaseNativeProtocolLock(lockId, traceEnabled = false) {
      if (!lockId) return;
      const dir = getActiveDirectoryHandle();
      if (!dir) return;
      try {
        if (typeof dir.removeEntry === 'function') {
          await dir.removeEntry('protocolo.lock');
        } else {
          const fh = await dir.getFileHandle('protocolo.lock', { create: false });
          const w = await fh.createWritable();
          await w.write(JSON.stringify({ lockId: '', expiresAt: 0, state: 'RELEASED' }));
          await w.close();
        }
      } catch {}
      logProtocolStep(traceEnabled, 'lock liberado', { lockId });
    },

    async withSharedProtocolLock(owner, clientId, operation, traceEnabled = false) {
      return await this.withFileLock('reservas_protocolos.json', async () => {
        const lockId = await this._acquireNativeProtocolLock(owner, clientId, traceEnabled);
        try {
          return await operation(lockId);
        } finally {
          await this._releaseNativeProtocolLock(lockId, traceEnabled);
        }
      });
    },

    async _loadSharedNumbersAndReservations(year, clientKnownNumbers = [], existingMax = 0) {
      const usedNumbers = new Set();
      let maxFromFiles = Math.max(0, existingMax);

      for (const n of clientKnownNumbers) {
        if (n > 0) {
          usedNumbers.add(n);
          if (n > maxFromFiles) maxFromFiles = n;
        }
      }

      const regex = new RegExp(`OC-${year}-(\\d{1,8})`, 'i');
      const dir = getActiveDirectoryHandle();
      if (dir && isNativeSharedDirectory()) {
        try {
          const handles = await this._listNativeOccurrenceFileHandles(dir);
          for (const h of handles) {
            const m = regex.exec(h.name);
            if (m) {
              const n = parseInt(m[1], 10);
              if (!isNaN(n) && n > 0) {
                usedNumbers.add(n);
                if (n > maxFromFiles) maxFromFiles = n;
              }
            }
          }
        } catch {}
      }

      if (typeof S !== 'undefined' && Array.isArray(S.occ)) {
        for (const occItem of S.occ) {
          const protoStr = String(occItem.numero_protocolo || occItem.codigo_registro || occItem.id_ocorrencia || '');
          const m = regex.exec(protoStr);
          if (m) {
            const n = parseInt(m[1], 10);
            if (!isNaN(n) && n > 0) {
              usedNumbers.add(n);
              if (n > maxFromFiles) maxFromFiles = n;
            }
          }
        }
      }

      const filesToCheck = ['registros_apagados.csv'];
      const [csvRowLists, rawResText, rawCounterText] = await Promise.all([
        Promise.all(
          filesToCheck.map(fName =>
            this.readEncryptedCsv(fName, { force: false, optional: true, skipAutoEncrypt: true }).catch(() => [])
          )
        ),
        this.readRawFile('reservas_protocolos.json').catch(() => ''),
        this.readRawFile('protocolo_contador.json').catch(() => '')
      ]);

      for (const rows of csvRowLists) {
        for (const row of rows) {
          const protoStr = String(row.numero_protocolo || row.codigo_registro || row.id_ocorrencia || '');
          const m = regex.exec(protoStr);
          if (m) {
            const n = parseInt(m[1], 10);
            if (!isNaN(n) && n > 0) {
              usedNumbers.add(n);
              if (n > maxFromFiles) maxFromFiles = n;
            }
          }
        }
      }

      let rawReservations = [];
      if (rawResText) {
        try {
          const parsed = JSON.parse(rawResText);
          if (Array.isArray(parsed)) rawReservations = parsed;
        } catch {}
      }

      const now = Date.now();
      const reservations = [];
      for (const item of rawReservations) {
        const norm = this.normalizeReservationObject(
          item,
          now,
          Number(item?.year || year) === year ? usedNumbers : null
        );
        if (!norm || !norm.protocolo || norm.id_sequencial <= 0) continue;
        if (norm.status === 'UTILIZADO' || norm.status === 'CONFIRMADO') {
          reservations.push(norm);
        } else if (norm.status === 'RESERVADO' && norm.expiresAt > now) {
          reservations.push(norm);
        } else if (norm.createdAt && now - norm.createdAt < 30 * 60 * 1000) {
          reservations.push(norm);
        }
      }

      let counters = {};
      if (rawCounterText) {
        try {
          counters = JSON.parse(rawCounterText);
          if (!counters || typeof counters !== 'object') counters = {};
        } catch {
          counters = {};
        }
      }

      return { usedNumbers, maxFromFiles, reservations, counters, now };
    },

    async _persistAndVerifyReservations(reservations, expectedReservationId = '', expectedProto = '') {
      const payload = JSON.stringify(reservations, null, 2);
      await this.writeRawFile('reservas_protocolos.json', payload);
      const verifyRaw = await this.readRawFile('reservas_protocolos.json');
      const verifyList = JSON.parse(verifyRaw);
      if (!Array.isArray(verifyList)) {
        throw new Error('Falha na verificação pós-escrita de reservas_protocolos.json.');
      }
      if (expectedReservationId && expectedProto) {
        const found = verifyList.find(
          r => (r.reservationId === expectedReservationId || r.id_reserva === expectedReservationId) &&
               (r.protocolo === expectedProto || r.numeroProtocolo === expectedProto)
        );
        if (!found) {
          throw new Error(`A reserva ${expectedProto} (${expectedReservationId}) não foi confirmada no armazenamento compartilhado.`);
        }
        return this.normalizeReservationObject(found);
      }
      return verifyList;
    },

    async _markNativeProtocolUtilized(protocolo, idInterno = '') {
      if (!protocolo) return;
      const protoUpper = String(protocolo).trim().toUpperCase();
      const m = /^OC-(\d{4})-(\d+)$/i.exec(protoUpper);
      const year = m ? parseInt(m[1], 10) : new Date().getFullYear();
      const seq = m ? parseInt(m[2], 10) : 0;

      await this.withSharedProtocolLock('Sistema', '', async () => {
        const now = Date.now();
        const isoNow = new Date(now).toISOString();
        const [rawResText, rawCounterText] = await Promise.all([
          this.readRawFile('reservas_protocolos.json').catch(() => ''),
          seq > 0 ? this.readRawFile('protocolo_contador.json').catch(() => '') : Promise.resolve('')
        ]);

        let rawReservations = [];
        if (rawResText) {
          try {
            const parsed = JSON.parse(rawResText);
            if (Array.isArray(parsed)) rawReservations = parsed;
          } catch {}
        }

        const reservations = [];
        for (const item of rawReservations) {
          const norm = this.normalizeReservationObject(item, now, null);
          if (!norm || !norm.protocolo || norm.id_sequencial <= 0) continue;
          if (norm.status === 'UTILIZADO' || norm.status === 'CONFIRMADO') {
            reservations.push(norm);
          } else if (norm.status === 'RESERVADO' && norm.expiresAt > now) {
            reservations.push(norm);
          } else if (norm.createdAt && now - norm.createdAt < 30 * 60 * 1000) {
            reservations.push(norm);
          }
        }

        const target = reservations.find(r => r.protocolo === protoUpper || r.numeroProtocolo === protoUpper);
        if (target) {
          target.status = 'UTILIZADO';
          target.confirmado = true;
          target.dataHoraUtilizacao = target.dataHoraUtilizacao || isoNow;
          target.confirmedAt = target.dataHoraUtilizacao;
          if (idInterno) target.id_interno = idInterno;
        } else if (seq > 0) {
          const resId = generateUUID();
          reservations.push({
            id_reserva: resId,
            reservationId: resId,
            numeroProtocolo: protoUpper,
            protocolo: protoUpper,
            id_sequencial: seq,
            usuario: 'Sistema',
            user: 'Sistema',
            sessionId: resId,
            clientId: resId,
            sessao: resId,
            id_interno: idInterno || null,
            unit: '',
            year,
            dataHoraReserva: isoNow,
            data_hora: isoNow,
            createdAt: now,
            expiresAt: now + RESERVATION_TTL_MS,
            status: 'UTILIZADO',
            confirmado: true,
            dataHoraUtilizacao: isoNow,
            confirmedAt: isoNow
          });
        }

        const writeTasks = [
          this.writeRawFile('reservas_protocolos.json', JSON.stringify(reservations, null, 2))
        ];
        if (seq > 0) {
          let counters = {};
          if (rawCounterText) {
            try {
              counters = JSON.parse(rawCounterText);
              if (!counters || typeof counters !== 'object') counters = {};
            } catch {
              counters = {};
            }
          }
          const curCounter = parseInt(counters[String(year)] || 0, 10) || 0;
          if (seq > curCounter) {
            counters[String(year)] = seq;
            writeTasks.push(
              this.writeRawFile('protocolo_contador.json', JSON.stringify(counters, null, 2)).catch(() => {})
            );
          }
        }
        await Promise.all(writeTasks);
      });
    },

    /**
     * Módulo de Reserva Atômica de Protocolos para Concorrência Multiusuário
     */
    async reserveProtocol(user = 'Sistema', unit = '', options = {}) {
      perfStart('[SIGESP:Perf] geracao protocolo');
      const nowFn = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
      const tReq0 = nowFn();
      const traceEnabled = Boolean(options?.trace);
      try {
        const year = Number(options?.year) || new Date().getFullYear();
        const clientId = String(options?.clientId || options?.sessionId || (typeof S !== 'undefined' && S.editing?._clientId) || getClientSessionId()).trim();
        const preferredReservationId = String(options?.reservationId || '').trim();
        const preferredProtocol = String(options?.preferredProtocol || '').trim().toUpperCase();
        const previousProtocol = String(options?.previousProtocol || '').trim().toUpperCase();
        const forceNew = Boolean(options?.forceNew);

        let existingMax = 0;
        const knownNumbers = [];
        if (typeof S !== 'undefined') {
          const allKnown = [...(S.occ || []), ...(S.pending || []), ...(S.deletedRecords || [])];
          for (const r of allKnown) {
            const proto = String(r.numero_protocolo || r.codigo_registro || r.id_ocorrencia || '');
            const m = proto.match(new RegExp(`OC-${year}-(\\d+)`, 'i'));
            if (m) {
              const n = parseInt(m[1], 10);
              if (!isNaN(n) && n > 0) {
                knownNumbers.push(n);
                if (n > existingMax) existingMax = n;
              }
            }
          }
        }

        // Prioriza sempre o endpoint atômico centralizado de alta performance no backend (< 5ms)
        try {
          const timeoutSignal = (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function')
            ? AbortSignal.timeout(2000)
            : undefined;
          const res = await fetch('/api/storage/protocol/reserve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: timeoutSignal,
            body: JSON.stringify({
              user,
              unit,
              year,
              clientId,
              sessionId: clientId,
              reservationId: preferredReservationId,
              preferredProtocol,
              previousProtocol,
              existingMax,
              knownNumbers,
              forceNew,
              trace: traceEnabled
            })
          });
          if (res.ok) {
            const data = await res.json();
            const item = data?.reservation || (data?.protocolo ? data : null);
            if (item?.protocolo || item?.numeroProtocolo) {
              return this.normalizeReservationObject(item);
            }
          }
        } catch (e) {
          console.warn('[StorageService] Endpoint de reserva indisponível no backend; executando reserva compartilhada na pasta:', e);
        }

        // Reserva compartilhada direta nos arquivos da pasta de dados (protocolo.lock + reservas_protocolos.json)
        logProtocolStep(traceEnabled, 'solicitação iniciada', {
          usuario: user,
          sessionId: clientId,
          forceNew,
          preferredProtocol: preferredProtocol || null
        });

        return await this.withSharedProtocolLock(user, clientId, async () => {
          const tState0 = nowFn();
          const { usedNumbers, maxFromFiles, reservations, counters, now } =
            await this._loadSharedNumbersAndReservations(year, knownNumbers, existingMax);

          const utilizedNumbers = new Set(
            reservations
              .filter(r => r.year === year && (r.status === 'UTILIZADO' || r.status === 'CONFIRMADO' || r.confirmado === true))
              .map(r => Number(r.id_sequencial))
              .filter(n => n > 0)
          );

          logProtocolStep(traceEnabled, 'estado compartilhado carregado', {
            ocorrenciasNoDisco: usedNumbers.size,
            reservasCarregadas: reservations.length,
            utilizadosConfirmados: utilizedNumbers.size,
            tempoMs: +(nowFn() - tState0).toFixed(2)
          });

          // 1. Reutilização segura apenas para a mesma sessão/instância se a reserva continuar ativa e livre de conflito
          if (clientId && !forceNew) {
            const existing = reservations.find(r => {
              if (r.year !== year || r.status !== 'RESERVADO' || r.expiresAt <= now) return false;
              const seq = Number(r.id_sequencial);
              if (usedNumbers.has(seq) || utilizedNumbers.has(seq)) return false;
              const sameSess = r.clientId === clientId || r.sessionId === clientId;
              if (!sameSess) return false;
              if (preferredReservationId && r.reservationId === preferredReservationId) return true;
              if (preferredProtocol && r.protocolo === preferredProtocol) return true;
              return true;
            });

            if (existing) {
              const collisionWithOther = reservations.some(
                other =>
                  other.reservationId !== existing.reservationId &&
                  other.year === year &&
                  Number(other.id_sequencial) === Number(existing.id_sequencial) &&
                  (other.status === 'UTILIZADO' || other.status === 'CONFIRMADO' || (other.status === 'RESERVADO' && other.expiresAt > now))
              );
              if (!collisionWithOther) {
                existing.expiresAt = now + RESERVATION_TTL_MS;
                if (unit) existing.unit = unit;
                if (user && user !== 'Sistema') {
                  existing.usuario = user;
                  existing.user = user;
                }
                logProtocolStep(traceEnabled, 'próximo número calculado', {
                  modo: 'REUTILIZACAO_SESSAO_ATIVA',
                  numeroProtocolo: existing.numeroProtocolo,
                  id_sequencial: existing.id_sequencial
                });
                logProtocolStep(traceEnabled, 'reservationId criado', {
                  reservationId: existing.reservationId,
                  reutilizado: true
                });
                const confirmedExisting = await this._persistAndVerifyReservations(
                  reservations,
                  existing.reservationId,
                  existing.protocolo
                );
                logProtocolStep(traceEnabled, 'reserva persistida', {
                  numeroProtocolo: confirmedExisting.numeroProtocolo,
                  reservationId: confirmedExisting.reservationId
                });
                logProtocolStep(traceEnabled, 'persistência confirmada', {
                  numeroProtocolo: confirmedExisting.numeroProtocolo,
                  reservationId: confirmedExisting.reservationId,
                  tempoTotalMs: +(nowFn() - tReq0).toFixed(2)
                });
                return confirmedExisting;
              }
            }
          }

          if (clientId && (forceNew || previousProtocol)) {
            for (const r of reservations) {
              const sameSess = r.clientId === clientId || r.sessionId === clientId;
              const matchesPrev = !previousProtocol || r.protocolo === previousProtocol || r.numeroProtocolo === previousProtocol;
              if (sameSess && r.year === year && r.status === 'RESERVADO' && matchesPrev && !usedNumbers.has(Number(r.id_sequencial))) {
                r.status = 'CANCELADO';
                r.expiresAt = now - 1;
              }
            }
          }

          const activeReservedNums = new Set(
            reservations
              .filter(r => r.year === year && r.status === 'RESERVADO' && r.expiresAt > now)
              .map(r => Number(r.id_sequencial))
              .filter(n => n > 0)
          );

          const counterMax = (usedNumbers.size > 0 || utilizedNumbers.size > 0)
            ? (Number(counters[String(year)] || 0) || 0)
            : 0;

          let maxUsed = Math.max(0, counterMax, maxFromFiles);
          for (const n of usedNumbers) if (n > maxUsed) maxUsed = n;
          for (const n of utilizedNumbers) if (n > maxUsed) maxUsed = n;
          for (const n of activeReservedNums) if (n > maxUsed) maxUsed = n;

          let cand = Math.max(1, maxUsed + 1);
          while (
            usedNumbers.has(cand) ||
            utilizedNumbers.has(cand) ||
            activeReservedNums.has(cand)
          ) {
            cand++;
          }

          const proto = `OC-${year}-${String(cand).padStart(6, '0')}`;
          logProtocolStep(traceEnabled, 'próximo número calculado', {
            modo: 'NOVA_RESERVA_ATOMICA',
            numeroProtocolo: proto,
            id_sequencial: cand,
            maxAnterior: maxUsed
          });

          const reservationId = generateUUID();
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
            id_sequencial: cand,
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
          reservations.push(item);

          const confirmedItem = await this._persistAndVerifyReservations(reservations, reservationId, proto);
          logProtocolStep(traceEnabled, 'reserva persistida', {
            numeroProtocolo: proto,
            reservationId
          });
          logProtocolStep(traceEnabled, 'persistência confirmada', {
            numeroProtocolo: proto,
            reservationId,
            tempoTotalMs: +(nowFn() - tReq0).toFixed(2)
          });
          return confirmedItem;
        }, traceEnabled);
      } finally {
        perfEnd('[SIGESP:Perf] geracao protocolo');
      }
    },

    /**
     * Confirma a exclusividade do protocolo imediatamente antes da gravação definitiva.
     * Se houver conflito ou expiração, aloca e retorna automaticamente um novo protocolo único.
     */
    async confirmProtocolForSave(protocolo, user = 'Sistema', unit = '', options = {}) {
      const normProto = String(protocolo || '').trim().toUpperCase();
      const yearMatch = /^OC-(\d{4})-(\d+)$/i.exec(normProto);
      const year = yearMatch ? parseInt(yearMatch[1], 10) : (Number(options?.year) || new Date().getFullYear());
      const seqNum = yearMatch ? parseInt(yearMatch[2], 10) : 0;
      const clientId = String(options?.clientId || options?.sessionId || (typeof S !== 'undefined' && S.editing?._clientId) || getClientSessionId()).trim();
      const reservationId = String(options?.reservationId || (typeof S !== 'undefined' && S.editing?._reservationId) || '').trim();
      const idInterno = String(options?.id_interno || '').trim();
      const markUtilized = Boolean(options?.markUtilized);
      const traceEnabled = Boolean(options?.trace);

      try {
        const timeoutSignal = (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function')
          ? AbortSignal.timeout(2000)
          : undefined;
          const res = await fetch('/api/storage/protocol/confirm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: timeoutSignal,
            body: JSON.stringify({
              protocolo: normProto,
              user,
              unit,
              year,
              clientId,
              sessionId: clientId,
              reservationId,
              id_interno: idInterno,
              markUtilized,
              trace: traceEnabled
            })
          });
          if (res.ok) {
            const data = await res.json();
            const resolvedRes = data?.reservation ? this.normalizeReservationObject(data.reservation) : null;
            const finalProto = resolvedRes?.protocolo || data?.protocolo || data?.numeroProtocolo;
            if (finalProto) {
              return {
                ok: true,
                reallocated: Boolean(data.conflictResolved || data.reallocated),
                conflictResolved: Boolean(data.conflictResolved || data.reallocated),
                previousProtocol: data.previousProtocol || normProto,
                protocolo: finalProto,
                numeroProtocolo: finalProto,
                id_sequencial: resolvedRes?.id_sequencial || data.id_sequencial || seqNum,
                reservationId: resolvedRes?.reservationId || data.reservationId || reservationId,
                reservation: resolvedRes
              };
            }
          }
        } catch (e) {
          console.warn('[StorageService] Confirmação remota de protocolo indisponível; validando na pasta compartilhada:', e);
        }

      // Validação e resolução atômica sob lock direto na pasta compartilhada
      return await this.withSharedProtocolLock(user, clientId, async () => {
        const { usedNumbers, maxFromFiles, reservations, counters, now } =
          await this._loadSharedNumbersAndReservations(year);

        const alreadyInFile = seqNum > 0 && usedNumbers.has(seqNum);
        const matchingList = reservations.filter(r => r.protocolo === normProto || r.numeroProtocolo === normProto);
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

        const hasConflict = !normProto || seqNum <= 0 || alreadyInFile || utilizedByOther || reservedByOther;

        if (hasConflict) {
          const utilizedNumbers = new Set(
            reservations
              .filter(r => r.year === year && (r.status === 'UTILIZADO' || r.status === 'CONFIRMADO' || r.confirmado === true))
              .map(r => Number(r.id_sequencial))
              .filter(n => n > 0)
          );
          const activeReservedNums = new Set(
            reservations
              .filter(r => r.year === year && r.status === 'RESERVADO' && r.expiresAt > now)
              .map(r => Number(r.id_sequencial))
              .filter(n => n > 0)
          );
          const counterMax = (usedNumbers.size > 0 || utilizedNumbers.size > 0)
            ? (Number(counters[String(year)] || 0) || 0)
            : 0;
          let maxUsed = Math.max(0, counterMax, maxFromFiles);
          for (const n of usedNumbers) if (n > maxUsed) maxUsed = n;
          for (const n of utilizedNumbers) if (n > maxUsed) maxUsed = n;
          for (const n of activeReservedNums) if (n > maxUsed) maxUsed = n;

          let cand = Math.max(1, maxUsed + 1);
          while (
            usedNumbers.has(cand) ||
            utilizedNumbers.has(cand) ||
            activeReservedNums.has(cand)
          ) {
            cand++;
          }

          const newProto = `OC-${year}-${String(cand).padStart(6, '0')}`;
          const newResId = generateUUID();
          const effectiveSessionId = clientId || newResId;
          const isoNow = new Date(now).toISOString();
          const newItem = {
            id_reserva: newResId,
            reservationId: newResId,
            numeroProtocolo: newProto,
            protocolo: newProto,
            id_sequencial: cand,
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
          reservations.push(newItem);
          const confirmedNew = await this._persistAndVerifyReservations(reservations, newResId, newProto);
          return {
            ok: true,
            reallocated: true,
            conflictResolved: true,
            previousProtocol: normProto,
            protocolo: newProto,
            numeroProtocolo: newProto,
            id_sequencial: cand,
            reservationId: newResId,
            reservation: confirmedNew
          };
        }

        const isoNow = new Date(now).toISOString();
        if (matchingRes) {
          const needsPersist = markUtilized ||
            matchingRes.status !== 'RESERVADO' ||
            (matchingRes.expiresAt - now <= 60000) ||
            Boolean(idInterno && matchingRes.id_interno !== idInterno);

          matchingRes.expiresAt = now + RESERVATION_TTL_MS;
          if (idInterno) matchingRes.id_interno = idInterno;
          if (markUtilized) {
            matchingRes.status = 'UTILIZADO';
            matchingRes.confirmado = true;
            matchingRes.dataHoraUtilizacao = isoNow;
            matchingRes.confirmedAt = isoNow;
          }
          const confirmedExisting = needsPersist
            ? await this._persistAndVerifyReservations(
                reservations,
                matchingRes.reservationId,
                matchingRes.protocolo
              )
            : matchingRes;
          return {
            ok: true,
            reallocated: false,
            conflictResolved: false,
            protocolo: confirmedExisting.protocolo,
            numeroProtocolo: confirmedExisting.numeroProtocolo,
            id_sequencial: confirmedExisting.id_sequencial,
            reservationId: confirmedExisting.reservationId,
            reservation: confirmedExisting
          };
        }

        const newResId = reservationId || generateUUID();
        const effectiveSessionId = clientId || newResId;
        const createdItem = {
          id_reserva: newResId,
          reservationId: newResId,
          numeroProtocolo: normProto,
          protocolo: normProto,
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
        reservations.push(createdItem);
        const confirmedCreated = await this._persistAndVerifyReservations(reservations, newResId, normProto);
        return {
          ok: true,
          reallocated: false,
          conflictResolved: false,
          protocolo: normProto,
          numeroProtocolo: normProto,
          id_sequencial: seqNum,
          reservationId: newResId,
          reservation: confirmedCreated
        };
      }, traceEnabled);
    },

    async releaseProtocol(protocolo, user = 'Sistema', clientId = '', options = {}) {
      if (!protocolo) return;
      const protoUpper = String(protocolo).trim().toUpperCase();
      const resolvedClientId = String(clientId || options?.clientId || (typeof S !== 'undefined' && S.editing?._clientId) || getClientSessionId()).trim();
      const reservationId = String(options?.reservationId || (typeof S !== 'undefined' && S.editing?._reservationId) || '').trim();
      const confirmed = Boolean(options?.confirmed || options?.utilized);

      try {
        const res = await fetch('/api/storage/protocol/release', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            protocolo: protoUpper,
            user,
            clientId: resolvedClientId,
            sessionId: resolvedClientId,
            reservationId,
            confirmed
          })
        });
        if (res.ok) return;
      } catch {}

      try {
        await this.withSharedProtocolLock(user, resolvedClientId, async () => {
          const m = /^OC-(\d{4})-(\d+)$/i.exec(protoUpper);
          const year = m ? parseInt(m[1], 10) : new Date().getFullYear();
          const seq = m ? parseInt(m[2], 10) : 0;
          const { usedNumbers, reservations } = await this._loadSharedNumbersAndReservations(year);
          const isSaved = confirmed || (seq > 0 && usedNumbers.has(seq));
          const isoNow = new Date().toISOString();

          const filtered = reservations.filter(r => {
            if (r.protocolo !== protoUpper && r.numeroProtocolo !== protoUpper) return true;
            if (isSaved || r.status === 'UTILIZADO' || r.status === 'CONFIRMADO' || r.confirmado) {
              r.status = 'UTILIZADO';
              r.confirmado = true;
              r.dataHoraUtilizacao = r.dataHoraUtilizacao || isoNow;
              r.confirmedAt = r.dataHoraUtilizacao;
              return true;
            }
            if (reservationId && r.reservationId && r.reservationId !== reservationId) return true;
            if (resolvedClientId && r.clientId && r.clientId !== resolvedClientId) return true;
            return false;
          });
          await this._persistAndVerifyReservations(filtered);
        });
      } catch {}
    },

    async renewProtocol(protocolo, user = 'Sistema', clientId = '', options = {}) {
      if (!protocolo) return { ok: false };
      const protoUpper = String(protocolo).trim().toUpperCase();
      const resolvedClientId = String(clientId || options?.clientId || (typeof S !== 'undefined' && S.editing?._clientId) || getClientSessionId()).trim();
      const reservationId = String(options?.reservationId || (typeof S !== 'undefined' && S.editing?._reservationId) || '').trim();

      try {
        const res = await fetch('/api/storage/protocol/renew', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            protocolo: protoUpper,
            user,
            clientId: resolvedClientId,
            sessionId: resolvedClientId,
            reservationId
          })
        });
        if (res.ok) {
          return await res.json();
        }
      } catch {}

      try {
        return await this.withSharedProtocolLock(user, resolvedClientId, async () => {
          const m = /^OC-(\d{4})-(\d+)$/i.exec(protoUpper);
          const year = m ? parseInt(m[1], 10) : new Date().getFullYear();
          const seq = m ? parseInt(m[2], 10) : 0;
          const { usedNumbers, reservations } = await this._loadSharedNumbersAndReservations(year);

          if (seq > 0 && usedNumbers.has(seq)) {
            return { ok: false, conflict: true, reason: 'ALREADY_IN_CSV' };
          }

          const target = reservations.find(r => {
            if (r.protocolo !== protoUpper && r.numeroProtocolo !== protoUpper) return false;
            if (reservationId && r.reservationId === reservationId) return true;
            if (resolvedClientId && (r.clientId === resolvedClientId || r.sessionId === resolvedClientId)) return true;
            return !resolvedClientId && !reservationId;
          });

          if (!target || target.status !== 'RESERVADO') {
            return { ok: false, conflict: true, reason: 'RESERVATION_NOT_ACTIVE' };
          }

          target.expiresAt = Date.now() + RESERVATION_TTL_MS;
          await this._persistAndVerifyReservations(reservations);
          return { ok: true, conflict: false, expiresAt: target.expiresAt, reservation: target };
        });
      } catch {
        return { ok: false };
      }
    },

    appendRow(fileName, record, headers, options = {}) {
      return this.appendRecord(fileName, record, headers, options);
    },

    /**
     * Garante a existência do arquivo no disco devidamente criptografado.
     * Usa verificação rápida de metadados (HEAD / stat) para não baixar nem recriptografar arquivos existentes!
     */
    async ensureFile(fileName, headers) {
      if (fileName === 'ocorrencias.csv') {
        return;
      }
      const dir = getActiveDirectoryHandle();
      if (!dir) return;

      // Fast-path: se o arquivo já foi carregado no bundle ou indexado nativamente, retorna instantaneamente (0ms)
      if (dir.isServer && !dir.relPath && _rawFileCache.has(fileName)) {
        return;
      }
      if (this._nativeFilesMap && this._nativeFilesMap.has(fileName)) {
        return;
      }

      try {
        const stat = await this.getFileStat(fileName);
        if (stat.exists && stat.size > 0) {
          return;
        }
        const canonical = CANONICAL_SEEDS[fileName];
        const initialRows = canonical ? canonical.rows : [];
        const initialHeaders = canonical ? canonical.headers : (headers || []);
        await this.writeEncryptedCsv(fileName, initialRows, initialHeaders);
      } catch (err) {
        if (err?.name === 'NotFoundError' || err?.code === 'ARQUIVO_NAO_ENCONTRADO') {
          const canonical = CANONICAL_SEEDS[fileName];
          const initialRows = canonical ? canonical.rows : [];
          const initialHeaders = canonical ? canonical.headers : (headers || []);
          await this.writeEncryptedCsv(fileName, initialRows, initialHeaders);
        } else {
          throw err;
        }
      }
    },

    /**
     * Remove um arquivo da pasta de dados
     */
    async deleteFile(fileName) {
      const dir = getActiveDirectoryHandle();
      if (!dir) throw new Error('Pasta de dados indisponível.');
      _rawFileCache.delete(fileName);
      if (typeof dir.removeEntry === 'function') {
        await dir.removeEntry(fileName);
      }
    },

    /**
     * Exportação segura descriptografada (backup)
     */
    async exportDecryptedCsvBackup(fileName) {
      if (window.BackupService) {
        return await window.BackupService.exportDecryptedCsvBackup(fileName);
      }
      throw new Error('BackupService não disponível.');
    },

    /**
     * Importação com validação e criptografia imediata
     */
    async importCsvData(fileName, rawCsvContent) {
      _rawFileCache.delete(fileName);
      if (window.BackupService) {
        return await window.BackupService.importCsvData(fileName, rawCsvContent);
      }
      throw new Error('BackupService não disponível.');
    },

    /**
     * Remove fisicamente e de todos os caches um registro de ocorrência
     * Garante que uma ocorrência excluída ou validada nunca reapareça como pendente.
     */
    async deleteOccurrenceRecord(idOrProto) {
      if (!idOrProto) return;
      const norm = String(idOrProto).trim().toUpperCase();
      const safeId = norm.replace(/[^A-Z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
      const rawClean = norm.replace(/[^A-Z0-9_-]/g, '_');

      addOccurrenceTombstone(norm);
      if (safeId) addOccurrenceTombstone(safeId);

      const targetFileNames = new Set();
      if (safeId) targetFileNames.add(`ocorrencia_${safeId}.csv`);
      if (rawClean) targetFileNames.add(`ocorrencia_${rawClean}.csv`);

      for (const [k, v] of _recordKeyToFileMap.entries()) {
        const kUpper = k.toUpperCase();
        if (kUpper === norm || kUpper === `PROTO:${norm}` || kUpper === `OCC:${norm}` || kUpper === `INT:${norm}` || (safeId && kUpper.includes(safeId))) {
          if (v) targetFileNames.add(v);
        }
      }

      const dir = getActiveDirectoryHandle();

      // 1. Remoção do(s) arquivo(s) individual(is) em disco / servidor
      for (const targetFileName of targetFileNames) {
        if (dir) {
          if (dir.isServer && !dir.relPath) {
            try {
              await fetch(`/api/storage/delete?file=${encodeURIComponent(targetFileName)}&_t=${Date.now()}`, { method: 'DELETE' });
            } catch (delErr) {
              console.warn('[StorageService:deleteOccurrenceRecord] Falha ao deletar arquivo individual no servidor:', targetFileName, delErr);
            }
          } else if (typeof dir.removeEntry === 'function') {
            try {
              await dir.removeEntry(targetFileName);
            } catch (delErr) {
              if (delErr?.name !== 'NotFoundError') {
                console.warn('[StorageService:deleteOccurrenceRecord] Falha ao remover entry individual nativa:', targetFileName, delErr);
              }
            }
          }
        }
        _individualOccFileCache.delete(targetFileName);
      }

      // 2. Limpeza de caches em memória
      for (const [k, v] of _recordKeyToFileMap.entries()) {
        const kUpper = k.toUpperCase();
        if (targetFileNames.has(v) || kUpper === norm || kUpper === `PROTO:${norm}` || kUpper === `OCC:${norm}` || kUpper === `INT:${norm}` || (safeId && kUpper.includes(safeId))) {
          _recordKeyToFileMap.delete(k);
        }
      }

      const cachedOcc = _rawFileCache.get('ocorrencias.csv');
      if (cachedOcc && Array.isArray(cachedOcc.rows)) {
        cachedOcc.rows = cachedOcc.rows.filter(x => {
          if (isTombstonedOccurrence(x)) return false;
          const xProto = String(x.numero_protocolo || '').trim().toUpperCase();
          const xId = String(x.id_ocorrencia || '').trim().toUpperCase();
          const xInt = String(x.id_interno || '').trim().toUpperCase();
          return xProto !== norm && xId !== norm && xInt !== norm;
        });
      }

      // 3. Cancelamento e remoção imediata de jobs no outbox do IndexedDB para esta ocorrência
      if (this.IndexedDBEngine?.removeOutboxJobsForRecord) {
        await this.IndexedDBEngine.removeOutboxJobsForRecord([norm, safeId, rawClean, ...Array.from(targetFileNames)]);
      }

      // 4. Remoção do IndexedDB
      if (this.IndexedDBEngine?.removeRecord) {
        await this.IndexedDBEngine.removeRecord('ocorrencias.csv', norm);
        if (safeId && safeId !== norm) await this.IndexedDBEngine.removeRecord('ocorrencias.csv', safeId);
        for (const f of targetFileNames) {
          await this.IndexedDBEngine.removeRecord('ocorrencias.csv', f);
        }
      }
    },

    /**
     * Atualiza um registro existente na base legada ocorrencias.csv
     * Garante que status 'Validada' / 'Registrada' seja persistido também na base legada,
     * impedindo que reapareça como 'Pendente' em sincronizações futuras.
     */
    async updateOccurrenceInLegacyBase(record) {
      if (!record) return;
      const proto = String(record.numero_protocolo || '').trim().toUpperCase();
      const id = String(record.id_ocorrencia || '').trim();
      const idInt = String(record.id_interno || '').trim();

      // Registra no mapa de validações imediatas da sessão
      registerPendingValidation(record, 120000);

      // 1. Atualização atômica em memória dos caches
      const cachedOcc = _rawFileCache.get('ocorrencias.csv');
      let updated = false;
      if (cachedOcc && Array.isArray(cachedOcc.rows)) {
        cachedOcc.rows = cachedOcc.rows.map(row => {
          const rProto = String(row.numero_protocolo || '').trim().toUpperCase();
          const rId = String(row.id_ocorrencia || '').trim();
          const rInt = String(row.id_interno || '').trim();
          if ((proto && rProto === proto) || (id && rId === id) || (idInt && rInt === idInt)) {
            updated = true;
            return {
              ...row,
              ...record,
              status: record.status || 'Registrada',
              status_validacao: 'Validada',
              validado_por: record.validado_por || 'Supervisor'
            };
          }
          return row;
        });
        if (updated) {
          const legEntry = _individualOccFileCache.get('__legacy_ocorrencias.csv__');
          if (legEntry && Array.isArray(legEntry.rows)) {
            legEntry.rows = cachedOcc.rows;
          }
        }
      }

      // 2. Atualização debounced e serializada no disco dados/ocorrencias.csv sem releituras destrutivas da rede
      if (_legacyDiskSyncTimer) {
        clearTimeout(_legacyDiskSyncTimer);
      }
      _legacyDiskSyncTimer = setTimeout(() => {
        _legacyDiskSyncTimer = null;
        _legacyDiskSyncPromise = _legacyDiskSyncPromise.catch(() => {}).then(async () => {
          try {
            const dir = getActiveDirectoryHandle();
            if (!dir) return;
            const currentCache = _rawFileCache.get('ocorrencias.csv');
            const rowsToPersist = Array.isArray(currentCache?.rows) && currentCache.rows.length > 0
              ? currentCache.rows
              : (typeof S !== 'undefined' && Array.isArray(S.occ) ? S.occ : []);

            if (rowsToPersist.length > 0) {
              const headers = CANONICAL_SEEDS['ocorrencias.csv']?.headers || Object.keys(rowsToPersist[0] || {});
              const serialized = serializeCsv(rowsToPersist, headers);
              if (window.CryptoService) {
                const enc = await window.CryptoService.encrypt(serialized, { fileName: 'ocorrencias.csv' });
                await this.writeRawFile('ocorrencias.csv', enc);
              }
            }
          } catch (diskErr) {
            console.warn('[StorageService] updateOccurrenceInLegacyBase sync disco:', diskErr);
          }
        });
      }, 120);
    },
    addOccurrenceTombstone,
    isTombstonedOccurrence,
    registerPendingValidation,
    getActivePendingValidation
  };
})();

if (typeof window !== 'undefined') {
  window.StorageService = StorageService;
}
if (typeof globalThis !== 'undefined') {
  globalThis.StorageService = StorageService;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = StorageService;
}
