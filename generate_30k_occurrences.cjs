const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const SYSTEM_MASTER_SECRET = 'SIGESP_ENTERPRISE_SYSTEM_SECRET_KEY_v1_SECURE_2026';
const DADOS_DIR = path.resolve(__dirname, 'dados');
const OCORRENCIAS_FILE = path.join(DADOS_DIR, 'ocorrencias.csv');
const BACKUP_FILE = path.join(DADOS_DIR, 'ocorrencias_backup_pre30k.csv');
const COUNTER_FILE = path.join(DADOS_DIR, 'protocolo_contador.json');
const RESERVATIONS_FILE = path.join(DADOS_DIR, 'reservas_protocolos.json');

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

function encryptContent(plainText, fileName = 'ocorrencias.csv', rowCount = 30000) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(SYSTEM_MASTER_SECRET, salt, 100000, 32, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const ctAndTag = Buffer.concat([ct, tag]);

  const envelope = {
    magic: 'SIGESP_ENC_v1',
    version: 1,
    algo: 'AES-GCM',
    keyLength: 256,
    kdf: 'PBKDF2-SHA-256',
    iter: 100000,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    ct: ctAndTag.toString('base64'),
    ts: new Date().toISOString(),
    fileName,
    rowCount
  };

  return 'SIGESP_ENC_v1:' + JSON.stringify(envelope);
}

