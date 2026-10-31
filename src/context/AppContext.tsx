import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import {
  User,
  Supervision,
  Unit,
  Nature,
  Occurrence,
  PendingOccurrence,
  KeyRecord,
  AuditRecord,
  EnvironmentalInspection,
  PageName,
  HistoryFilters,
  EnvironmentalFilters,
  PhotoItem,
  Profile,
} from '../types';
import {
  hash,
  canonicalPerfil,
  normalizePerfil,
  normalizedMasterName,
  activeMaster,
  aliasesOf,
  uid,
  nextOccurrenceProtocol,
  compressImage,
} from '../utils/csv';
import { generateOccurrencePdfDocument } from '../utils/pdfGenerator';

const STORAGE_KEY = 'SIGESP_APP_DATA_V2';

// Initial default seeds
const SEED_SUPERVISIONS: Supervision[] = [
  { id_supervisao: 'e0098929-390d-494e-8d7d-632e581ecf7b', nome: 'DISTRIBUIÇÃO', ativo: '1' },
  { id_supervisao: 'f1098929-390d-494e-8d7d-632e581ecf8c', nome: 'OPERAÇÕES INDUSTRIAIS', ativo: '1' },
];

const SEED_UNITS: Unit[] = [
  { id_unidade: 'ead8a31c-2697-4ff0-b7f3-ed1a6dda62e3', nome: 'Mogi das Cruzes', id_supervisao: 'e0098929-390d-494e-8d7d-632e581ecf7b', ativo: '1', aliases: '[]' },
  { id_unidade: 'c952f09f-1c75-4d1e-a23a-a55ff6dcb21f', nome: 'Valença', id_supervisao: 'e0098929-390d-494e-8d7d-632e581ecf7b', ativo: '1', aliases: '[]' },
  { id_unidade: '66b2a9bc-bef9-462d-9dd6-30f785aa5e38', nome: 'CSN - CAMAÇARI', id_supervisao: 'e0098929-390d-494e-8d7d-632e581ecf7b', ativo: '1', aliases: '[]' },
  { id_unidade: '77b2a9bc-bef9-462d-9dd6-30f785aa5e49', nome: 'Usina Presidente Vargas', id_supervisao: 'f1098929-390d-494e-8d7d-632e581ecf8c', ativo: '1', aliases: '[]' },
];

const SEED_NATURES: Nature[] = [
  { id_natureza: 'nat-01', nome: 'Portaria', ativo: '1', aliases: '[]' },
  { id_natureza: 'nat-02', nome: 'Acesso Indevido', ativo: '1', aliases: '[]' },
  { id_natureza: 'nat-03', nome: 'Furto / Tentativa', ativo: '1', aliases: '[]' },
  { id_natureza: 'nat-04', nome: 'Dano ao Patrimônio', ativo: '1', aliases: '[]' },
  { id_natureza: 'nat-05', nome: 'Averiguação Preventiva', ativo: '1', aliases: '[]' },
  { id_natureza: 'nat-06', nome: 'Acidente Sem Vítima', ativo: '1', aliases: '[]' },
  { id_natureza: 'nat-07', nome: 'Inspeção de Segurança', ativo: '1', aliases: '[]' },
  { id_natureza: 'nat-08', nome: 'Descumprimento de Norma', ativo: '1', aliases: '[]' },
];

const SEED_USERS: User[] = [
  {
    id_usuario: 'U1',
    nome: 'Administrador Homologação',
    login: 'admin',
    senha_hash: '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9', // admin123
    perfil: 'Administrador',
    unidades_permitidas: '*',
    supervisao_id: '',
    status: 'Ativo',
    data_criacao: '2026-10-15T08:00:00-03:00',
    versao_registro: '1',
    data_atualizacao: '2026-10-15T08:00:00-03:00',
    usuario_ultima_alteracao: 'Sistema',
  },
  {
    id_usuario: 'U2',
    nome: 'Carlos Supervisor',
    login: 'supervisor',
    senha_hash: '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9', // admin123
    perfil: 'Supervisor',
    unidades_permitidas: '',
    supervisao_id: 'e0098929-390d-494e-8d7d-632e581ecf7b',
    status: 'Ativo',
    data_criacao: '2026-10-15T08:00:00-03:00',
    versao_registro: '1',
    data_atualizacao: '2026-10-15T08:00:00-03:00',
    usuario_ultima_alteracao: 'admin',
  },
  {
    id_usuario: 'U3',
    nome: 'Marcos Líder Operacional',
    login: 'lider',
    senha_hash: '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9', // admin123
    perfil: 'Líder',
    unidades_permitidas: 'ead8a31c-2697-4ff0-b7f3-ed1a6dda62e3|c952f09f-1c75-4d1e-a23a-a55ff6dcb21f',
    supervisao_id: 'e0098929-390d-494e-8d7d-632e581ecf7b',
    status: 'Ativo',
    data_criacao: '2026-10-15T08:00:00-03:00',
    versao_registro: '1',
    data_atualizacao: '2026-10-15T08:00:00-03:00',
    usuario_ultima_alteracao: 'admin',
  },
  {
    id_usuario: 'U4',
    nome: 'João Operador Portaria',
    login: 'operador',
    senha_hash: '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9', // admin123
    perfil: 'Operador',
    unidades_permitidas: 'ead8a31c-2697-4ff0-b7f3-ed1a6dda62e3',
    supervisao_id: 'e0098929-390d-494e-8d7d-632e581ecf7b',
    status: 'Ativo',
    data_criacao: '2026-10-15T08:00:00-03:00',
    versao_registro: '1',
    data_atualizacao: '2026-10-15T08:00:00-03:00',
    usuario_ultima_alteracao: 'admin',
  },
];

const SEED_OCCURRENCES: Occurrence[] = [
  {
    id_ocorrencia: '4a584c46-b056-40a9-b41a-eda5afe026a9',
    numero_protocolo: 'OC-2026-000001',
    data_ocorrencia: '2026-10-15',
    hora_ocorrencia: '11:21',
    gerencia: 'GSP/SP',
    supervisao: 'DISTRIBUIÇÃO',
    unidade: 'Valença',
    area: 'Área Industrial',
    local_especifico: 'Portaria Principal 01',
    natureza_ocorrencia: 'Portaria',
    tipo_vinculo: 'Terceiro',
    nome_envolvido: 'Roberto Santos',
    empresa_envolvido: 'TransLog Transportes',
    matricula_id: 'TR-9821',
    telefone: '(11) 98822-1144',
    documento: '32.145.890-1',
    placa_veiculo: 'ABC-4E21',
    relato_detalhado: 'Tentativa de ingresso na portaria sem autorização prévia cadastrada no sistema. O motorista informou desconhecer a nova rotina de credenciamento.',
    providencias_adotadas: 'Orientado o motorista e feito contato com o setor receptor para liberação extraordinária.',
    prioridade: 'Média',
    status: 'Registrada',
    anexos_referencias: '',
    responsavel_registro: 'admin',
    perfil_registro: 'Administrador',
    data_registro: '2026-10-15T14:22:16.877Z',
    versao_registro: '1',
    usuario_ultima_alteracao: 'admin',
  },
  {
    id_ocorrencia: '8931e81e-02ce-4f63-8db0-4c38965fd5c1',
    numero_protocolo: 'OC-2026-000002',
    data_ocorrencia: '2026-10-14',
    hora_ocorrencia: '09:40',
    gerencia: 'GSP/SP',
    supervisao: 'DISTRIBUIÇÃO',
    unidade: 'Mogi das Cruzes',
    area: 'Pátio de Cargas',
    local_especifico: 'Docas Setor Norte',
    natureza_ocorrencia: 'Averiguação Preventiva',
    tipo_vinculo: 'Próprio',
    nome_envolvido: 'Paulo Rodrigues',
    empresa_envolvido: 'CSN Logística',
    matricula_id: 'CSN-5412',
    telefone: '(11) 97711-2233',
    documento: '41.523.632-9',
    placa_veiculo: 'KZX-9921',
    relato_detalhado: 'Ronda preventiva detectou movimentação suspeita próximo à cerca perimetral do pátio secundário durante a troca de turno.',
    providencias_adotadas: 'Inspeção realizada com apoio de monitoramento por câmeras; perímetro íntegro sem violações.',
    prioridade: 'Alta',
    status: 'Encerrada',
    anexos_referencias: '',
    responsavel_registro: 'admin',
    perfil_registro: 'Administrador',
    data_registro: '2026-10-14T12:00:00.000Z',
    versao_registro: '1',
    usuario_ultima_alteracao: 'admin',
  },
  {
    id_ocorrencia: '0845104f-d672-4f7b-9a36-a85b9c99a0de',
    numero_protocolo: 'OC-2026-000003',
    data_ocorrencia: '2026-10-13',
    hora_ocorrencia: '16:15',
    gerencia: 'GSP/SP',
    supervisao: 'DISTRIBUIÇÃO',
    unidade: 'CSN - CAMAÇARI',
    area: 'Almoxarifado Central',
    local_especifico: 'Galpão 03 - Portão B',
    natureza_ocorrencia: 'Dano ao Patrimônio',
    tipo_vinculo: 'Terceiro',
    nome_envolvido: 'Lucas Lima',
    empresa_envolvido: 'Manutenge Serviços',
    matricula_id: 'MT-4102',
    telefone: '(71) 98122-3344',
    documento: '52.331.002-4',
    placa_veiculo: 'PQR-1120',
    relato_detalhado: 'Empilhadeira colidiu levemente com o portão de enrolar do galpão 03 durante manobra de recolhimento de pallets vazios.',
    providencias_adotadas: 'Acionada a manutenção predial para reparo da folha do portão e registrado relatório técnico.',
    prioridade: 'Baixa',
    status: 'Em Apuração',
    anexos_referencias: '',
    responsavel_registro: 'admin',
    perfil_registro: 'Administrador',
    data_registro: '2026-10-13T17:30:00.000Z',
    versao_registro: '1',
    usuario_ultima_alteracao: 'admin',
  },
];

