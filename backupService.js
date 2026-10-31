/**
 * SIGESP — BackupService
 * Serviço de exportação segura (backup descriptografado) e importação
 * controlada com re-criptografia e validação de permissões RBAC.
 */
'use strict';

const BackupService = (() => {
  function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  return {
    /**
     * Exporta um arquivo individual do sistema em formato CSV padrão legível,
     * realizando a descriptografia sob demanda após verificar o perfil do usuário.
     */
    async exportDecryptedCsvBackup(fileName) {
      if (typeof denyOperatorAccess === 'function' && denyOperatorAccess()) {
        return;
      }
      if (typeof rights === 'function' && !rights().export) {
        throw new Error('Acesso negado: seu perfil não possui autorização para exportar dados.');
      }

      if (!window.StorageService) {
        throw new Error('StorageService indisponível.');
      }

      // Lê via camada centralizada que descriptografa com AES-GCM
      const rows = await window.StorageService.readEncryptedCsv(fileName);
      const spec = typeof HYBRID_CSVS !== 'undefined'
        ? HYBRID_CSVS.find(x => x[0] === fileName)
        : null;
      const headers = spec?.[3] || (rows.length ? Object.keys(rows[0]) : []);

      const plainText = typeof csv === 'function'
        ? csv(rows, headers)
        : '\ufeff' + (headers.join(';') + '\r\n' + rows.map(r => headers.map(h => r[h] ?? '').join(';')).join('\r\n'));

      const blob = new Blob([plainText], { type: 'text/csv; charset=utf-8' });
      downloadBlob(blob, fileName);
      return { success: true, fileName, count: rows.length };
    },

    /**
     * Exporta todos os arquivos CSV cadastrados como backups descriptografados
     */
    async exportAllDecryptedBackups(catalogList = null) {
      if (typeof denyOperatorAccess === 'function' && denyOperatorAccess()) {
        return;
      }
      if (typeof rights === 'function' && !rights().export) {
        throw new Error('Acesso negado: seu perfil não possui autorização para exportar dados.');
      }

      const list = catalogList || (typeof HYBRID_CSVS !== 'undefined' ? HYBRID_CSVS.map(x => x[0]) : []);

      if (typeof showLoading === 'function') {
        showLoading('Exportando backup seguro dos arquivos CSV...', {
          kicker: 'Backup de Dados',
          title: 'Exportando arquivos descriptografados...',
          progress: 10,
          overlayId: 'pdfProgressOverlay'
        });
      }

      try {
        for (let i = 0; i < list.length; i++) {
          const fileName = list[i];
          if (typeof updateLoadingProgress === 'function') {
            updateLoadingProgress(10 + Math.round(((i + 1) / list.length) * 80), `Exportando ${fileName}...`);
          }
          await this.exportDecryptedCsvBackup(fileName);
          await new Promise(r => setTimeout(r, 200));
        }
        if (typeof hideLoading === 'function') hideLoading();
        if (typeof S !== 'undefined') {
          S.message = 'Backup de todos os arquivos CSV concluído com sucesso.';
          if (typeof render === 'function') render();
        }
      } catch (err) {
        if (typeof hideLoading === 'function') hideLoading();
        throw err;
      }
    },

    /**
     * Importa um arquivo CSV selecionado pelo usuário.
     * Se o arquivo for de ocorrências, normaliza cabeçalhos/sinônimos, garante campos obrigatórios
     * e realiza upsert/merge contra os registros já existentes no disco, sem sobrescrever dados.
     * Grava sempre com criptografia AES-GCM através de writeEncryptedCsv.
     */
    async importCsvData(file, targetFileName = null) {
      if (typeof denyOperatorAccess === 'function' && denyOperatorAccess()) {
        return;
      }
      if (typeof S !== 'undefined' && typeof hasProfile === 'function' && !hasProfile(S.user, 'Administrador')) {
        if (typeof S !== 'undefined') {
          S.accessDenied = true;
          if (typeof render === 'function') render();
        }
        throw new Error('Apenas Administradores podem importar arquivos para a base de dados.');
      }

      let fileName = (targetFileName || file.name || '').trim();
      const lowerName = fileName.toLowerCase();
      const isOccFile = lowerName === 'ocorrencias.csv' || /^ocorrencias?.*\.csv$/i.test(lowerName);
      if (isOccFile) {
        fileName = 'ocorrencias.csv';
      }

      const rawText = await file.text();

      if (!window.StorageService) {
        throw new Error('StorageService indisponível.');
      }

      let rowsToPersist = [];
      let headersToUse = null;

      if (window.CryptoService && window.CryptoService.isEncryptedFile(rawText)) {
        // Testa a integridade descriptografando o contêiner
        const decrypted = await window.CryptoService.decrypt(rawText);
        rowsToPersist = typeof parse === 'function' ? parse(decrypted) : (window.StorageService.parseCsv ? window.StorageService.parseCsv(decrypted) : []);
      } else {
        // Valida texto plano com suporte a qualquer delimitador
        rowsToPersist = typeof parse === 'function' ? parse(rawText) : (window.StorageService.parseCsv ? window.StorageService.parseCsv(rawText) : []);
      }

      if (isOccFile) {
        // Obter ocorrências existentes no disco
        let existingDisk = [];
        try {
          existingDisk = await window.StorageService.readEncryptedCsv('ocorrencias.csv');
        } catch {
          existingDisk = [];
        }

        const occHeaders = (typeof H !== 'undefined' && H.occ) || [
          'id_ocorrencia', 'id_interno', 'numero_protocolo', 'data_ocorrencia', 'hora_ocorrencia',
          'gerencia', 'supervisao', 'unidade', 'area', 'local_especifico', 'natureza_ocorrencia',
          'tipo_vinculo', 'nome_envolvido', 'empresa_envolvido', 'matricula_id', 'telefone',
          'documento', 'placa_veiculo', 'gerencia_envolvido', 'gerencia_geral', 'diretoria',
          'relato_detalhado', 'providencias_adotadas', 'prioridade', 'status', 'anexos_referencias',
          'responsavel_registro', 'perfil_registro', 'data_registro', 'versao_registro',
          'usuario_ultima_alteracao', 'status_validacao', 'data_envio_validacao', 'validado_por',
          'data_validacao', 'observacao_validacao'
        ];
        headersToUse = occHeaders;

        // Normalizar todas as linhas importadas
        const normalizer = typeof normalizeOccurrenceRow === 'function'
          ? normalizeOccurrenceRow
          : (r) => r;

        const normalizedIncoming = rowsToPersist.map((r, idx) => normalizer(r, idx, existingDisk));

        // Realizar Upsert / Merge por protocolo ou ID
        const mergedMap = new Map();
        for (const item of existingDisk) {
          const key = String(item.numero_protocolo || item.id_ocorrencia || item.id_interno || '').trim().toUpperCase();
          if (key) mergedMap.set(key, item);
        }
        for (const item of normalizedIncoming) {
          const key = String(item.numero_protocolo || item.id_ocorrencia || item.id_interno || '').trim().toUpperCase();
          if (key) {
            mergedMap.set(key, item);
          } else {
            mergedMap.set(`ITEM_${mergedMap.size + 1}`, item);
          }
        }

        const finalMerged = Array.from(mergedMap.values());
        await window.StorageService.writeEncryptedCsv('ocorrencias.csv', finalMerged, headersToUse);

        if (typeof CSVService !== 'undefined' && typeof CSVService.invalidateCache === 'function') {
          CSVService.invalidateCache('ocorrencias.csv');
        }

        return { fileName: 'ocorrencias.csv', count: finalMerged.length, importedCount: rowsToPersist.length };
      }

      const spec = typeof HYBRID_CSVS !== 'undefined'
        ? HYBRID_CSVS.find(x => x[0] === fileName)
        : null;
      headersToUse = spec?.[3] || (typeof H !== 'undefined' && H[fileName.replace('.csv', '')]) || (rowsToPersist.length ? Object.keys(rowsToPersist[0]) : []);

      // Grava sempre com criptografia AES-GCM através do storageService
      await window.StorageService.writeEncryptedCsv(fileName, rowsToPersist, headersToUse);

      if (typeof CSVService !== 'undefined' && typeof CSVService.invalidateCache === 'function') {
        CSVService.invalidateCache(fileName);
      }

      return { fileName, count: rowsToPersist.length };
    }
  };
})();

if (typeof window !== 'undefined') {
  window.BackupService = BackupService;
}
