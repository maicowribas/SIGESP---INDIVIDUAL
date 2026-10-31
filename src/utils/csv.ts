import { Profile } from '../types';

export const PROFILE_ALIASES: Record<string, Profile> = {
  administrador: 'Administrador',
  supervisor: 'Supervisor',
  lider: 'Líder',
  operador: 'Operador',
  consulta: 'Consulta',
};

export function normalizePerfil(value?: string): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

export function canonicalPerfil(value?: string): Profile {
  const key = normalizePerfil(value);
  return PROFILE_ALIASES[key] || (String(value ?? '').trim() as Profile);
}

export function normalizedMasterName(value?: string): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function activeMaster(record?: { ativo?: string }): boolean {
  return record?.ativo !== '0' && String(record?.ativo || '1').toUpperCase() !== 'INATIVO';
}

export function aliasesOf(record?: { aliases?: string }): string[] {
  try {
    const values = JSON.parse(record?.aliases || '[]');
    return Array.isArray(values) ? values.map(String) : [];
  } catch {
    return [];
  }
}

export function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function ce(v: unknown): string {
  let s = String(v ?? '');
  if (['=', '+', '-', '@'].includes(s[0])) s = "'" + s;
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csv(rows: Record<string, unknown>[], headers: string[]): string {
  return (
    '\ufeff' +
    [
      headers.join(';'),
      ...rows.map((r) => headers.map((k) => ce(r[k])).join(';')),
    ].join('\r\n')
  );
}

export function detectDelimiter(text: string): string {
  const s = String(text ?? '').replace(/^\ufeff/, '').trim();
  if (!s) return ';';
  const firstLine = s.split(/\r?\n/)[0] || '';
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

export function parseWithQuoteSupport(t: string): Record<string, string>[] {
  const s = String(t ?? '').replace(/^\ufeff/, '');
  const delimiter = detectDelimiter(s);
  const o: string[][] = [];
  let r: string[] = [];
  let c = '';
  let q = false;

  for (let i = 0; i < s.length; i++) {
    const x = s[i];
    const n = s[i + 1];
    if (q) {
      if (x === '"' && n === '"') {
        c += '"';
        i++;
      } else if (x === '"') {
        q = false;
      } else {
        c += x;
      }
    } else if (x === '"') {
      q = true;
    } else if (x === delimiter) {
      r.push(c);
      c = '';
    } else if (x === '\n') {
      r.push(c.endsWith('\r') ? c.slice(0, -1) : c);
      o.push(r);
      r = [];
      c = '';
    } else {
      c += x;
    }
  }
  if (q) throw Error('CSV inválido.');
  if (c || r.length) {
    r.push(c.endsWith('\r') ? c.slice(0, -1) : c);
    o.push(r);
  }
  const filtered = o.filter((row) => row.some((x) => x !== ''));
  const rawHeaders = filtered.shift() || [];
  const h = rawHeaders.map(col => String(col || '').replace(/^["'\s]+|["'\s]+$/g, '').trim());
  const isLegacy = h.some(col => ['arma_envolvida', 'camera_relacionada', 'operador_responsavel'].includes(col.toLowerCase()));
  const CANONICAL_OCC_HEADERS = [
    'id_ocorrencia', 'id_interno', 'numero_protocolo', 'data_ocorrencia', 'hora_ocorrencia', 'gerencia', 'supervisao', 'unidade', 'area', 'local_especifico', 'natureza_ocorrencia', 'tipo_vinculo', 'nome_envolvido', 'empresa_envolvido', 'matricula_id', 'telefone', 'documento', 'placa_veiculo', 'gerencia_envolvido', 'gerencia_geral', 'diretoria', 'relato_detalhado', 'providencias_adotadas', 'prioridade', 'status', 'anexos_referencias', 'responsavel_registro', 'perfil_registro', 'data_registro', 'versao_registro', 'usuario_ultima_alteracao', 'status_validacao', 'data_envio_validacao', 'validado_por', 'data_validacao', 'observacao_validacao'
  ];

  return filtered.map((row) => {
    if (isLegacy) {
      const col23 = String(row[23] ?? '').trim().toLowerCase();
      const col24 = String(row[24] ?? '').trim().toLowerCase();
      const isCanonicalRow = ['baixa', 'média', 'media', 'alta', 'crítica', 'critica'].includes(col23) ||
        ['validada', 'pendente', 'rascunho', 'registrada', 'em apuração', 'encerrada', 'pendente de validação'].includes(col24) ||
        String(row[21] ?? '').length >= 15;
      if (isCanonicalRow) {
        return Object.fromEntries(CANONICAL_OCC_HEADERS.map((k, i) => [k, row[i] ?? '']));
      }
    }
    return Object.fromEntries(h.map((x, i) => [x, row[i] ?? '']));
  });
}

export function parseCsv(t: string): Record<string, string>[] {
  const s = String(t ?? '').replace(/^\ufeff/, '');
  if (s.includes('"')) return parseWithQuoteSupport(s);
  const delimiter = detectDelimiter(s);
  const rows: string[][] = [];
  for (const line of s.split(/\r?\n/)) {
    if (!line) continue;
    const row = line.split(delimiter);
    if (row.some((value) => value !== '')) rows.push(row);
  }
  const rawHeaders = rows.shift() || [];
  const headers = rawHeaders.map(col => String(col || '').replace(/^["'\s]+|["'\s]+$/g, '').trim());
  const isLegacy = headers.some(col => ['arma_envolvida', 'camera_relacionada', 'operador_responsavel'].includes(col.toLowerCase()));
  const CANONICAL_OCC_HEADERS = [
    'id_ocorrencia', 'id_interno', 'numero_protocolo', 'data_ocorrencia', 'hora_ocorrencia', 'gerencia', 'supervisao', 'unidade', 'area', 'local_especifico', 'natureza_ocorrencia', 'tipo_vinculo', 'nome_envolvido', 'empresa_envolvido', 'matricula_id', 'telefone', 'documento', 'placa_veiculo', 'gerencia_envolvido', 'gerencia_geral', 'diretoria', 'relato_detalhado', 'providencias_adotadas', 'prioridade', 'status', 'anexos_referencias', 'responsavel_registro', 'perfil_registro', 'data_registro', 'versao_registro', 'usuario_ultima_alteracao', 'status_validacao', 'data_envio_validacao', 'validado_por', 'data_validacao', 'observacao_validacao'
  ];

  return rows.map((row) => {
    if (isLegacy) {
      const col23 = String(row[23] ?? '').trim().toLowerCase();
      const col24 = String(row[24] ?? '').trim().toLowerCase();
      const isCanonicalRow = ['baixa', 'média', 'media', 'alta', 'crítica', 'critica'].includes(col23) ||
        ['validada', 'pendente', 'rascunho', 'registrada', 'em apuração', 'encerrada', 'pendente de validação'].includes(col24) ||
        String(row[21] ?? '').length >= 15;
      if (isCanonicalRow) {
        return Object.fromEntries(CANONICAL_OCC_HEADERS.map((k, i) => [k, row[i] ?? '']));
      }
    }
    return Object.fromEntries(headers.map((name, index) => [name, row[index] ?? '']));
  });
}

export async function hash(v: string): Promise<string> {
  const b = new TextEncoder().encode(v);
  const h = await crypto.subtle.digest('SHA-256', b);
  return [...new Uint8Array(h)]
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
}

export function uid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export function nextOccurrenceProtocol(
  official: { numero_protocolo?: string }[],
  pending: { numero_protocolo?: string }[]
): string {
  const all = [...official, ...pending];
  const maxSeq = Math.max(
    0,
    ...all.map((x) => +String(x.numero_protocolo || '').split('-').pop()! || 0)
  );
  const nextSeq = maxSeq + 1;
  const year = new Date().getFullYear();
  return `OC-${year}-${String(nextSeq).padStart(6, '0')}`;
}

export async function compressImage(
  file: File,
  maxWidth = 1280,
  quality = 0.72
): Promise<{ blob: Blob; url: string; name: string; size: number }> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error(`Formato inválido: ${file.name}`);
  }
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxWidth / bitmap.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Não foi possível inicializar canvas');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Falha na compressão'))),
      'image/jpeg',
      quality
    );
  });

  return {
    blob,
    url: URL.createObjectURL(blob),
    name: file.name,
    size: blob.size,
  };
}