const SEED_PENDING_OCCURRENCES: PendingOccurrence[] = [
  {
    id_ocorrencia: 'pend-01',
    numero_protocolo: 'OC-2026-000004',
    data_ocorrencia: '2026-10-16',
    hora_ocorrencia: '10:05',
    gerencia: 'GSP/SP',
    supervisao: 'DISTRIBUIÇÃO',
    unidade: 'Mogi das Cruzes',
    area: 'Estacionamento Visitantes',
    local_especifico: 'Vaga reservada 04',
    natureza_ocorrencia: 'Acesso Indevido',
    tipo_vinculo: 'Visitante',
    nome_envolvido: 'Felipe Duarte',
    empresa_envolvido: 'Consultoria Externa',
    matricula_id: 'VIS-991',
    telefone: '(11) 96541-2398',
    documento: '28.441.876-0',
    placa_veiculo: 'FGH-2211',
    relato_detalhado: 'Veículo estacionado em vaga reservada para viaturas oficiais sem identificação de credencial autorizada.',
    providencias_adotadas: 'Localizado o condutor no auditório e solicitada a manobra para o bolsão correto.',
    prioridade: 'Baixa',
    status: 'Pendente de validação',
    status_validacao: 'Pendente de validação',
    data_envio_validacao: '2026-10-16T10:15:00.000Z',
    validado_por: '',
    data_validacao: '',
    observacao_validacao: '',
    anexos_referencias: '',
    responsavel_registro: 'operador',
    perfil_registro: 'Operador',
    data_registro: '2026-10-16T10:15:00.000Z',
    versao_registro: '1',
    usuario_ultima_alteracao: 'operador',
  },
];

const SEED_KEYS: KeyRecord[] = [
  {
    id_chave: 'key-01',
    codigo: 'CH-MC-01',
    descricao: 'Porta Principal Almoxarifado',
    setor: 'Almoxarifado',
    unidade: 'Mogi das Cruzes',
    status: 'Disponível',
    observacoes: 'Chave mola dupla',
    versao_registro: '1',
    data_atualizacao: '2026-10-15T08:00:00Z',
    usuario_ultima_alteracao: 'admin',
  },
  {
    id_chave: 'key-02',
    codigo: 'CH-MC-02',
    descricao: 'Subestação Elétrica 01',
    setor: 'Manutenção Elétrica',
    unidade: 'Mogi das Cruzes',
    status: 'Retirada',
    observacoes: 'Acesso restrito para eletricistas credenciados',
    versao_registro: '1',
    data_atualizacao: '2026-10-16T09:00:00Z',
    usuario_ultima_alteracao: 'admin',
  },
  {
    id_chave: 'key-03',
    codigo: 'CH-VAL-01',
    descricao: 'Sala de TI e Servidores',
    setor: 'Tecnologia da Informação',
    unidade: 'Valença',
    status: 'Disponível',
    observacoes: 'Retirada sob autorização do coordenador',
    versao_registro: '1',
    data_atualizacao: '2026-10-15T08:00:00Z',
    usuario_ultima_alteracao: 'admin',
  },
];

const SEED_INSPECOES: EnvironmentalInspection[] = [
  {
    id: 'amb-01',
    data: '2026-10-16',
    realizar_monitoramento: 'Sim',
    motivo_nao_execucao: '',
    placa: 'ABC-1234',
    transportadora: 'TransVale Cargas',
    nota: '2.0',
    laudo: 'Aprovado',
    observacao: 'Escala Ringelmann padrão 1 (20% opacidade). Veículo operando dentro dos padrões ambientais normativos.',
    responsavel: 'Administrador Homologação',
    usuario_registro: 'admin',
    data_hora_registro: '2026-10-16T11:00:00Z',
    data_hora_alteracao: '',
    alterado_por: '',
    unidade: 'Mogi das Cruzes',
    supervisao: 'DISTRIBUIÇÃO',
  },
  {
    id: 'amb-02',
    data: '2026-10-15',
    realizar_monitoramento: 'Sim',
    motivo_nao_execucao: '',
    placa: 'XYZ-9876',
    transportadora: 'Rápido Sudeste Ltda',
    nota: '3.5',
    laudo: 'Reprovado',
    observacao: 'Emissão contínua de fumaça densa atingindo padrão 3 da escala Ringelmann. Notificado condutor.',
    responsavel: 'Administrador Homologação',
    usuario_registro: 'admin',
    data_hora_registro: '2026-10-15T15:20:00Z',
    data_hora_alteracao: '',
    alterado_por: '',
    unidade: 'Valença',
    supervisao: 'DISTRIBUIÇÃO',
  },
  {
    id: 'amb-03',
    data: '2026-10-14',
    realizar_monitoramento: 'Não',
    motivo_nao_execucao: 'Condição climática adversa / dia nublado / chuva',
    placa: '',
    transportadora: '',
    nota: '',
    laudo: '',
    observacao: '',
    responsavel: 'Administrador Homologação',
    usuario_registro: 'admin',
    data_hora_registro: '2026-10-14T14:00:00Z',
    data_hora_alteracao: '',
    alterado_por: '',
    unidade: 'CSN - CAMAÇARI',
    supervisao: 'DISTRIBUIÇÃO',
  },
];

const SEED_AUDITS: AuditRecord[] = [
  {
    id_auditoria: '8b764bea-878a-4e6a-bf69-d3e89229598b',
    data_hora: '2026-10-16T16:22:08.876Z',
    usuario: 'admin',
    perfil: 'Administrador',
    modulo: 'ORGANIZACAO',
    acao: 'UNIDADE_CADASTRADA',
    id_registro: '66b2a9bc-bef9-462d-9dd6-30f785aa5e38',
    codigo_registro: 'CSN - CAMAÇARI',
    detalhes: 'CSN - CAMAÇARI',
  },
  {
    id_auditoria: 'ef1c9d5f-790c-43a2-ad4b-f762b29c4acd',
    data_hora: '2026-10-16T16:21:52.733Z',
    usuario: 'admin',
    perfil: 'Administrador',
    modulo: 'ORGANIZACAO',
    acao: 'SUPERVISAO_CADASTRADA',
    id_registro: 'e0098929-390d-494e-8d7d-632e581ecf7b',
    codigo_registro: 'DISTRIBUIÇÃO',
    detalhes: 'DISTRIBUIÇÃO',
  },
];

interface AppContextType {
  user: User | null;
  page: PageName;
  setPage: (p: PageName) => void;
  message: string;
  setMessage: (m: string) => void;
  accessDenied: string | boolean;
  setAccessDenied: (v: string | boolean) => void;

  // Data sets
  users: User[];
  supervisions: Supervision[];
  unitCatalog: Unit[];
  natureCatalog: Nature[];
  occurrences: Occurrence[];
  pendingOccurrences: PendingOccurrence[];
  keys: KeyRecord[];
  inspecoes: EnvironmentalInspection[];
  audits: AuditRecord[];

  // Form editing states
  editingOccurrence: Partial<Occurrence> | null;
  setEditingOccurrence: (occ: Partial<Occurrence> | null) => void;
  editingKey: Partial<KeyRecord> | null;
  setEditingKey: (k: Partial<KeyRecord> | null) => void;
  editingInspection: Partial<EnvironmentalInspection> | null;
  setEditingInspection: (i: Partial<EnvironmentalInspection> | null) => void;
  editingUser: Partial<User> | null;
  setEditingUser: (u: Partial<User> | null) => void;

  // Photos
  existingPhotos: PhotoItem[];
  setExistingPhotos: React.Dispatch<React.SetStateAction<PhotoItem[]>>;
  newPhotos: PhotoItem[];
  setNewPhotos: React.Dispatch<React.SetStateAction<PhotoItem[]>>;
  addPhotoFiles: (files: FileList | File[]) => Promise<void>;
  removeNewPhoto: (index: number) => void;
  removeExistingPhoto: (index: number) => void;
  lightboxUrl: string | null;
  setLightboxUrl: (url: string | null) => void;

  // Filters
  historyFilters: HistoryFilters;
  setHistoryFilters: React.Dispatch<React.SetStateAction<HistoryFilters>>;
  clearHistoryFilters: () => void;
  ambientalFilters: EnvironmentalFilters;
  setAmbientalFilters: React.Dispatch<React.SetStateAction<EnvironmentalFilters>>;
  clearAmbientalFilters: () => void;

