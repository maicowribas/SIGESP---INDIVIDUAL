export type Profile = 'Administrador' | 'Supervisor' | 'Líder' | 'Operador' | 'Consulta';

export interface User {
  id_usuario: string;
  nome: string;
  login: string;
  senha_hash: string;
  perfil: Profile;
  unidades_permitidas: string; // pipe-separated unit IDs or '*'
  supervisao_id?: string;
  status: 'Ativo' | 'Inativo';
  data_criacao?: string;
  ultimo_acesso?: string;
  versao_registro: string;
  data_atualizacao?: string;
  usuario_ultima_alteracao?: string;
}

export interface Supervision {
  id_supervisao: string;
  nome: string;
  ativo: string; // '1' or '0'
}

export interface Unit {
  id_unidade: string;
  nome: string;
  id_supervisao: string;
  ativo: string; // '1' or '0'
  aliases?: string; // JSON string array
}

export interface Nature {
  id_natureza: string;
  nome: string;
  ativo: string; // '1' or '0'
  aliases?: string; // JSON string array
}

export type Priority = 'Baixa' | 'Média' | 'Alta' | 'Crítica';
export type OccurrenceStatus = 'Rascunho' | 'Registrada' | 'Em Apuração' | 'Encerrada' | 'Pendente de validação';

export interface Occurrence {
  id_ocorrencia: string;
  numero_protocolo: string;
  data_ocorrencia: string;
  hora_ocorrencia: string;
  gerencia: string;
  supervisao: string;
  unidade: string;
  area: string;
  local_especifico: string;
  natureza_ocorrencia: string;
  tipo_vinculo: string;
  nome_envolvido: string;
  empresa_envolvido: string;
  matricula_id: string;
  telefone: string;
  documento: string;
  placa_veiculo: string;
  relato_detalhado: string;
  providencias_adotadas: string;
  prioridade: Priority;
  status: OccurrenceStatus;
  anexos_referencias: string; // pipe-separated paths or data URIs
  responsavel_registro: string;
  perfil_registro: string;
  data_registro: string;
  versao_registro: string;
  usuario_ultima_alteracao: string;
  observacoes?: string;
  analise_fatos?: string;
  turno?: string;
}

export interface PendingOccurrence extends Occurrence {
  status_validacao: string;
  data_envio_validacao: string;
  validado_por: string;
  data_validacao: string;
  observacao_validacao: string;
}

export type KeyStatus = 'Livre' | 'Disponível' | 'Retirada' | 'Inativa' | 'Manutenção' | 'Extraviada';

export interface KeyRecord {
  id_chave: string;
  codigo: string;
  descricao: string;
  setor: string;
  unidade: string;
  status: KeyStatus;
  observacoes: string;
  versao_registro: string;
  data_atualizacao: string;
  usuario_ultima_alteracao: string;
}

export interface KeyMovement {
  id_movimento: string;
  id_chave: string;
  codigo_chave: string;
  tipo_movimento: 'Retirada' | 'Devolução';
  retirante: string;
  matricula_documento: string;
  data_hora_retirada: string;
  data_hora_devolucao: string;
  observacoes: string;
  usuario_registro: string;
  versao_registro: string;
  data_atualizacao: string;
}

export interface AuditRecord {
  id_auditoria: string;
  data_hora: string;
  usuario: string;
  perfil: string;
  modulo: string;
  acao: string;
  id_registro: string;
  codigo_registro: string;
  detalhes: string;
}

export interface EnvironmentalInspection {
  id: string;
  data: string;
  realizar_monitoramento: 'Sim' | 'Não';
  motivo_nao_execucao: string;
  placa: string;
  transportadora: string;
  nota: string;
  laudo: 'Aprovado' | 'Reprovado' | '';
  observacao: string;
  responsavel: string;
  matricula_responsavel?: string;
  usuario_registro: string;
  data_hora_registro: string;
  data_hora_alteracao: string;
  alterado_por: string;
  unidade: string;
  supervisao: string;
}

export interface PhotoItem {
  id?: string;
  name: string;
  url: string;
  path?: string;
  size?: number;
  blob?: Blob;
  missing?: boolean;
}

export interface HistoryFilters {
  dateFrom: string;
  dateTo: string;
  nature: string;
  protocol: string;
  general: string;
}

export interface EnvironmentalFilters {
  dateFrom: string;
  dateTo: string;
  placa: string;
  transportadora: string;
  realizado: string;
  laudo: string;
  responsavel: string;
  unidade: string;
  supervisao: string;
  general: string;
}

export type PageName =
  | 'dashboard'
  | 'occ-register'
  | 'occ-history'
  | 'occ-validation'
  | 'ocorrencias'
  | 'inspecao-veicular'
  | 'hist-inspecoes'
  | 'chaves'
  | 'chaves-cautela'
  | 'chaves-cadastro'
  | 'relatorios'
  | 'usuarios'
  | 'auditoria'
  | 'configuracoes';