function escapeCsvField(val) {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (/[;"\r\n]/.test(str)) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

// Data pools for realistic Brazilian industrial occurrences
const PRIMEIROS_NOMES = [
  'Lucas', 'Gabriel', 'Carlos', 'Eduardo', 'Rodrigo', 'Fernando', 'Rafael', 'Marcos',
  'Alexandre', 'Felipe', 'Bruno', 'Marcelo', 'Leonardo', 'Thiago', 'Matheus', 'André',
  'Juliana', 'Camila', 'Beatriz', 'Aline', 'Larissa', 'Mariana', 'Patrícia', 'Renata',
  'Fernanda', 'Vanessa', 'Carolina', 'Amanda', 'Letícia', 'Tatiane', 'Bruna', 'Priscila'
];

const SOBRENOMES = [
  'Silva', 'Santos', 'Oliveira', 'Souza', 'Rodrigues', 'Ferreira', 'Alves', 'Pereira',
  'Lima', 'Gomes', 'Costa', 'Ribeiro', 'Martins', 'Carvalho', 'Almeida', 'Lopes',
  'Soares', 'Fernandes', 'Vieira', 'Barbosa', 'Rocha', 'Dias', 'Nascimento', 'Andrade',
  'Moreira', 'Nunes', 'Marques', 'Machado', 'Mendes', 'Freitas', 'Cardoso', 'Ramos'
];

const EMPRESAS = [
  'TransVale Transportes e Logística Ltda',
  'Delta Automação e Painéis Especiais',
  'ServSeg Vigilância Armada Ltda',
  'Engenharia & Obras Civis Brasil S.A.',
  'LogSul Distribuição e Armazenagem',
  'TecnoClean Higienização Industrial',
  'Manutec Manutenção Eletromecânica Ltda',
  'MetalSul Montagens Industriais',
  'SulCargas Fretes Rápidos',
  'Vanguarda Segurança Corporativa S/A',
  'Construtora Andrade & Ramos Ltda',
  'Ambiental EcoSoluções em Resíduos',
  'Atlas Soluções em Energia e Alta Tensão',
  'Prumo Infraestrutura Portuária'
];

const UNIDADES_DATA = [
  { unidade: 'Mogi das Cruzes', gerencia: 'Gerência de Operações', supervisao: 'DISTRIBUIÇÃO' },
  { unidade: 'Valença', gerencia: 'Gerência de Logística', supervisao: 'DISTRIBUIÇÃO' },
  { unidade: 'CSN - CAMAÇARI', gerencia: 'Gerência Industrial', supervisao: 'OPERAÇÕES INDUSTRIAIS' },
  { unidade: 'Usina Presidente Vargas', gerencia: 'Gerência de Manutenção', supervisao: 'OPERAÇÕES INDUSTRIAIS' }
];

const AREAS_LOCAIS = [
  { area: 'Portaria Principal', local: 'Portão de Acesso 01' },
  { area: 'Portaria 02 - Visitantes', local: 'Guarita Norte' },
  { area: 'Pátio de Cargas', local: 'Balança Rodoviária 02' },
  { area: 'Pátio de Carretas', local: 'Baia de Descarga 04' },
  { area: 'Área de Laminação', local: 'Linha de Produção 02' },
  { area: 'Oficina Mecânica', local: 'Rampa de Manutenção 03' },
  { area: 'Almoxarifado Central', local: 'Corredor B - Prateleira 12' },
  { area: 'Armazém de Peças', local: 'Doca 05' },
  { area: 'Refeitório Industrial', local: 'Salão Principal de Convivência' },
  { area: 'Subestação Elétrica 03', local: 'Sala de Transformadores' },
  { area: 'Pátio de Sucata', local: 'Pátio Intermediário' },
  { area: 'Laboratório Químico', local: 'Cabine de Amostragem' },
  { area: 'Terminal Ferroviário', local: 'Ponto de Manobra Ferroviária 01' },
  { area: 'Perímetro Externo - Cerca Sul', local: 'Torre de Observação 04' },
  { area: 'Estação de Tratamento de Efluentes', local: 'Tanque Decantador 02' },
  { area: 'Centro de Distribuição', local: 'Setor de Expedição Bloco C' }
];

const NATUREZAS = [
  {
    nat: 'Portaria',
    relatos: [
      'Durante o controle de acesso de veículos pesados, foi identificada divergência entre a nota fiscal apresentada e o manifesto de carga do caminhão transportador.',
      'Tentativa de entrada de colaborador de empresa parceira com crachá provisório vencido e sem ordem de serviço autorizada.',
      'Veículo utilitário ingressou sem inspeção veicular obrigatória e sem apresentação de check-list de itens de segurança.'
    ],
    providencias: [
      'Acionada a gerência imediata do setor, emitido relatório preliminar de segurança e advertido o prestador conforme regulamento interno.',
      'Acesso temporariamente bloqueado até regularização da documentação junto ao departamento de suprimentos.',
      'Emitido termo de orientação de segurança patrimonial e registrado no livro de ocorrências da guarita.'
    ]
  },
  {
    nat: 'Acesso Indevido',
    relatos: [
      'Indivíduo sem credenciamento adequado foi localizado transitando nas imediações de área restrita operacional sem crachá visível.',
      'Colaborador de empreiteira acessou setor de subestação de alta tensão desprovido dos EPIs específicos para áreas energizadas.',
      'Tentativa de transposição de catraca de pedestres utilizando crachá pertencente a outro funcionário.'
    ],
    providencias: [
      'Pessoa conduzida até a segurança patrimonial para identificação formal, verificação de vínculo e orientações normativas.',
      'Equipe de segurança acionada imediatamente, crachá retido para apuração e comunicado o fiscal de contrato da empresa prestadora.',
      'Encaminhado ao setor de Recursos Humanos e Segurança do Trabalho para registro de não conformidade.'
    ]
  },
  {
    nat: 'Furto / Tentativa',
    relatos: [
      'Identificada tentativa de subtração de rolos de cabos de cobre durante inspeção de rotina em veículo prestador na saída da unidade.',
      'Rompimento de lacre de segurança em caixa de ferramentas de manutenção com ausência de equipamento de medição portátil.',
      'Flagrante de guarda inadequada de materiais metálicos escondidos em compartimento oculto de caçamba de entulho.'
    ],
    providencias: [
      'Material apreendido e devolvido ao almoxarifado sob protocolo, elaborada notificação formal e solicitada abertura de sindicância interna.',
      'Acionada a supervisão geral de segurança patrimonial e instaurado processo de apuração interna com gravação de CFTV arquivada.',
      'Recolhimento dos itens, colheita de depoimentos das testemunhas e encaminhamento aos setores competentes.'
    ]
  },
  {
    nat: 'Dano ao Patrimônio',
    relatos: [
      'Manobra inadequada de empilhadeira provocou colisão frontal contra portão basculante metálico, entortando a guia lateral de sustentação.',
      'Rompimento de cerca perimetral ocasionado por queda de galho de grande porte durante fortes ventos na madrugada.',
      'Avaria na pintura e retrovisor lateral de veículo oficial decorrente de manobra imprudente no estacionamento interno.'
    ],
    providencias: [
      'Área isolada com fita zebrada, acionada equipe de manutenção predial para reparo imediato e emitido laudo pericial fotográfico.',
      'Reparo emergencial executado pela equipe de conservação, testes estruturais validados e notificado o seguro patrimonial.',
      'Registrado boletim interno de avaria veicular e acionado o setor de frotas para orçamentação dos reparos.'
    ]
  },
  {
    nat: 'Averiguação Preventiva',
    relatos: [
      'Vigilância patrimonial identificou volume suspeito abandonado próximo à cerca limítrofe durante ronda motorizada perimetral.',
      'Alarme de intrusão do setor 04 disparou repetidamente sem evidência visual imediata na central de videomonitoramento.',
      'Verificação de fumaça atípica emanando de compartimento de compressores de ar do galpão de utilidades.'
    ],
    providencias: [
      'Ronda patrimonial direcionada ao local constatou se tratar de embalagem vazia descartada pelo vento; perímetro normalizado.',
      'Técnico de eletrônica de segurança rearmou sensores e ajustou sensibilidade dos radares infravermelhos.',
      'Equipe de brigada de emergência vistoriou o compartimento e confirmou superaquecimento em correia, desligando o motor preventivamente.'
    ]
  },
  {
    nat: 'Acidente Sem Vítima',
    relatos: [
      'Caminhão tanque realizou curva com raio fechado no pátio interno e tocou a mureta de proteção de concreto, causando danos cosméticos.',
      'Tombamento parcial de palete de tambores plásticos vazios durante transporte com transpaleteira manual.',
      'Derramamento superficial de 5 litros de óleo hidráulico sobre piso industrial durante desacoplamento de mangueira pressurizada.'
    ],
    providencias: [
      'Aplicado kit de mitigação ambiental com serragem e mantas absorventes, área limpa e liberada sem contaminação do solo.',
      'Carga reorganizada de acordo com as normas de empilhamento seguro e reavaliado o procedimento operacional padrão.',
      'Inspecionadas mangueiras e conexões hidráulicas de todas as unidades operantes pelo fiscal de manutenção.'
    ]
  },
  {
    nat: 'Inspeção de Segurança',
    relatos: [
      'Inspeção trimestral de extintores e hidrantes constatou 2 unidades com manômetro acusando baixa pressão no setor de expedição.',
      'Auditoria de rotina verificou ausência de sinalização fotoluminescente em rota de fuga secundária do mezanino técnico.',
      'Vistoria no sistema de iluminação de emergência identificou 3 blocos autônomos inoperantes no bloco administrativo.'
    ],
    providencias: [
      'Extintores substituídos de imediato por unidades reservas inspecionadas e os equipamentos despressurizados encaminhados para recarga.',
      'Placas de sinalização repostas e regularizadas conforme norma técnica NBR 13434.',
      'Baterias e lâmpadas LED substituídas pelo eletricista predial sob supervisão do técnico de segurança do trabalho.'
    ]
  },
  {
    nat: 'Descumprimento de Norma',
    relatos: [
      'Operador flagrado utilizando smartphone particular durante condução de equipamento autopropelido no pátio de manobras.',
      'Prestador de serviços executando trabalho em altura sem ancoragem do cinto de segurança tipo paraquedista em linha de vida.',
      'Fumo em local não autorizado próximo a tanques de armazenamento de solventes inflamáveis.'
    ],
    providencias: [
      'Atividade paralisada no ato, colaborador orientado quanto à gravidade do ato inseguro e emitido termo de advertência formal.',
      'Aplicada parada de segurança com a equipe do turno para reciclagem sobre diretrizes de segurança de trabalho e NR-35.',
      'Profissional retirado da área de risco imediatamente e notificada a liderança de contrato da empreiteira.'
    ]
  }
];

const VINCULOS = ['Próprio', 'Terceiro', 'Prestador de Serviço', 'Visitante'];
const PRIORIDADES = ['Baixa', 'Média', 'Alta', 'Crítica'];
const STATUS_LIST = ['Registrada', 'Em Apuração', 'Pendente de validação', 'Encerrada'];
const STATUS_VALIDACAO = ['Validada', 'Pendente de validação'];
const USUARIOS = [
  { login: 'admin', perfil: 'Administrador' },
  { login: 'operador', perfil: 'Operador' },
  { login: 'lider', perfil: 'Líder' },
  { login: 'supervisor', perfil: 'Supervisor' },
  { login: 'fiscal', perfil: 'Fiscal' }
];

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateCpf() {
  const d = () => randomInt(100, 999);
  const c = () => String(randomInt(10, 99));
  return `${d()}.${d()}.${d()}-${c()}`;
}

function generatePlaca() {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const l = () => letters[randomInt(0, letters.length - 1)];
  const n = () => randomInt(0, 9);
  // Mercosul or standard format
  return randomInt(0, 1) === 0
    ? `${l()}${l()}${l()}-${n()}${n()}${n()}${n()}`
    : `${l()}${l()}${l()}${n()}${l()}${n()}${n()}`;
}

function generatePhone() {
  const ddds = ['11', '12', '19', '21', '24', '71', '31'];
  const ddd = randomChoice(ddds);
  return `(${ddd}) 9${randomInt(1000, 9999)}-${randomInt(1000, 9999)}`;
}

function generateDate(index, total) {
  // Distribute over 2025-01-01 to 2026-11-03
  const start = new Date('2025-01-01T08:00:00Z').getTime();
  const end = new Date('2026-11-02T22:00:00Z').getTime();
  const ratio = index / total;
  const time = start + Math.floor(ratio * (end - start)) + randomInt(-3600000, 3600000);
  const d = new Date(Math.max(start, Math.min(end, time)));
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return {
    dateStr: `${yyyy}-${mm}-${dd}`,
    timeStr: `${hh}:${min}`,
    isoStr: d.toISOString()
  };
}

async function main() {
  console.log('--- Iniciando Geração de 30.000 Ocorrências Reais e Sequenciais ---');
  
  if (!fs.existsSync(OCORRENCIAS_FILE)) {
    throw new Error('Arquivo ocorrencias.csv não encontrado!');
  }

  // 1. Criar backup do arquivo existente
  fs.copyFileSync(OCORRENCIAS_FILE, BACKUP_FILE);
  console.log(`Backup de segurança criado com sucesso em: ${BACKUP_FILE}`);

  // 2. Descriptografar e ler os registros existentes
  const rawCurrent = fs.readFileSync(OCORRENCIAS_FILE, 'utf8');
  const decryptedCurrent = decryptSingleEnvelope(rawCurrent);
  const existingLines = decryptedCurrent.split('\n').filter(Boolean);
  const header = existingLines[0].replace(/^\ufeff/, '').trim();
  const headers = header.split(';');

  console.log(`Linhas atuais no arquivo: ${existingLines.length} (1 cabeçalho + ${existingLines.length - 1} registros)`);
  
  const totalExisting = existingLines.length - 1;
  const targetTotal = 30000;
  const needed = targetTotal - totalExisting;

  console.log(`Total existente: ${totalExisting} | Total almejado: ${targetTotal} | Novos a gerar: ${needed}`);

  const allRows = [];
  
  // Adicionar registros existentes (linhas 1 a 5000)
  for (let i = 1; i <= totalExisting; i++) {
    allRows.push(existingLines[i].replace(/\r$/, ''));
  }

  // Gerar os registros faltantes (de 5001 a 30000)
  for (let i = totalExisting + 1; i <= targetTotal; i++) {
    const idOcorrencia = String(i);
    const idInterno = crypto.randomUUID();
    const seqStr = String(i).padStart(6, '0');
    const numeroProtocolo = `OC-2026-${seqStr}`;

    const { dateStr, timeStr, isoStr } = generateDate(i, targetTotal);
    const uData = randomChoice(UNIDADES_DATA);
    const areaLocal = randomChoice(AREAS_LOCAIS);
    const natObj = randomChoice(NATUREZAS);
    const tipoVinculo = randomChoice(VINCULOS);
    const nome = `${randomChoice(PRIMEIROS_NOMES)} ${randomChoice(SOBRENOMES)} ${randomChoice(SOBRENOMES)}`;
    const empresa = tipoVinculo === 'Próprio' ? 'Companhia Siderúrgica Nacional' : randomChoice(EMPRESAS);
    const matricula = `MT-${randomInt(1000, 9999)}`;
    const telefone = generatePhone();
    const documento = generateCpf();
    const placa = generatePlaca();
    const gerenciaEnvolvido = uData.gerencia;
    const gerenciaGeral = uData.supervisao === 'DISTRIBUIÇÃO'
      ? 'Gerência Geral de Operações e Distribuição'
      : 'Gerência Geral Industrial e Produção';
    const diretoria = uData.supervisao === 'DISTRIBUIÇÃO'
      ? 'Diretoria de Operações e Logística'
      : 'Diretoria de Produção e Infraestrutura';

    const relatoBase = randomChoice(natObj.relatos);
    const relatoDetalhado = `${relatoBase} [Registro Sequencial #${i} - Área: ${areaLocal.area}, Local: ${areaLocal.local}]`;
    const providencia = randomChoice(natObj.providencias);
    const prioridade = randomChoice(PRIORIDADES);
    const status = randomChoice(STATUS_LIST);
    const userReg = randomChoice(USUARIOS);
    const statusVal = (status === 'Encerrada' || status === 'Registrada')
      ? 'Validada'
      : (status === 'Pendente de validação' ? 'Pendente de validação' : 'Validada');

    const validadoPor = statusVal === 'Validada' ? 'admin' : '';
    const dataValidacao = statusVal === 'Validada' ? isoStr : '';
    const obsValidacao = statusVal === 'Validada' ? 'Validação corporativa confirmada e regularizada.' : '';

    const rowCols = [
      idOcorrencia,                       // 0: id_ocorrencia
      idInterno,                          // 1: id_interno
      numeroProtocolo,                    // 2: numero_protocolo
      dateStr,                            // 3: data_ocorrencia
      timeStr,                            // 4: hora_ocorrencia
      uData.gerencia,                     // 5: gerencia
      uData.supervisao,                   // 6: supervisao
      uData.unidade,                      // 7: unidade
      areaLocal.area,                     // 8: area
      areaLocal.local,                    // 9: local_especifico
      natObj.nat,                         // 10: natureza_ocorrencia
      tipoVinculo,                        // 11: tipo_vinculo
      nome,                               // 12: nome_envolvido
      empresa,                            // 13: empresa_envolvido
      matricula,                          // 14: matricula_id
      telefone,                           // 15: telefone
      documento,                          // 16: documento
      placa,                              // 17: placa_veiculo
      gerenciaEnvolvido,                  // 18: gerencia_envolvido
      gerenciaGeral,                      // 19: gerencia_geral
      diretoria,                          // 20: diretoria
      relatoDetalhado,                    // 21: relato_detalhado
      providencia,                        // 22: providencias_adotadas
      prioridade,                         // 23: prioridade
      status,                             // 24: status
      '',                                 // 25: anexos_referencias
      userReg.login,                      // 26: responsavel_registro
      userReg.perfil,                     // 27: perfil_registro
      isoStr,                             // 28: data_registro
      '1',                                // 29: versao_registro
      userReg.login,                      // 30: usuario_ultima_alteracao
      statusVal,                          // 31: status_validacao
      statusVal === 'Pendente de validação' ? isoStr : '', // 32: data_envio_validacao
      validadoPor,                        // 33: validado_por
      dataValidacao,                      // 34: data_validacao
      obsValidacao                        // 35: observacao_validacao
    ];

    const escapedRow = rowCols.map(escapeCsvField).join(';');
    allRows.push(escapedRow);

    if (i % 5000 === 0) {
      console.log(`Geradas ${i} ocorrências...`);
    }
  }

  console.log(`Total de registros formatados: ${allRows.length}. Montando CSV final...`);
  const finalCsvContent = '\ufeff' + header + '\r\n' + allRows.join('\r\n');

  console.log(`Tamanho do CSV em texto plano: ${(Buffer.byteLength(finalCsvContent, 'utf8') / (1024 * 1024)).toFixed(2)} MB`);
  console.log('Criptografando com AES-GCM 256 bits corporativo...');

  const encryptedPayload = encryptContent(finalCsvContent, 'ocorrencias.csv', targetTotal);
  console.log(`Tamanho do envelope cifrado: ${(Buffer.byteLength(encryptedPayload, 'utf8') / (1024 * 1024)).toFixed(2)} MB`);

  // Gravação atômica em ocorrencias.csv
  const tmpPath = `${OCORRENCIAS_FILE}.tmp.${Date.now()}`;
  fs.writeFileSync(tmpPath, encryptedPayload, 'utf8');
  fs.renameSync(tmpPath, OCORRENCIAS_FILE);
  console.log(`Arquivo ocorrencias.csv gravado com sucesso!`);

  // Atualizar protocolo_contador.json
  const counterData = {
    "2026": targetTotal,
    "year": 2026,
    "lastSeq": targetTotal,
    "ultimoProtocoloConfirmado": `OC-2026-${String(targetTotal).padStart(6, '0')}`,
    "updatedAt": new Date().toISOString()
  };
  fs.writeFileSync(COUNTER_FILE, JSON.stringify(counterData, null, 2), 'utf8');
  console.log(`Contador atualizado para sequência ${targetTotal}: ${COUNTER_FILE}`);

  // Limpar reservas ativas
  fs.writeFileSync(RESERVATIONS_FILE, '[]\n', 'utf8');
  console.log(`Reservas de protocolo sincronizadas: ${RESERVATIONS_FILE}`);

  console.log('--- Concluído com Sucesso Total ---');
}

main().catch(err => {
  console.error('ERRO FATAL NA GERAÇÃO:', err);
  process.exit(1);
});