  // Popups & modals
  successPopup: {
    protocolo: string;
    unidade: string;
    dataRegistro: string;
    usuario: string;
    idOcorrencia: string;
    kind: 'create' | 'edit' | 'pending';
  } | null;
  setSuccessPopup: (p: any) => void;
  errorPopup: { titulo: string; mensagem: string } | null;
  setErrorPopup: (p: { titulo: string; mensagem: string } | null) => void;
  detailModal: { kind: 'occurrence' | 'pending' | 'ambiental'; data: any } | null;
  setDetailModal: (m: { kind: 'occurrence' | 'pending' | 'ambiental'; data: any } | null) => void;
  pdfProgress: { show: boolean; progress: number; message: string; title?: string } | null;
  setPdfProgress: (p: { show: boolean; progress: number; message: string; title?: string } | null) => void;
  pdfResult: { show: boolean; success: boolean; message: string; fileName?: string } | null;
  setPdfResult: (p: { show: boolean; success: boolean; message: string; fileName?: string } | null) => void;

  // Submenus
  occurrencesMenuOpen: boolean;
  setOccurrencesMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  environmentMenuOpen: boolean;
  setEnvironmentMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;

  // Settings
  settingsTab: 'supervisions' | 'units' | 'natures';
  setSettingsTab: (tab: 'supervisions' | 'units' | 'natures') => void;
  settingsSearch: string;
  setSettingsSearch: (query: string) => void;
  masterEditor: { entity: 'supervision' | 'unit' | 'nature'; id?: string; data: any } | null;
  setMasterEditor: (ed: { entity: 'supervision' | 'unit' | 'nature'; id?: string; data: any } | null) => void;
  masterConfirmation: {
    entity: 'supervision' | 'unit' | 'nature';
    id: string;
    name: string;
    active: boolean;
    dependencies: string[];
    error?: string;
  } | null;
  setMasterConfirmation: (conf: any) => void;

  // User modals
  userPasswordTarget: User | null;
  setUserPasswordTarget: (u: User | null) => void;
  userRemovalTarget: User | null;
  setUserRemovalTarget: (u: User | null) => void;

  // Actions
  login: (loginInput: string, passwordInput: string) => Promise<boolean>;
  logout: () => void;
  effectiveSupervisionId: (u?: User | null) => string;
  assignedUnitIds: (u?: User | null) => string[];
  authorizedUnitRecords: (u?: User | null, includeInactive?: boolean) => Unit[];
  authorizedUnitNames: (u?: User | null) => string[];
  canAccessUnit: (unitName: string, u?: User | null) => boolean;
  supervisionForUnit: (unitName: string) => Supervision | null;
  hasProfile: (u: User | null, ...profiles: Profile[]) => boolean;
  canAccessPage: (pageName: PageName, u?: User | null) => boolean;
  canManageUsers: (u?: User | null) => boolean;
  canValidateOccurrence: (u?: User | null) => boolean;
  canRegisterOccurrence: (u?: User | null) => boolean;
  isAdministratorUser: (u?: User | null) => boolean;
  scopeOccurrences: (rows: Occurrence[], u?: User | null) => Occurrence[];
  scopePending: (rows: PendingOccurrence[], u?: User | null) => PendingOccurrence[];
  scopeAmbiental: (rows: EnvironmentalInspection[], u?: User | null) => EnvironmentalInspection[];
  scopeKeys: (rows: KeyRecord[], u?: User | null) => KeyRecord[];

  // CRUD
  saveOccurrence: (formData: Record<string, string>) => Promise<boolean>;
  validatePendingOcc: (id: string) => Promise<boolean>;
  saveKeyRecord: (data: Partial<KeyRecord>) => Promise<boolean>;
  saveEnvironmental: (data: Partial<EnvironmentalInspection>) => Promise<boolean>;
  saveUserRecord: (data: Partial<User>, password?: string) => Promise<boolean>;
  toggleUser: (id: string) => Promise<boolean>;
  changePassword: (id: string, newPassword: string) => Promise<boolean>;
  removeUser: (id: string) => Promise<boolean>;
  saveMasterRecord: (entity: 'supervision' | 'unit' | 'nature', name: string, parentSupervisionId?: string) => Promise<boolean>;
  toggleMasterStatus: () => Promise<boolean>;
  triggerPdfExport: (occurrenceId: string) => Promise<void>;
  exportScopedData: (kind: 'occ' | 'keys') => void;
  resetAllDataToDefaults: () => void;
}

