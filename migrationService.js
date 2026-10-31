/**
 * SIGESP — MigrationService
 * Serviço especializado em detecção e migração segura e transparente de arquivos
 * CSV em texto plano legado para o formato cifrado AES-GCM 256 bits.
 */
'use strict';

const MigrationService = (() => {
  const KNOWN_SIGESP_CSVS = [
    'usuarios.csv',
    'ocorrencias.csv',
    'ocorrencias_pendentes.csv',
    'chaves.csv',
    'movimentacao_chaves.csv',
    'supervisoes_unidades.csv',
    'naturezas_ocorrencias.csv',
    'inspecao_fumaca_preta.csv',
    'historico_sistema.csv',
    'supervisoes.csv',
    'unidades.csv'
  ];

  return {
    /**
     * Migra um arquivo individual de texto plano para AES-GCM 256 bits
     */
    async migratePlainCsvToEncrypted(fileName, plainText) {
      if (!window.CryptoService) {
        throw new Error('CryptoService não inicializado.');
      }
      if (!window.StorageService) {
        throw new Error('StorageService não inicializado.');
      }

      if (window.CryptoService.isEncryptedFile(plainText)) {
        return { status: 'already_encrypted', fileName };
      }

      console.info(`[MigrationService] Migrando "${fileName}" para formato criptografado AES-GCM...`);

      const encrypted = await window.CryptoService.encrypt(plainText, {
        migratedFrom: 'plain_csv',
        originalFileName: fileName
      });

      await window.StorageService.writeRawFile(fileName, encrypted);

      console.info(`[MigrationService] "${fileName}" migrado e persistido com sucesso.`);
      return { status: 'migrated', fileName, bytes: encrypted.length };
    },

    /**
     * Varre todos os arquivos do catálogo SIGESP e converte qualquer arquivo
     * em texto plano para o padrão criptográfico autenticado.
     */
    async migrateAllPlainCsvs(targetList = KNOWN_SIGESP_CSVS) {
      if (!window.StorageService) {
        throw new Error('StorageService não disponível para migração.');
      }

      const results = {
        migrated: [],
        alreadyEncrypted: [],
        skipped: [],
        errors: []
      };

      for (const fileName of targetList) {
        try {
          const raw = await window.StorageService.readRawFile(fileName).catch(err => {
            if (err?.name === 'NotFoundError' || err?.code === 'ARQUIVO_NAO_ENCONTRADO') {
              return null;
            }
            throw err;
          });

          if (raw === null || raw === undefined) {
            results.skipped.push(fileName);
            continue;
          }

          if (window.CryptoService.isEncryptedFile(raw)) {
            results.alreadyEncrypted.push(fileName);
            continue;
          }

          // Se for texto plano (mesmo vazio ou apenas cabeçalho), migra para formato protegido
          await this.migratePlainCsvToEncrypted(fileName, raw);
          results.migrated.push(fileName);
        } catch (err) {
          console.warn(`[MigrationService] Verificação de "${fileName}" adiada (não requer migração):`, err?.message || err);
          results.errors.push({ fileName, error: err.message || String(err) });
        }
      }

      return results;
    }
  };
})();

if (typeof window !== 'undefined') {
  window.MigrationService = MigrationService;
}
