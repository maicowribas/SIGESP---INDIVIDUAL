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

    async _parseCsvFileContent(file) {
      const rawText = await file.text();
      if (window.CryptoService && window.CryptoService.isEncryptedFile(rawText)) {
        const decrypted = await window.CryptoService.decrypt(rawText);
        return typeof parse === 'function'
          ? parse(decrypted)
          : (window.StorageService?.parseCsv ? window.StorageService.parseCsv(decrypted) : []);
      }
      return typeof parse === 'function'
        ? parse(rawText)
        : (window.StorageService?.parseCsv ? window.StorageService.parseCsv(rawText) : []);
    },

    /**
     * Importa múltiplos arquivos CSV em lote utilizando Promise.all com paralelismo controlado
     * e consolidação única em memória (O(N)), evitando leituras/gravações repetidas no disco (O(N²))
     * e eliminando travamentos da Main Thread.
     */
    async importCsvFilesBatch(files, onProgress = null) {
      if (typeof denyOperatorAccess === 'function' && denyOperatorAccess()) {
        return { importedFiles: [], totalRows: 0 };
      }
      if (typeof S !== 'undefined' && typeof hasProfile === 'function' && !hasProfile(S.user, 'Administrador')) {
        if (typeof S !== 'undefined') {
          S.accessDenied = true;
          if (typeof render === 'function') render();
        }
        throw new Error('Apenas Administradores podem importar arquivos para a base de dados.');
      }
      if (!window.StorageService) {
        throw new Error('StorageService indisponível.');
      }

      const fileArray = Array.from(files || []);
      if (!fileArray.length) {
        return { importedFiles: [], totalRows: 0 };
      }

      const occFiles = [];
      const otherFilesByTarget = new Map();

      for (const entry of fileArray) {
        const file = entry.file || entry;
        const rawName = String(entry.targetFileName || file.name || '').trim();
        const lower = rawName.toLowerCase();
        const isOcc = lower === 'ocorrencias.csv' || /^ocorrencias?.*\.csv$/i.test(lower) || lower.includes('ocorrencia');
        if (isOcc) {
          occFiles.push(file);
        } else {
          let targetName = rawName;
          if (lower.includes('fumaca') || lower.includes('inspecao') || lower.includes('ambiental')) {
            targetName = typeof ENVIRONMENTAL_FILE !== 'undefined' ? ENVIRONMENTAL_FILE : 'inspecao_fumaca_preta.csv';
          } else if (lower.includes('usuario')) {
            targetName = 'usuarios.csv';
          } else if (lower.includes('chave') && !lower.includes('moviment')) {
            targetName = 'chaves.csv';
          } else if (lower.includes('movimentacao') || lower.includes('movimento')) {
            targetName = 'movimentacao_chaves.csv';
          } else if (lower.includes('natureza')) {
            targetName = 'naturezas_ocorrencias.csv';
          } else if (lower.includes('supervis') && lower.includes('unidade')) {
            targetName = 'supervisoes_unidades.csv';
          }
          if (!otherFilesByTarget.has(targetName)) {
            otherFilesByTarget.set(targetName, []);
          }
          otherFilesByTarget.get(targetName).push(file);
        }
      }

      const importedFiles = [];
      let totalRows = 0;

      // 1. Processa todos os arquivos de ocorrências em paralelo (Promise.all) e grava em uma única operação em lote
      if (occFiles.length > 0) {
        const existingDisk = await window.StorageService.readEncryptedCsv('ocorrencias.csv').catch(() => []);
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

        const incomingRows = [];
        const batchSize = 64;
        for (let i = 0; i < occFiles.length; i += batchSize) {
          const slice = occFiles.slice(i, i + batchSize);
          const parsedSlice = await Promise.all(
            slice.map(f => this._parseCsvFileContent(f).catch(err => {
              console.warn(`[BackupService] Ignorando arquivo inválido ${f.name}:`, err);
              return [];
            }))
          );
          for (const rows of parsedSlice) {
            for (const r of rows) incomingRows.push(r);
          }
          if (typeof onProgress === 'function') {
            onProgress(Math.min(occFiles.length, i + slice.length), fileArray.length, 'ocorrencias.csv');
          }
          if (i + batchSize < occFiles.length) {
            await new Promise(r => setTimeout(r, 0));
          }
        }

        const normalizer = typeof normalizeOccurrenceRow === 'function'
          ? normalizeOccurrenceRow
          : (r) => r;
        const normalizedIncoming = incomingRows.map((r, idx) => normalizer(r, idx, existingDisk));

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
        await window.StorageService.writeEncryptedCsv('ocorrencias.csv', finalMerged, occHeaders);
        if (typeof CSVService !== 'undefined' && typeof CSVService.invalidateCache === 'function') {
          CSVService.invalidateCache('ocorrencias.csv');
        }
        importedFiles.push('ocorrencias.csv');
        totalRows += normalizedIncoming.length;
      }

      // 2. Processa os demais arquivos do sistema em paralelo com Promise.all
      const otherEntries = Array.from(otherFilesByTarget.entries());
      if (otherEntries.length > 0) {
        await Promise.all(otherEntries.map(async ([targetName, targetFiles]) => {
          const parsedLists = await Promise.all(targetFiles.map(f => this._parseCsvFileContent(f)));
          const combinedRows = parsedLists.flat();
          const spec = typeof HYBRID_CSVS !== 'undefined'
            ? HYBRID_CSVS.find(x => x[0] === targetName)
            : null;
          const headersToUse = spec?.[3]
            || (typeof H !== 'undefined' && H[targetName.replace('.csv', '')])
            || (combinedRows.length ? Object.keys(combinedRows[0]) : []);

          await window.StorageService.writeEncryptedCsv(targetName, combinedRows, headersToUse);
          if (typeof CSVService !== 'undefined' && typeof CSVService.invalidateCache === 'function') {
            CSVService.invalidateCache(targetName);
          }
          importedFiles.push(targetName);
          totalRows += combinedRows.length;
        }));
      }

      return { importedFiles, totalRows };
    },

    /**
     * Importa um arquivo CSV selecionado pelo usuário.
     * Se o arquivo for de ocorrências, normaliza cabeçalhos/sinônimos, garante campos obrigatórios
     * e realiza upsert/merge contra os registros já existentes no disco, sem sobrescrever dados.
     * Grava sempre com criptografia AES-GCM através de writeEncryptedCsv.
     */
    async importCsvData(file, targetFileName = null) {
      const res = await this.importCsvFilesBatch([{ file, targetFileName }]);
      const primaryFile = res.importedFiles[0] || targetFileName || file?.name || 'ocorrencias.csv';
      return { fileName: primaryFile, count: res.totalRows, importedCount: res.totalRows };
    }
  };
})();

if (typeof window !== 'undefined') {
  window.BackupService = BackupService;
}