const AppContext = createContext<AppContextType | null>(null);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Load state from localStorage or use seeds
  const [user, setUser] = useState<User | null>(() => {
    try {
      const saved = localStorage.getItem(`${STORAGE_KEY}_SESSION`);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [page, setPage] = useState<PageName>('dashboard');
  const [message, setMessage] = useState<string>('');
  const [accessDenied, setAccessDenied] = useState<string | boolean>(false);

  const [users, setUsers] = useState<User[]>(() => {
    try {
      const saved = localStorage.getItem(`${STORAGE_KEY}_USERS`);
      return saved ? JSON.parse(saved) : SEED_USERS;
    } catch {
      return SEED_USERS;
    }
  });

  const [supervisions, setSupervisions] = useState<Supervision[]>(() => {
    try {
      const saved = localStorage.getItem(`${STORAGE_KEY}_SUPERVISIONS`);
      return saved ? JSON.parse(saved) : SEED_SUPERVISIONS;
    } catch {
      return SEED_SUPERVISIONS;
    }
  });

  const [unitCatalog, setUnitCatalog] = useState<Unit[]>(() => {
    try {
      const saved = localStorage.getItem(`${STORAGE_KEY}_UNITS`);
      return saved ? JSON.parse(saved) : SEED_UNITS;
    } catch {
      return SEED_UNITS;
    }
  });

  const [natureCatalog, setNatureCatalog] = useState<Nature[]>(() => {
    try {
      const saved = localStorage.getItem(`${STORAGE_KEY}_NATURES`);
      return saved ? JSON.parse(saved) : SEED_NATURES;
    } catch {
      return SEED_NATURES;
    }
  });

  const [occurrences, setOccurrences] = useState<Occurrence[]>(() => {
    try {
      const saved = localStorage.getItem(`${STORAGE_KEY}_OCCURRENCES`);
      return saved ? JSON.parse(saved) : SEED_OCCURRENCES;
    } catch {
      return SEED_OCCURRENCES;
    }
  });

  const [pendingOccurrences, setPendingOccurrences] = useState<PendingOccurrence[]>(() => {
    try {
      const saved = localStorage.getItem(`${STORAGE_KEY}_PENDING`);
      return saved ? JSON.parse(saved) : SEED_PENDING_OCCURRENCES;
    } catch {
      return SEED_PENDING_OCCURRENCES;
    }
  });

  const [keys, setKeys] = useState<KeyRecord[]>(() => {
    try {
      const saved = localStorage.getItem(`${STORAGE_KEY}_KEYS`);
      return saved ? JSON.parse(saved) : SEED_KEYS;
    } catch {
      return SEED_KEYS;
    }
  });

  const [inspecoes, setInspecoes] = useState<EnvironmentalInspection[]>(() => {
    try {
      const saved = localStorage.getItem(`${STORAGE_KEY}_INSPECOES`);
      return saved ? JSON.parse(saved) : SEED_INSPECOES;
    } catch {
      return SEED_INSPECOES;
    }
  });

  const [audits, setAudits] = useState<AuditRecord[]>(() => {
    try {
      const saved = localStorage.getItem(`${STORAGE_KEY}_AUDITS`);
      return saved ? JSON.parse(saved) : SEED_AUDITS;
    } catch {
      return SEED_AUDITS;
    }
  });

  // Save to localStorage whenever data changes
  useEffect(() => {
    try {
      localStorage.setItem(`${STORAGE_KEY}_USERS`, JSON.stringify(users));
      localStorage.setItem(`${STORAGE_KEY}_SUPERVISIONS`, JSON.stringify(supervisions));
      localStorage.setItem(`${STORAGE_KEY}_UNITS`, JSON.stringify(unitCatalog));
      localStorage.setItem(`${STORAGE_KEY}_NATURES`, JSON.stringify(natureCatalog));
      localStorage.setItem(`${STORAGE_KEY}_OCCURRENCES`, JSON.stringify(occurrences));
      localStorage.setItem(`${STORAGE_KEY}_PENDING`, JSON.stringify(pendingOccurrences));
      localStorage.setItem(`${STORAGE_KEY}_KEYS`, JSON.stringify(keys));
      localStorage.setItem(`${STORAGE_KEY}_INSPECOES`, JSON.stringify(inspecoes));
      localStorage.setItem(`${STORAGE_KEY}_AUDITS`, JSON.stringify(audits));
    } catch (e) {
      console.warn('LocalStorage save failed', e);
    }
  }, [users, supervisions, unitCatalog, natureCatalog, occurrences, pendingOccurrences, keys, inspecoes, audits]);

  useEffect(() => {
    try {
      if (user) {
        localStorage.setItem(`${STORAGE_KEY}_SESSION`, JSON.stringify(user));
      } else {
        localStorage.removeItem(`${STORAGE_KEY}_SESSION`);
      }
    } catch {}
  }, [user]);

  // Form draft states
  const [editingOccurrence, setEditingOccurrence] = useState<Partial<Occurrence> | null>(null);
  const [editingKey, setEditingKey] = useState<Partial<KeyRecord> | null>(null);
  const [editingInspection, setEditingInspection] = useState<Partial<EnvironmentalInspection> | null>(null);
  const [editingUser, setEditingUser] = useState<Partial<User> | null>(null);

  // Photos
  const [existingPhotos, setExistingPhotos] = useState<PhotoItem[]>([]);
  const [newPhotos, setNewPhotos] = useState<PhotoItem[]>([]);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // Filters
  const [historyFilters, setHistoryFilters] = useState<HistoryFilters>({
    dateFrom: '',
    dateTo: '',
    nature: '',
    protocol: '',
    general: '',
  });

  const clearHistoryFilters = useCallback(() => {
    setHistoryFilters({
      dateFrom: '',
      dateTo: '',
      nature: '',
      protocol: '',
      general: '',
    });
  }, []);

  const [ambientalFilters, setAmbientalFilters] = useState<EnvironmentalFilters>({
    dateFrom: '',
    dateTo: '',
    placa: '',
    transportadora: '',
    realizado: '',
    laudo: '',
    responsavel: '',
    unidade: '',
    supervisao: '',
    general: '',
  });

  const clearAmbientalFilters = useCallback(() => {
    setAmbientalFilters({
      dateFrom: '',
      dateTo: '',
      placa: '',
      transportadora: '',
      realizado: '',
      laudo: '',
      responsavel: '',
      unidade: '',
      supervisao: '',
      general: '',
    });
  }, []);

  // Popups & modals
  const [successPopup, setSuccessPopup] = useState<{
    protocolo: string;
    unidade: string;
    dataRegistro: string;
    usuario: string;
    idOcorrencia: string;
    kind: 'create' | 'edit' | 'pending';
  } | null>(null);

  const [errorPopup, setErrorPopup] = useState<{ titulo: string; mensagem: string } | null>(null);
  const [detailModal, setDetailModal] = useState<{ kind: 'occurrence' | 'pending' | 'ambiental'; data: any } | null>(null);
  const [pdfProgress, setPdfProgress] = useState<{ show: boolean; progress: number; message: string; title?: string } | null>(null);
  const [pdfResult, setPdfResult] = useState<{ show: boolean; success: boolean; message: string; fileName?: string } | null>(null);

  // Submenu states
  const [occurrencesMenuOpen, setOccurrencesMenuOpen] = useState(false);
  const [environmentMenuOpen, setEnvironmentMenuOpen] = useState(false);

  // Settings master data states
  const [settingsTab, setSettingsTab] = useState<'supervisions' | 'units' | 'natures'>('supervisions');
  const [settingsSearch, setSettingsSearch] = useState('');
  const [masterEditor, setMasterEditor] = useState<{ entity: 'supervision' | 'unit' | 'nature'; id?: string; data: any } | null>(null);
  const [masterConfirmation, setMasterConfirmation] = useState<{
    entity: 'supervision' | 'unit' | 'nature';
    id: string;
    name: string;
    active: boolean;
    dependencies: string[];
    error?: string;
  } | null>(null);

  // User management modals
  const [userPasswordTarget, setUserPasswordTarget] = useState<User | null>(null);
  const [userRemovalTarget, setUserRemovalTarget] = useState<User | null>(null);

  // RBAC Helper functions
  const hasProfile = useCallback((u: User | null, ...profiles: Profile[]): boolean => {
    if (!u) return false;
    const current = normalizePerfil(u.perfil);
    return profiles.some((p) => normalizePerfil(p) === current);
  }, []);

  const effectiveSupervisionId = useCallback(
    (u?: User | null): string => {
      const current = u || user;
      if (!current) return '';
      if (current.supervisao_id && supervisions.some((item) => item.id_supervisao === current.supervisao_id)) {
        return current.supervisao_id;
      }
      const values = String(current.unidades_permitidas || '')
        .split('|')
        .map((v) => v.trim())
        .filter(Boolean);
      const ids = values
        .map(
          (val) =>
            unitCatalog.find(
              (unit) =>
                unit.id_unidade === val ||
                normalizedMasterName(unit.nome) === normalizedMasterName(val) ||
                aliasesOf(unit).some((a) => normalizedMasterName(a) === normalizedMasterName(val))
            )?.id_supervisao
        )
        .filter(Boolean);
      const distinct = [...new Set(ids)];
      return distinct.length === 1 ? (distinct[0] as string) : '';
    },
    [user, supervisions, unitCatalog]
  );

  const assignedUnitIds = useCallback(
    (u?: User | null): string[] => {
      const current = u || user;
      if (!current) return [];
      const values = String(current.unidades_permitidas || '')
        .split('|')
        .map((v) => v.trim())
        .filter(Boolean);
      return [
        ...new Set(
          values
            .map(
              (val) =>
                unitCatalog.find(
                  (unit) =>
                    unit.id_unidade === val ||
                    normalizedMasterName(unit.nome) === normalizedMasterName(val) ||
                    aliasesOf(unit).some((a) => normalizedMasterName(a) === normalizedMasterName(val))
                )?.id_unidade
            )
            .filter(Boolean) as string[]
        ),
      ];
    },
    [user, unitCatalog]
  );

  const authorizedUnitRecords = useCallback(
    (u?: User | null, includeInactive = false): Unit[] => {
      const current = u || user;
      if (!current) return [];
      const supId = effectiveSupervisionId(current);
      const valid = unitCatalog.filter(
        (unit) =>
          unit.id_supervisao &&
          supervisions.some(
            (supervision) =>
              supervision.id_supervisao === unit.id_supervisao && (includeInactive || activeMaster(supervision))
          )
      );

      let rows: Unit[];
      if (hasProfile(current, 'Administrador')) {
        rows = valid;
      } else if (!supId) {
        return [];
      } else if (hasProfile(current, 'Supervisor')) {
        rows = valid.filter((unit) => unit.id_supervisao === supId);
      } else {
        const allowed = new Set(assignedUnitIds(current));
        rows = valid.filter((unit) => unit.id_supervisao === supId && allowed.has(unit.id_unidade));
      }
      return rows.filter((unit) => includeInactive || activeMaster(unit));
    },
    [user, effectiveSupervisionId, unitCatalog, supervisions, hasProfile, assignedUnitIds]
  );

  const authorizedUnitNames = useCallback(
    (u?: User | null): string[] => {
      return [...new Set(authorizedUnitRecords(u).map((unit) => unit.nome))];
    },
    [authorizedUnitRecords]
  );

  const unitForName = useCallback(
    (unitName?: string): Unit | null => {
      const key = normalizedMasterName(unitName);
      return (
        unitCatalog.find(
          (item) =>
            normalizedMasterName(item.nome) === key ||
            aliasesOf(item).some((alias) => normalizedMasterName(alias) === key)
        ) || null
      );
    },
    [unitCatalog]
  );

  const supervisionForUnit = useCallback(
    (unitName: string): Supervision | null => {
      const unit = unitForName(unitName);
      return (unit && supervisions.find((item) => item.id_supervisao === unit.id_supervisao)) || null;
    },
    [unitForName, supervisions]
  );

  const canAccessUnit = useCallback(
    (unitName: string, u?: User | null): boolean => {
      const current = u || user;
      if (!current) return false;
      if (hasProfile(current, 'Administrador')) return true;
      const unit = unitForName(unitName);
      if (!unit || !unit.id_supervisao || unit.id_supervisao !== effectiveSupervisionId(current)) return false;
      if (!authorizedUnitRecords(current, true).some((item) => item.id_unidade === unit.id_unidade)) return false;
      return hasProfile(current, 'Supervisor') || assignedUnitIds(current).includes(unit.id_unidade);
    },
    [user, hasProfile, unitForName, effectiveSupervisionId, authorizedUnitRecords, assignedUnitIds]
  );

  const canAccessPage = useCallback(
    (pageName: PageName, u?: User | null): boolean => {
      const current = u || user;
      if (!current) return false;
      if (pageName === 'usuarios' && !hasProfile(current, 'Administrador', 'Supervisor')) return false;
      if (['inspecao-veicular', 'hist-inspecoes'].includes(pageName)) {
        return hasProfile(current, 'Administrador', 'Supervisor', 'Líder', 'Operador');
      }
      if (hasProfile(current, 'Operador')) {
        return ['occ-register', 'chaves', 'inspecao-veicular', 'hist-inspecoes'].includes(pageName);
      }
      if (hasProfile(current, 'Líder')) {
        return pageName !== 'usuarios';
      }
      return true;
    },
    [user, hasProfile]
  );

  const canManageUsers = useCallback(
    (u?: User | null) => hasProfile(u || user, 'Administrador', 'Supervisor'),
    [user, hasProfile]
  );

  const canValidateOccurrence = useCallback(
    (u?: User | null) => hasProfile(u || user, 'Administrador', 'Supervisor', 'Líder'),
    [user, hasProfile]
  );

  const canRegisterOccurrence = useCallback(
    (u?: User | null) => hasProfile(u || user, 'Administrador', 'Supervisor', 'Líder', 'Operador'),
    [user, hasProfile]
  );

  const isAdministratorUser = useCallback(
    (u?: User | null) => hasProfile(u || user, 'Administrador'),
    [user, hasProfile]
  );

  // Scoping data
  const scopeOccurrences = useCallback(
    (rows: Occurrence[], u?: User | null): Occurrence[] => {
      const current = u || user;
      if (!current) return [];
      if (hasProfile(current, 'Administrador')) return rows;
      return rows.filter((row) => canAccessUnit(row.unidade, current));
    },
    [user, hasProfile, canAccessUnit]
  );

  const scopePending = useCallback(
    (rows: PendingOccurrence[], u?: User | null): PendingOccurrence[] => {
      const current = u || user;
      if (!current) return [];
      if (hasProfile(current, 'Administrador')) return rows;
      return rows.filter((row) => canAccessUnit(row.unidade, current));
    },
    [user, hasProfile, canAccessUnit]
  );

  const scopeAmbiental = useCallback(
    (rows: EnvironmentalInspection[], u?: User | null): EnvironmentalInspection[] => {
      const current = u || user;
      if (!current || !rows) return [];
      if (hasProfile(current, 'Administrador')) return rows;
      return rows.filter((row) => {
        const unit = String(row?.unidade || '').trim();
        if (hasProfile(current, 'Supervisor')) {
          const sup = String(row?.supervisao || '').trim();
          return !sup || sup === String(effectiveSupervisionId(current));
        }
        return !unit || canAccessUnit(unit, current);
      });
    },
    [user, hasProfile, effectiveSupervisionId, canAccessUnit]
  );

  const scopeKeys = useCallback(
    (rows: KeyRecord[], u?: User | null): KeyRecord[] => {
      const current = u || user;
      if (!current) return [];
      if (hasProfile(current, 'Administrador')) return rows;
      return rows.filter((row) => canAccessUnit(row.unidade, current));
    },
    [user, hasProfile, canAccessUnit]
  );

  // Photo handlers
  const addPhotoFiles = async (files: FileList | File[]) => {
    const space = 6 - (existingPhotos.length + newPhotos.length);
    if (files.length > space) {
      setErrorPopup({
        titulo: 'Limite de fotos excedido',
        mensagem: `Limite de 6 fotos por ocorrência. Restam ${space} vagas.`,
      });
      return;
    }
    const added: PhotoItem[] = [];
    for (const f of Array.from(files)) {
      try {
        const compressed = await compressImage(f);
        added.push(compressed);
      } catch (err: any) {
        setErrorPopup({
          titulo: 'Falha na imagem',
          mensagem: err?.message || 'Erro ao comprimir imagem.',
        });
      }
    }
    if (added.length) {
      setNewPhotos((prev) => [...prev, ...added]);
      setMessage(`${added.length} foto(s) adicionada(s) e comprimida(s).`);
    }
  };

  const removeNewPhoto = (index: number) => {
    setNewPhotos((prev) => {
      const next = [...prev];
      if (next[index]?.url) URL.revokeObjectURL(next[index].url);
      next.splice(index, 1);
      return next;
    });
  };

  const removeExistingPhoto = (index: number) => {
    setExistingPhotos((prev) => {
      const next = [...prev];
      if (next[index]?.url) URL.revokeObjectURL(next[index].url);
      next.splice(index, 1);
      return next;
    });
  };

  // Auth
  const login = async (loginInput: string, passwordInput: string): Promise<boolean> => {
    try {
      const ph = await hash(passwordInput);
      const found = users.find(
        (x) => x.login.trim().toLowerCase() === loginInput.trim().toLowerCase() && x.senha_hash === ph && x.status === 'Ativo'
      );
      if (!found) {
        setMessage('Login, senha ou status inválido.');
        return false;
      }
      const canonicalUser = { ...found, perfil: canonicalPerfil(found.perfil) };
      setUser(canonicalUser);
      setMessage('');
      if (hasProfile(canonicalUser, 'Operador')) {
        setPage('occ-register');
        setEditingOccurrence({});
        setOccurrencesMenuOpen(true);
      } else {
        setPage('dashboard');
        setEditingOccurrence(null);
      }
      return true;
    } catch (err: any) {
      setMessage(err?.message || 'Falha na autenticação.');
      return false;
    }
  };

  const logout = () => {
    setUser(null);
    setPage('dashboard');
    setEditingOccurrence(null);
    setEditingKey(null);
    setEditingInspection(null);
    setEditingUser(null);
    setExistingPhotos([]);
    setNewPhotos([]);
    setLightboxUrl(null);
    setSuccessPopup(null);
    setErrorPopup(null);
    setMessage('');
  };

  // Add audit record
  const logAudit = (modulo: string, acao: string, idRegistro: string, codigo: string, detalhes: string) => {
    if (!user) return;
    const item: AuditRecord = {
      id_auditoria: uid(),
      data_hora: new Date().toISOString(),
      usuario: user.login,
      perfil: user.perfil,
      modulo,
      acao,
      id_registro: idRegistro,
      codigo_registro: codigo,
      detalhes,
    };
    setAudits((prev) => [item, ...prev]);
  };

  // Occurrences CRUD
  const saveOccurrence = async (formData: Record<string, string>): Promise<boolean> => {
    if (!user) return false;
    const isEdit = Boolean(formData.id_ocorrencia);
    const isOperator = hasProfile(user, 'Operador');

    // Validation checks
    const errors: string[] = [];
    if (!formData.unidade) errors.push('Selecione a unidade.');
    if (!canAccessUnit(formData.unidade, user)) errors.push('Seu cadastro não autoriza o registro nesta unidade.');
    if (!formData.data_ocorrencia) errors.push('Informe a data da ocorrência.');
    if (!formData.hora_ocorrencia) errors.push('Informe a hora da ocorrência.');
    if (!formData.natureza_ocorrencia) errors.push('Selecione a natureza da ocorrência.');
    if (!formData.local_especifico || formData.local_especifico.trim().length < 3) {
      errors.push('Informe o local específico (mínimo de 3 caracteres).');
    }
    if (!formData.relato_detalhado || formData.relato_detalhado.trim().length < 20) {
      errors.push('O relato detalhado deve possuir pelo menos 20 caracteres.');
    }
    if (formData.relato_detalhado && formData.relato_detalhado.length > 5000) {
      errors.push('O relato detalhado não pode ultrapassar 5.000 caracteres.');
    }

    if (errors.length > 0) {
      setErrorPopup({
        titulo: 'Não foi possível salvar a ocorrência',
        mensagem: errors.join(' '),
      });
      return false;
    }

    const time = new Date().toISOString();
    const sup = supervisionForUnit(formData.unidade);
    const supervisionName = sup?.nome || formData.supervisao || 'DISTRIBUIÇÃO';

    // Store photos as data URLs or placeholders
    const allPhotos = [...existingPhotos, ...newPhotos];
    const photoRefs = allPhotos.map((p, idx) => p.url || `foto_${idx + 1}.jpg`).join('|');

    if (isEdit && !isOperator) {
      const current = occurrences.find((x) => x.id_ocorrencia === formData.id_ocorrencia);
      if (!current) {
        setErrorPopup({ titulo: 'Erro ao salvar', mensagem: 'Ocorrência não encontrada.' });
        return false;
      }
      const updated: Occurrence = {
        ...current,
        ...formData,
        prioridade: (formData.prioridade as any) || current.prioridade,
        status: (formData.status as any) || current.status,
        supervisao: supervisionName,
        anexos_referencias: photoRefs,
        versao_registro: String((+current.versao_registro || 0) + 1),
        usuario_ultima_alteracao: user.login,
      };

      setOccurrences((prev) => prev.map((x) => (x.id_ocorrencia === current.id_ocorrencia ? updated : x)));
      setExistingPhotos([]);
      setNewPhotos([]);
      setEditingOccurrence(null);
      setSuccessPopup({
        protocolo: updated.numero_protocolo,
        unidade: updated.unidade,
        dataRegistro: updated.data_registro || time,
        usuario: user.login,
        idOcorrencia: updated.id_ocorrencia,
        kind: 'edit',
      });
      logAudit('OCORRENCIAS', 'OCORRENCIA_ALTERADA', updated.id_ocorrencia, updated.numero_protocolo, `${updated.unidade}; ${updated.natureza_ocorrencia}`);
      return true;
    }

    // New occurrence
    const protocol = nextOccurrenceProtocol(occurrences, pendingOccurrences);
    const id = uid();

    if (isOperator) {
      // Goes to pending validation queue
      const pendingRow: PendingOccurrence = {
        id_ocorrencia: id,
        numero_protocolo: protocol,
        data_ocorrencia: formData.data_ocorrencia,
        hora_ocorrencia: formData.hora_ocorrencia,
        gerencia: formData.gerencia || 'GSP/SP',
        supervisao: supervisionName,
        unidade: formData.unidade,
        area: formData.area || '',
        local_especifico: formData.local_especifico,
        natureza_ocorrencia: formData.natureza_ocorrencia,
        tipo_vinculo: formData.tipo_vinculo || 'Terceiro',
        nome_envolvido: formData.nome_envolvido || '',
        empresa_envolvido: formData.empresa_envolvido || '',
        matricula_id: formData.matricula_id || '',
        telefone: formData.telefone || '',
        documento: formData.documento || '',
        placa_veiculo: formData.placa_veiculo || '',
        relato_detalhado: formData.relato_detalhado,
        providencias_adotadas: formData.providencias_adotadas || '',
        prioridade: (formData.prioridade as any) || 'Média',
        status: 'Pendente de validação',
        anexos_referencias: photoRefs,
        responsavel_registro: user.login,
        perfil_registro: canonicalPerfil(user.perfil),
        data_registro: time,
        versao_registro: '1',
        usuario_ultima_alteracao: user.login,
        status_validacao: 'Pendente de validação',
        data_envio_validacao: time,
        validado_por: '',
        data_validacao: '',
        observacao_validacao: '',
      };

      setPendingOccurrences((prev) => [pendingRow, ...prev]);
      setExistingPhotos([]);
      setNewPhotos([]);
      setEditingOccurrence(null);
      setSuccessPopup({
        protocolo: protocol,
        unidade: pendingRow.unidade,
        dataRegistro: time,
        usuario: user.login,
        idOcorrencia: id,
        kind: 'pending',
      });
      return true;
    }

    // Directly registered by Admin / Supervisor / Líder
    const newRow: Occurrence = {
      id_ocorrencia: id,
      numero_protocolo: protocol,
      data_ocorrencia: formData.data_ocorrencia,
      hora_ocorrencia: formData.hora_ocorrencia,
      gerencia: formData.gerencia || 'GSP/SP',
      supervisao: supervisionName,
      unidade: formData.unidade,
      area: formData.area || '',
      local_especifico: formData.local_especifico,
      natureza_ocorrencia: formData.natureza_ocorrencia,
      tipo_vinculo: formData.tipo_vinculo || 'Terceiro',
      nome_envolvido: formData.nome_envolvido || '',
      empresa_envolvido: formData.empresa_envolvido || '',
      matricula_id: formData.matricula_id || '',
      telefone: formData.telefone || '',
      documento: formData.documento || '',
      placa_veiculo: formData.placa_veiculo || '',
      relato_detalhado: formData.relato_detalhado,
      providencias_adotadas: formData.providencias_adotadas || '',
      prioridade: (formData.prioridade as any) || 'Média',
      status: (formData.status as any) || 'Registrada',
      anexos_referencias: photoRefs,
      responsavel_registro: user.login,
      perfil_registro: canonicalPerfil(user.perfil),
      data_registro: time,
      versao_registro: '1',
      usuario_ultima_alteracao: user.login,
    };

    setOccurrences((prev) => [newRow, ...prev]);
    setExistingPhotos([]);
    setNewPhotos([]);
    setEditingOccurrence(null);
    setSuccessPopup({
      protocolo: protocol,
      unidade: newRow.unidade,
      dataRegistro: time,
      usuario: user.login,
      idOcorrencia: id,
      kind: 'create',
    });
    logAudit('OCORRENCIAS', 'OCORRENCIA_CADASTRADA', id, protocol, `${newRow.unidade}; ${newRow.natureza_ocorrencia}`);
    return true;
  };

  const validatePendingOcc = async (id: string): Promise<boolean> => {
    if (!user || !canValidateOccurrence(user)) {
      setErrorPopup({ titulo: 'Acesso negado', mensagem: 'Seu perfil não pode validar ocorrências.' });
      return false;
    }
    const current = pendingOccurrences.find((x) => x.id_ocorrencia === id);
    if (!current) {
      setErrorPopup({ titulo: 'Erro', mensagem: 'Registro não encontrado.' });
      return false;
    }
    const time = new Date().toISOString();
    const approved: Occurrence = {
      ...current,
      status: 'Registrada',
      versao_registro: String((+current.versao_registro || 0) + 1),
      usuario_ultima_alteracao: user.login,
    };

    setOccurrences((prev) => [approved, ...prev.filter((x) => x.id_ocorrencia !== id)]);
    setPendingOccurrences((prev) =>
      prev.map((x) =>
        x.id_ocorrencia === id
          ? {
              ...x,
              status_validacao: 'Validada',
              data_validacao: time,
              validado_por: user.login,
              observacao_validacao: 'Aprovado pela validação corporativa',
            }
          : x
      )
    );
    setMessage(`Ocorrência ${current.numero_protocolo} validada e incluída no histórico.`);
    logAudit('OCORRENCIAS', 'OCORRENCIA_VALIDADA', current.id_ocorrencia, current.numero_protocolo, `Validado por ${user.login}`);
    return true;
  };

  // Environmental Inspections CRUD
  const saveEnvironmental = async (data: Partial<EnvironmentalInspection>): Promise<boolean> => {
    if (!user) return false;
    const isEdit = Boolean(data.id);
    const isSim = String(data.realizar_monitoramento || 'Sim').trim() === 'Sim';

    if (!data.data) {
      setErrorPopup({ titulo: 'Validação', mensagem: 'Informe a data da inspeção.' });
      return false;
    }
    if (isSim) {
      if (!data.placa || !data.transportadora || !data.nota || !data.laudo || !data.observacao || !data.responsavel) {
        setErrorPopup({ titulo: 'Validação', mensagem: 'Preencha todos os campos obrigatórios da inspeção.' });
        return false;
      }
    } else {
      if (!data.motivo_nao_execucao) {
        setErrorPopup({ titulo: 'Validação', mensagem: 'Selecione o motivo da não execução.' });
        return false;
      }
    }

    const time = new Date().toISOString();
    const userUnits = assignedUnitIds(user);
    const unit = String(data.unidade || (userUnits[0] ? unitCatalog.find((u) => u.id_unidade === userUnits[0])?.nome : '') || 'Mogi das Cruzes');
    const supervisao = String(data.supervisao || supervisionForUnit(unit)?.nome || 'DISTRIBUIÇÃO');

    if (isEdit) {
      const current = inspecoes.find((x) => String(x.id) === String(data.id));
      if (!current) return false;
      const updated: EnvironmentalInspection = {
        ...current,
        ...data,
        realizar_monitoramento: isSim ? 'Sim' : 'Não',
        motivo_nao_execucao: isSim ? '' : String(data.motivo_nao_execucao || ''),
        placa: isSim ? String(data.placa || '') : '',
        transportadora: isSim ? String(data.transportadora || '') : '',
        nota: isSim ? String(data.nota || '') : '',
        laudo: isSim ? (data.laudo as any) : '',
        observacao: isSim ? String(data.observacao || '') : '',
        responsavel: String(data.responsavel || user.nome).trim(),
        matricula_responsavel: String(data.matricula_responsavel || (user as any).matricula || (user as any).id_usuario || '').trim(),
        data_hora_alteracao: time,
        alterado_por: user.login,
      };
      setInspecoes((prev) => prev.map((x) => (String(x.id) === String(updated.id) ? updated : x)));
      setMessage('Inspeção alterada com sucesso.');
      setEditingInspection(null);
      setPage('hist-inspecoes');
      logAudit('MEIO_AMBIENTE', 'INSPECAO_ALTERADA', updated.id, updated.placa || 'N/A', `${updated.unidade}; ${updated.laudo}`);
      return true;
    }

    const newRec: EnvironmentalInspection = {
      id: uid(),
      data: String(data.data),
      realizar_monitoramento: isSim ? 'Sim' : 'Não',
      motivo_nao_execucao: isSim ? '' : String(data.motivo_nao_execucao || ''),
      placa: isSim ? String(data.placa || '') : '',
      transportadora: isSim ? String(data.transportadora || '') : '',
      nota: isSim ? String(data.nota || '') : '',
      laudo: isSim ? (data.laudo as any) : '',
      observacao: isSim ? String(data.observacao || '') : '',
      responsavel: String(data.responsavel || user.nome).trim(),
      matricula_responsavel: String(data.matricula_responsavel || (user as any).matricula || (user as any).id_usuario || '').trim(),
      usuario_registro: user.login,
      data_hora_registro: time,
      data_hora_alteracao: '',
      alterado_por: '',
      unidade: unit,
      supervisao: supervisao,
    };

    setInspecoes((prev) => [newRec, ...prev]);
    setMessage('Inspeção registrada com sucesso.');
    setEditingInspection(null);
    setPage('hist-inspecoes');
    logAudit('MEIO_AMBIENTE', 'INSPECAO_CADASTRADA', newRec.id, newRec.placa || 'N/A', `${newRec.unidade}; ${newRec.laudo}`);
    return true;
  };

  // Keys CRUD
  const saveKeyRecord = async (data: Partial<KeyRecord>): Promise<boolean> => {
    if (!user) return false;
    const isEdit = Boolean(data.id_chave);
    if (!data.codigo || !data.descricao || !data.setor || !data.unidade) {
      setErrorPopup({ titulo: 'Validação', mensagem: 'Preencha código, descrição, setor e unidade.' });
      return false;
    }
    const time = new Date().toISOString();
    if (isEdit) {
      const current = keys.find((x) => x.id_chave === data.id_chave);
      if (!current) return false;
      const updated: KeyRecord = {
        ...current,
        ...data,
        versao_registro: String((+current.versao_registro || 0) + 1),
        data_atualizacao: time,
        usuario_ultima_alteracao: user.login,
      } as KeyRecord;
      setKeys((prev) => prev.map((k) => (k.id_chave === current.id_chave ? updated : k)));
      setEditingKey(null);
      setMessage('Chave atualizada com sucesso.');
      logAudit('CHAVES', 'CHAVE_ALTERADA', updated.id_chave, updated.codigo, `${updated.descricao}; ${updated.status}`);
      return true;
    }

    const newKey: KeyRecord = {
      id_chave: uid(),
      codigo: String(data.codigo),
      descricao: String(data.descricao),
      setor: String(data.setor),
      unidade: String(data.unidade),
      status: (data.status as any) || 'Disponível',
      observacoes: String(data.observacoes || ''),
      versao_registro: '1',
      data_atualizacao: time,
      usuario_ultima_alteracao: user.login,
    };
    setKeys((prev) => [newKey, ...prev]);
    setEditingKey(null);
    setMessage('Chave cadastrada com sucesso.');
    logAudit('CHAVES', 'CHAVE_CADASTRADA', newKey.id_chave, newKey.codigo, `${newKey.descricao}; ${newKey.status}`);
    return true;
  };

  // Users CRUD
  const saveUserRecord = async (data: Partial<User>, password?: string): Promise<boolean> => {
    if (!user || !canManageUsers(user)) return false;
    const isEdit = Boolean(data.id_usuario);
    const loginClean = String(data.login || '').trim();

    if (!data.nome?.trim()) {
      setErrorPopup({ titulo: 'Validação de usuário', mensagem: 'Informe o nome completo.' });
      return false;
    }
    if (!loginClean) {
      setErrorPopup({ titulo: 'Validação de usuário', mensagem: 'Informe o login.' });
      return false;
    }
    if (!isEdit && (!password || password.length < 8)) {
      setErrorPopup({ titulo: 'Validação de usuário', mensagem: 'A senha deve possuir no mínimo 8 caracteres.' });
      return false;
    }
    if (users.some((x) => x.login.toLowerCase() === loginClean.toLowerCase() && x.id_usuario !== data.id_usuario)) {
      setErrorPopup({ titulo: 'Usuário duplicado', mensagem: 'Já existe um usuário com esse login. Escolha outro login.' });
      return false;
    }

    const time = new Date().toISOString();
    const profile = canonicalPerfil(data.perfil || 'Operador');

    if (isEdit) {
      const current = users.find((x) => x.id_usuario === data.id_usuario);
      if (!current) return false;
      const updated: User = {
        ...current,
        nome: String(data.nome).trim(),
        login: loginClean,
        perfil: profile,
        unidades_permitidas: profile === 'Administrador' ? '*' : data.unidades_permitidas || '',
        supervisao_id: profile === 'Administrador' ? '' : data.supervisao_id || '',
        status: data.status || 'Ativo',
        versao_registro: String((+current.versao_registro || 0) + 1),
        data_atualizacao: time,
        usuario_ultima_alteracao: user.login,
      };
      setUsers((prev) => prev.map((u) => (u.id_usuario === current.id_usuario ? updated : u)));
      if (user.id_usuario === updated.id_usuario) {
        setUser(updated);
      }
      setEditingUser(null);
      setMessage('Usuário atualizado com sucesso.');
      logAudit('USUARIOS', 'USUARIO_EDITADO', updated.id_usuario, updated.login, `${updated.nome}; ${updated.perfil}`);
      return true;
    }

    const newHash = await hash(password!);
    const newUser: User = {
      id_usuario: uid(),
      nome: String(data.nome).trim(),
      login: loginClean,
      senha_hash: newHash,
      perfil: profile,
      unidades_permitidas: profile === 'Administrador' ? '*' : data.unidades_permitidas || '',
      supervisao_id: profile === 'Administrador' ? '' : data.supervisao_id || '',
      status: data.status || 'Ativo',
      data_criacao: time,
      versao_registro: '1',
      data_atualizacao: time,
      usuario_ultima_alteracao: user.login,
    };
    setUsers((prev) => [newUser, ...prev]);
    setEditingUser(null);
    setMessage('Usuário cadastrado com sucesso.');
    logAudit('USUARIOS', 'USUARIO_CADASTRADO', newUser.id_usuario, newUser.login, `${newUser.nome}; ${newUser.perfil}`);
    return true;
  };

  const toggleUser = async (id: string): Promise<boolean> => {
    if (!user || !canManageUsers(user)) return false;
    const current = users.find((x) => x.id_usuario === id);
    if (!current) return false;
    if (current.login === 'admin') {
      setErrorPopup({ titulo: 'Operação não permitida', mensagem: 'O administrador principal não pode ser bloqueado.' });
      return false;
    }
    const newStatus = current.status === 'Ativo' ? 'Inativo' : 'Ativo';
    const updated: User = {
      ...current,
      status: newStatus,
      versao_registro: String((+current.versao_registro || 0) + 1),
      data_atualizacao: new Date().toISOString(),
      usuario_ultima_alteracao: user.login,
    };
    setUsers((prev) => prev.map((u) => (u.id_usuario === id ? updated : u)));
    setMessage(newStatus === 'Ativo' ? 'Usuário reativado.' : 'Usuário bloqueado.');
    logAudit('USUARIOS', newStatus === 'Ativo' ? 'USUARIO_REATIVADO' : 'USUARIO_BLOQUEADO', current.id_usuario, current.login, `${current.nome}`);
    return true;
  };

  const changePassword = async (id: string, newPassword: string): Promise<boolean> => {
    if (!user || !canManageUsers(user)) return false;
    const target = users.find((u) => u.id_usuario === id);
    if (!target) return false;
    if (newPassword.length < 8) {
      setErrorPopup({ titulo: 'Validação de senha', mensagem: 'A nova senha deve ter no mínimo 8 caracteres.' });
      return false;
    }
    const newHash = await hash(newPassword);
    const updated: User = {
      ...target,
      senha_hash: newHash,
      versao_registro: String((+target.versao_registro || 0) + 1),
      data_atualizacao: new Date().toISOString(),
      usuario_ultima_alteracao: user.login,
    };
    setUsers((prev) => prev.map((u) => (u.id_usuario === id ? updated : u)));
    setUserPasswordTarget(null);
    setMessage('Senha alterada com sucesso.');
    logAudit('USUARIOS', 'USUARIO_SENHA_ALTERADA', target.id_usuario, target.login, `${target.nome}; senha alterada`);
    return true;
  };

  const removeUser = async (id: string): Promise<boolean> => {
    if (!user || !canManageUsers(user)) return false;
    const target = users.find((u) => u.id_usuario === id);
    if (!target) return false;
    if (target.id_usuario === user.id_usuario) {
      setErrorPopup({ titulo: 'Operação bloqueada', mensagem: 'Não é possível remover o usuário atualmente conectado.' });
      return false;
    }
    if (target.login === 'admin') {
      setErrorPopup({ titulo: 'Operação bloqueada', mensagem: 'Não é possível remover o administrador principal.' });
      return false;
    }
    setUsers((prev) => prev.filter((u) => u.id_usuario !== id));
    setUserRemovalTarget(null);
    setMessage('Usuário removido com sucesso.');
    logAudit('USUARIOS', 'USUARIO_REMOVIDO', target.id_usuario, target.login, `${target.nome}; conta removida`);
    return true;
  };

  // Master Data CRUD (Configurações)
  const saveMasterRecord = async (
    entity: 'supervision' | 'unit' | 'nature',
    name: string,
    parentSupervisionId?: string
  ): Promise<boolean> => {
    if (!user || !isAdministratorUser(user)) {
      setAccessDenied(true);
      return false;
    }
    const cleanName = name.trim();
    if (!cleanName) {
      setErrorPopup({ titulo: 'Validação', mensagem: 'Informe o nome do cadastro.' });
      return false;
    }

    const editId = masterEditor?.id;
    if (entity === 'supervision') {
      if (supervisions.some((s) => s.id_supervisao !== editId && normalizedMasterName(s.nome) === normalizedMasterName(cleanName))) {
        setErrorPopup({ titulo: 'Duplicidade', mensagem: 'Já existe uma supervisão com esse nome.' });
        return false;
      }
      if (editId) {
        setSupervisions((prev) => prev.map((s) => (s.id_supervisao === editId ? { ...s, nome: cleanName } : s)));
        logAudit('ORGANIZACAO', 'SUPERVISAO_ALTERADA', editId, cleanName, cleanName);
      } else {
        const newId = uid();
        setSupervisions((prev) => [...prev, { id_supervisao: newId, nome: cleanName, ativo: '1' }]);
        logAudit('ORGANIZACAO', 'SUPERVISAO_CADASTRADA', newId, cleanName, cleanName);
      }
    } else if (entity === 'unit') {
      if (!parentSupervisionId) {
        setErrorPopup({ titulo: 'Validação', mensagem: 'Selecione uma supervisão ativa para a unidade.' });
        return false;
      }
      if (unitCatalog.some((u) => u.id_unidade !== editId && normalizedMasterName(u.nome) === normalizedMasterName(cleanName))) {
        setErrorPopup({ titulo: 'Duplicidade', mensagem: 'Já existe uma unidade com esse nome.' });
        return false;
      }
      if (editId) {
        setUnitCatalog((prev) =>
          prev.map((u) => {
            if (u.id_unidade !== editId) return u;
            const aliases = aliasesOf(u);
            if (!aliases.includes(u.nome) && u.nome !== cleanName) aliases.push(u.nome);
            return {
              ...u,
              nome: cleanName,
              id_supervisao: parentSupervisionId,
              aliases: JSON.stringify(aliases),
            };
          })
        );
        logAudit('ORGANIZACAO', 'UNIDADE_ALTERADA', editId, cleanName, cleanName);
      } else {
        const newId = uid();
        setUnitCatalog((prev) => [
          ...prev,
          { id_unidade: newId, nome: cleanName, id_supervisao: parentSupervisionId, ativo: '1', aliases: '[]' },
        ]);
        logAudit('ORGANIZACAO', 'UNIDADE_CADASTRADA', newId, cleanName, cleanName);
      }
    } else {
      // Nature
      if (natureCatalog.some((n) => n.id_natureza !== editId && normalizedMasterName(n.nome) === normalizedMasterName(cleanName))) {
        setErrorPopup({ titulo: 'Duplicidade', mensagem: 'Já existe uma natureza com esse nome.' });
        return false;
      }
      if (editId) {
        setNatureCatalog((prev) =>
          prev.map((n) => {
            if (n.id_natureza !== editId) return n;
            const aliases = aliasesOf(n);
            if (!aliases.includes(n.nome) && n.nome !== cleanName) aliases.push(n.nome);
            return {
              ...n,
              nome: cleanName,
              aliases: JSON.stringify(aliases),
            };
          })
        );
        logAudit('ORGANIZACAO', 'NATUREZA_ALTERADA', editId, cleanName, cleanName);
      } else {
        const newId = uid();
        setNatureCatalog((prev) => [...prev, { id_natureza: newId, nome: cleanName, ativo: '1', aliases: '[]' }]);
        logAudit('ORGANIZACAO', 'NATUREZA_CADASTRADA', newId, cleanName, cleanName);
      }
    }
    setMasterEditor(null);
    setMessage('Configuração salva com sucesso.');
    return true;
  };

  const toggleMasterStatus = async (): Promise<boolean> => {
    if (!masterConfirmation) return false;
    const { entity, id, active, name } = masterConfirmation;
    const newStatus = active ? '1' : '0';

    if (entity === 'supervision') {
      setSupervisions((prev) => prev.map((s) => (s.id_supervisao === id ? { ...s, ativo: newStatus } : s)));
      logAudit('ORGANIZACAO', active ? 'SUPERVISAO_REATIVADA' : 'SUPERVISAO_INATIVADA', id, name, name);
    } else if (entity === 'unit') {
      setUnitCatalog((prev) => prev.map((u) => (u.id_unidade === id ? { ...u, ativo: newStatus } : u)));
      logAudit('ORGANIZACAO', active ? 'UNIDADE_REATIVADA' : 'UNIDADE_INATIVADA', id, name, name);
    } else {
      setNatureCatalog((prev) => prev.map((n) => (n.id_natureza === id ? { ...n, ativo: newStatus } : n)));
      logAudit('ORGANIZACAO', active ? 'NATUREZA_REATIVADA' : 'NATUREZA_INATIVADA', id, name, name);
    }
    setMasterConfirmation(null);
    setMessage(`Cadastro ${active ? 'reativado' : 'inativado'} com sucesso.`);
    return true;
  };

  // PDF Export
  const triggerPdfExport = async (occurrenceId: string) => {
    const occ = occurrences.find((x) => x.id_ocorrencia === occurrenceId);
    if (!occ) {
      setPdfResult({
        show: true,
        success: false,
        message: 'Ocorrência não encontrada.',
      });
      return;
    }
    setPdfProgress({
      show: true,
      progress: 5,
      message: 'Iniciando preparação do relatório executivo...',
      title: 'Gerando relatório da ocorrência...',
    });

    try {
      // Reconstruct photos
      const photoPaths = String(occ.anexos_referencias || '')
        .split('|')
        .filter(Boolean);
      const photoItems: PhotoItem[] = photoPaths.map((p, idx) => ({
        name: `Foto ${idx + 1}`,
        url: p.startsWith('data:') || p.startsWith('blob:') ? p : '',
        path: p,
      }));

      const fileName = await generateOccurrencePdfDocument(occ, photoItems, (prog, msg) => {
        setPdfProgress({
          show: true,
          progress: prog,
          message: msg,
          title: 'Gerando relatório da ocorrência...',
        });
      });

      setPdfProgress(null);
      setPdfResult({
        show: true,
        success: true,
        message: 'O relatório executivo foi gerado e baixado automaticamente.',
        fileName,
      });
    } catch (err: any) {
      setPdfProgress(null);
      setPdfResult({
        show: true,
        success: false,
        message: err?.message || 'Falha ao processar a geração do relatório PDF.',
      });
    }
  };

  // CSV export
  const exportScopedData = (kind: 'occ' | 'keys') => {
    const isOcc = kind === 'occ';
    const rows = isOcc ? scopeOccurrences(occurrences) : scopeKeys(keys);
    const headers = isOcc
      ? [
          'id_ocorrencia',
          'numero_protocolo',
          'data_ocorrencia',
          'hora_ocorrencia',
          'gerencia',
          'supervisao',
          'unidade',
          'area',
          'local_especifico',
          'natureza_ocorrencia',
          'tipo_vinculo',
          'nome_envolvido',
          'empresa_envolvido',
          'matricula_id',
          'telefone',
          'documento',
          'placa_veiculo',
          'relato_detalhado',
          'providencias_adotadas',
          'prioridade',
          'status',
          'anexos_referencias',
          'responsavel_registro',
          'perfil_registro',
          'data_registro',
          'versao_registro',
          'usuario_ultima_alteracao',
        ]
      : [
          'id_chave',
          'codigo',
          'descricao',
          'setor',
          'unidade',
          'status',
          'observacoes',
          'versao_registro',
          'data_atualizacao',
          'usuario_ultima_alteracao',
        ];

    const csvContent =
      '\ufeff' +
      [
        headers.join(';'),
        ...rows.map((r: any) =>
          headers
            .map((h) => {
              let v = String(r[h] ?? '');
              return /[;"\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
            })
            .join(';')
        ),
      ].join('\r\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = isOcc ? 'ocorrencias.csv' : 'chaves.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const resetAllDataToDefaults = () => {
    setUsers(SEED_USERS);
    setSupervisions(SEED_SUPERVISIONS);
    setUnitCatalog(SEED_UNITS);
    setNatureCatalog(SEED_NATURES);
    setOccurrences(SEED_OCCURRENCES);
    setPendingOccurrences(SEED_PENDING_OCCURRENCES);
    setKeys(SEED_KEYS);
    setInspecoes(SEED_INSPECOES);
    setAudits(SEED_AUDITS);
    setMessage('Dados redefinidos para os padrões iniciais do sistema.');
  };

  return (
    <AppContext.Provider
      value={{
        user,
        page,
        setPage,
        message,
        setMessage,
        accessDenied,
        setAccessDenied,
        users,
        supervisions,
        unitCatalog,
        natureCatalog,
        occurrences,
        pendingOccurrences,
        keys,
        inspecoes,
        audits,
        editingOccurrence,
        setEditingOccurrence,
        editingKey,
        setEditingKey,
        editingInspection,
        setEditingInspection,
        editingUser,
        setEditingUser,
        existingPhotos,
        setExistingPhotos,
        newPhotos,
        setNewPhotos,
        addPhotoFiles,
        removeNewPhoto,
        removeExistingPhoto,
        lightboxUrl,
        setLightboxUrl,
        historyFilters,
        setHistoryFilters,
        clearHistoryFilters,
        ambientalFilters,
        setAmbientalFilters,
        clearAmbientalFilters,
        successPopup,
        setSuccessPopup,
        errorPopup,
        setErrorPopup,
        detailModal,
        setDetailModal,
        pdfProgress,
        setPdfProgress,
        pdfResult,
        setPdfResult,
        occurrencesMenuOpen,
        setOccurrencesMenuOpen,
        environmentMenuOpen,
        setEnvironmentMenuOpen,
        settingsTab,
        setSettingsTab,
        settingsSearch,
        setSettingsSearch,
        masterEditor,
        setMasterEditor,
        masterConfirmation,
        setMasterConfirmation,
        userPasswordTarget,
        setUserPasswordTarget,
        userRemovalTarget,
        setUserRemovalTarget,
        login,
        logout,
        effectiveSupervisionId,
        assignedUnitIds,
        authorizedUnitRecords,
        authorizedUnitNames,
        canAccessUnit,
        supervisionForUnit,
        hasProfile,
        canAccessPage,
        canManageUsers,
        canValidateOccurrence,
        canRegisterOccurrence,
        isAdministratorUser,
        scopeOccurrences,
        scopePending,
        scopeAmbiental,
        scopeKeys,
        saveOccurrence,
        validatePendingOcc,
        saveKeyRecord,
        saveEnvironmental,
        saveUserRecord,
        toggleUser,
        changePassword,
        removeUser,
        saveMasterRecord,
        toggleMasterStatus,
        triggerPdfExport,
        exportScopedData,
        resetAllDataToDefaults,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
};
