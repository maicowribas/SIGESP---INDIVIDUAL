import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import { Occurrence, PhotoItem } from '../types';

function pdfSafe(value: unknown, fallback = 'Não informado'): string {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function pdfDateTime(value?: string): string {
  if (!value) return 'Não informado';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? pdfSafe(value) : date.toLocaleString('pt-BR');
}

export function pdfFileName(protocol: string): string {
  return `OCORRENCIA_${String(protocol || 'SEM_PROTOCOLO').replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;
}

function formatPdfResponsible(occurrence: any): string {
  if (!occurrence) return 'Não informado';
  let resp = String(occurrence.responsavel || occurrence.responsavel_registro || '').trim();
  if (!resp) return 'Não informado';
  let mat = String(occurrence.matricula_responsavel || '').trim();
  if (/^[uU][0-9iI]+$/.test(mat)) {
    mat = '';
  }
  resp = resp.replace(/\s*\([uU][0-9iI]+\)/g, '').trim();
  if (mat && !resp.includes(`(${mat})`)) {
    return `${resp} (${mat})`;
  }
  return resp || 'Não informado';
}

export interface ProgressCallback {
  (progress: number, message: string): void;
}

export async function generateOccurrencePdfDocument(
  occurrence: Occurrence,
  photosList: PhotoItem[] = [],
  onProgress?: ProgressCallback
): Promise<string> {
  onProgress?.(10, 'Validando dados e rastreabilidade...');

  // Prepare photos
  const photoImages: { data: string; width: number; height: number; path: string }[] = [];
  const validPhotos = photosList.filter((p) => p.url && !p.missing);

  for (let i = 0; i < validPhotos.length; i++) {
    onProgress?.(
      15 + Math.round((i / Math.max(1, validPhotos.length)) * 30),
      `Processando evidência fotográfica ${i + 1} de ${validPhotos.length}...`
    );
    try {
      const response = await fetch(validPhotos[i].url);
      const blob = await response.blob();
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      const maxDim = 1500;
      const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close();
        photoImages.push({
          data: canvas.toDataURL('image/jpeg', 0.85),
          width: canvas.width,
          height: canvas.height,
          path: validPhotos[i].path || validPhotos[i].name,
        });
      }
    } catch (e) {
      console.warn('Erro ao carregar foto para PDF', e);
    }
  }

  onProgress?.(55, 'Montando o documento executivo...');

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  const pageW = 210;
  const margin = 16;
  const contentW = 178;
  const footerY = 286;
  const issued = new Date();
  const issuedText = issued.toLocaleString('pt-BR');

  let y = 18;
  const blue: [number, number, number] = [11, 55, 92];
  const gray: [number, number, number] = [79, 93, 110];
  const lightGray: [number, number, number] = [244, 247, 250];

  const ensure = (need = 16) => {
    if (y + need > footerY - 8) {
      doc.addPage();
      y = 18;
      return true;
    }
    return false;
  };

  const text = (
    value: unknown,
    x: number,
    width: number,
    size = 9,
    color: [number, number, number] = gray,
    style: 'normal' | 'bold' = 'normal'
  ) => {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(pdfSafe(value, ''), width);
    ensure(lines.length * (size * 0.38) + 4);
    doc.text(lines, x, y);
    y += lines.length * (size * 0.38) + 2;
  };

  const section = (title: string) => {
    ensure(14);
    doc.setFillColor(...blue);
    doc.roundedRect(margin, y, contentW, 9, 2, 2, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(title.toUpperCase(), margin + 4, y + 6);
    y += 13;
  };

  const fieldGrid = (items: [string, unknown][], cols = 2) => {
    const gap = 4;
    const cellW = (contentW - gap * (cols - 1)) / cols;
    for (let i = 0; i < items.length; i += cols) {
      const row = items.slice(i, i + cols);
      const heights = row.map(([, value]) => {
        doc.setFontSize(9);
        return doc.splitTextToSize(pdfSafe(value), cellW - 8).length * 4 + 12;
      });
      const h = Math.max(22, ...heights);
      ensure(h + 3);
      row.forEach(([label, value], idx) => {
        const x = margin + idx * (cellW + gap);
        doc.setFillColor(...lightGray);
        doc.setDrawColor(219, 227, 236);
        doc.roundedRect(x, y, cellW, h, 2, 2, 'FD');
        doc.setTextColor(...gray);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.text(label.toUpperCase(), x + 4, y + 5);
        doc.setTextColor(20, 36, 58);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.text(doc.splitTextToSize(pdfSafe(value), cellW - 8), x + 4, y + 11);
      });
      y += h + 3;
    }
  };

  const longBlock = (title: string, value: unknown) => {
    section(title);
    ensure(20);
    const lines = doc.splitTextToSize(pdfSafe(value), contentW - 10);
    let index = 0;
    while (index < lines.length) {
      const available = Math.max(1, Math.floor((footerY - y - 14) / 4));
      if (available < 3) {
        doc.addPage();
        y = 18;
        section(`${title} - Continuação`);
        continue;
      }
      const chunk = lines.slice(index, index + available);
      const h = chunk.length * 4 + 10;
      doc.setFillColor(250, 251, 253);
      doc.setDrawColor(220, 227, 235);
      doc.roundedRect(margin, y, contentW, h, 2, 2, 'FD');
      doc.setTextColor(35, 48, 65);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.2);
      doc.text(chunk, margin + 5, y + 7);
      y += h + 4;
      index += chunk.length;
    }
  };

  // Header Banner
  doc.setFillColor(...blue);
  doc.rect(0, 0, pageW, 34, 'F');
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(margin, 7, 18, 18, 4, 4, 'F');
  doc.setTextColor(...blue);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text('SP', margin + 4.4, 18.5);

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(15);
  doc.text('SIGESP', margin + 24, 13);
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.text('Sistema Integrado de Gestão da Segurança Patrimonial', margin + 24, 18);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('RELATÓRIO DE OCORRÊNCIA', margin + 24, 25);
  y = 42;

  // Sections
  section('Identificação da ocorrência');
  fieldGrid([
    ['Protocolo', occurrence.numero_protocolo],
    ['Status', occurrence.status],
    ['Data', occurrence.data_ocorrencia],
    ['Hora', occurrence.hora_ocorrencia],
    ['Unidade', occurrence.unidade],
    ['Local específico', occurrence.local_especifico],
    ['Natureza', occurrence.natureza_ocorrencia],
    ['Responsável pelo registro', formatPdfResponsible(occurrence)],
  ]);

  section('Dados da ocorrência');
  fieldGrid([
    ['Classificação / Prioridade', occurrence.prioridade],
    ['Categoria / Natureza', occurrence.natureza_ocorrencia],
    ['Envolvido', occurrence.nome_envolvido],
    ['Empresa', occurrence.empresa_envolvido],
    ['Área', occurrence.area],
    ['Turno', occurrence.turno || 'Não informado'],
    ['Matrícula / ID', occurrence.matricula_id],
    ['Documento / Placa', `${pdfSafe(occurrence.documento, '-')} / ${pdfSafe(occurrence.placa_veiculo, '-')}`],
  ]);

  longBlock('Relato completo', occurrence.relato_detalhado);
  longBlock('Análise dos fatos', occurrence.analise_fatos || occurrence.relato_detalhado);
  longBlock('Providências adotadas', occurrence.providencias_adotadas);
  if (occurrence.observacoes) {
    longBlock('Observações', occurrence.observacoes);
  }

  section('Rastreabilidade');
  fieldGrid([
    ['Data do registro', pdfDateTime(occurrence.data_registro)],
    ['Última atualização', pdfDateTime(occurrence.data_registro)],
    ['Usuário criador', occurrence.responsavel_registro],
    ['Última alteração', occurrence.usuario_ultima_alteracao],
    ['Data da exportação', issuedText],
    ['Versão do registro', occurrence.versao_registro || '1'],
  ]);

  // QR Code
  try {
    const qrData = `SIGESP-VAL:${occurrence.numero_protocolo}|${occurrence.unidade}|${occurrence.data_ocorrencia}|${occurrence.responsavel_registro}`;
    const qrUrl = await QRCode.toDataURL(qrData, {
      width: 140,
      margin: 1,
      color: { dark: '#0b2440', light: '#ffffff' },
    });
    ensure(36);
    doc.setFillColor(250, 251, 253);
    doc.setDrawColor(219, 227, 236);
    doc.roundedRect(margin, y, contentW, 32, 2, 2, 'FD');
    doc.addImage(qrUrl, 'PNG', margin + 4, y + 3, 26, 26);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(11, 55, 92);
    doc.text('VALIDAÇÃO E RASTREABILIDADE DIGITAL', margin + 35, y + 9);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...gray);
    doc.text(`Protocolo oficial: ${occurrence.numero_protocolo}`, margin + 35, y + 15);
    doc.text(`Emitido em: ${issuedText} pelo SIGESP`, margin + 35, y + 20);
    doc.text('Aponte a câmera para verificar a autenticidade deste documento corporativo.', margin + 35, y + 25);
    y += 36;
  } catch (err) {
    console.warn('Erro ao gerar QRCode', err);
  }

  // Documents if any
  const paths = String(occurrence.anexos_referencias || '').split('|').filter(Boolean);
  const documentPaths = paths.filter((p) => !/\.(jpe?g|png|webp)$/i.test(p));
  if (documentPaths.length) {
    section('Documentos anexados');
    documentPaths.forEach((path, idx) => {
      text(`${idx + 1}. ${path}`, margin + 3, contentW - 6, 8.5);
    });
  }

  // Photos
  if (photoImages.length) {
    section('Anexos fotográficos');
    for (let i = 0; i < photoImages.length; i += 2) {
      const row = photoImages.slice(i, i + 2);
      const cellW = (contentW - 6) / 2;
      const maxImageH = 58;
      const captionH = 10;
      const rowH = maxImageH + captionH + 6;
      ensure(rowH);
      row.forEach((photo, j) => {
        const x = margin + j * (cellW + 6);
        const ratio = photo.width / photo.height;
        let w = cellW - 4;
        let h = w / ratio;
        if (h > maxImageH) {
          h = maxImageH;
          w = h * ratio;
        }
        const ix = x + (cellW - w) / 2;
        const iy = y + (maxImageH - h) / 2;
        doc.setDrawColor(210, 219, 230);
        doc.roundedRect(x, y, cellW, rowH - 2, 2, 2, 'S');
        doc.addImage(photo.data, 'JPEG', ix, iy, w, h, undefined, 'FAST');
        doc.setTextColor(...gray);
        doc.setFontSize(8);
        doc.text(`Foto ${i + j + 1} - Evidência da Ocorrência`, x + cellW / 2, y + maxImageH + 6, {
          align: 'center',
        });
      });
      y += rowH;
    }
  }

  // Footers
  onProgress?.(85, 'Aplicando rodapé, paginação e acabamento...');
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setDrawColor(190, 201, 214);
    doc.line(margin, 281, pageW - margin, 281);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...gray);
    doc.text('SIGESP - Sistema Integrado de Gestão da Segurança Patrimonial', margin, 286);
    doc.text(`Data de Emissão: ${issuedText}`, pageW / 2, 286, { align: 'center' });
    doc.text(`Página ${page} de ${pages}`, pageW - margin, 286, { align: 'right' });
  }

  onProgress?.(96, 'Finalizando download...');
  const fileName = pdfFileName(occurrence.numero_protocolo);
  doc.save(fileName);
  onProgress?.(100, 'Relatório concluído.');
  return fileName;
}
