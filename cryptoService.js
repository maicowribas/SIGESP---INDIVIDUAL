/**
 * SIGESP — CryptoService
 * Módulo de Criptografia Autenticada AES-GCM de 256 bits nativo via Web Crypto API.
 * Sem dependências de bibliotecas externas, CDNs ou serviços remotos.
 * Padrão Corporativo SecDevOps: Chave AES-GCM de 256 bits derivada via PBKDF2 (HMAC-SHA-256)
 * com 100.000 iterações, Salt criptográfico de 128 bits e IV aleatório de 96 bits por gravação.
 */
'use strict';

const CryptoService = (() => {
  const ALGORITHM = 'AES-GCM';
  const KEY_LENGTH = 256;
  const KDF_ALGO = 'PBKDF2';
  const HASH_ALGO = 'SHA-256';
  const KDF_ITERATIONS = 100000;
  const SALT_LENGTH = 16; // 128 bits
  const IV_LENGTH = 12;   // 96 bits (AES-GCM standard nonce)
  const MAGIC_PREFIX = 'SIGESP_ENC_v1';

  // Segredo mestre do sistema para derivação corporativa estável e portável
  const SYSTEM_MASTER_SECRET = 'SIGESP_ENTERPRISE_SYSTEM_SECRET_KEY_v1_SECURE_2026';

  // Cache em memória de chaves derivadas por salt e envelopes já autenticados na sessão
  const _derivedKeyCache = new Map();
  const _decryptedEnvelopeCache = new Map();
  let _cachedBaseKey = null;

  /**
   * Converte Uint8Array / ArrayBuffer em string Base64
   */
  function bufferToBase64(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    let binary = '';
    const chunk = 8192;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  /**
   * Converte string Base64 para Uint8Array
   */
  function base64ToBuffer(base64) {
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  /**
   * Obtém a CryptoKey base PBKDF2 a partir do segredo mestre corporativo
   */
  async function getBaseMasterKey() {
    if (_cachedBaseKey) {
      return _cachedBaseKey;
    }
    const cryptoObj = typeof crypto !== 'undefined' ? crypto : (typeof globalThis !== 'undefined' ? globalThis.crypto : null);
    if (!cryptoObj || !cryptoObj.subtle) {
      throw new Error('Web Crypto API (crypto.subtle) indisponível neste ambiente.');
    }
    const enc = new TextEncoder();
    const secretBytes = enc.encode(SYSTEM_MASTER_SECRET);
    _cachedBaseKey = await cryptoObj.subtle.importKey(
      'raw',
      secretBytes,
      { name: KDF_ALGO },
      false,
      ['deriveKey', 'deriveBits']
    );
    return _cachedBaseKey;
  }

  /**
   * Deriva uma CryptoKey AES-GCM de 256 bits via PBKDF2 com o salt único do arquivo
   */
  async function deriveAesKey(saltBytes) {
    const saltB64 = bufferToBase64(saltBytes);
    if (_derivedKeyCache.has(saltB64)) {
      return _derivedKeyCache.get(saltB64);
    }

    const cryptoObj = typeof crypto !== 'undefined' ? crypto : (typeof globalThis !== 'undefined' ? globalThis.crypto : null);
    const baseKey = await getBaseMasterKey();

    const derivedKey = await cryptoObj.subtle.deriveKey(
      {
        name: KDF_ALGO,
        salt: saltBytes,
        iterations: KDF_ITERATIONS,
        hash: HASH_ALGO
      },
      baseKey,
      {
        name: ALGORITHM,
        length: KEY_LENGTH
      },
      false,
      ['encrypt', 'decrypt']
    );

    if (_derivedKeyCache.size >= 128) {
      const oldestKey = _derivedKeyCache.keys().next().value;
      if (oldestKey !== undefined) _derivedKeyCache.delete(oldestKey);
    }
    _derivedKeyCache.set(saltB64, derivedKey);
    return derivedKey;
  }

  let _sessionSalt = null;
  function getSessionSalt(cryptoObj) {
    if (!_sessionSalt) {
      _sessionSalt = new Uint8Array(SALT_LENGTH);
      cryptoObj.getRandomValues(_sessionSalt);
    }
    return _sessionSalt;
  }

  return {
    /**
     * Verifica se o conteúdo (string ou buffer) possui o envelope criptográfico SIGESP
     */
    isEncryptedFile(content) {
      if (!content) return false;
      const str = typeof content === 'string'
        ? content.trim()
        : new TextDecoder('utf-8', { fatal: false }).decode(content.subarray(0, 200)).trim();

      if (str.startsWith(MAGIC_PREFIX + ':')) return true;
      if (str.startsWith('{"magic":"' + MAGIC_PREFIX + '"')) return true;
      if (str.startsWith('{\n  "magic": "' + MAGIC_PREFIX + '"')) return true;
      return false;
    },

    /**
     * Criptografa texto plano com AES-GCM 256 bits autenticado.
     * Reutiliza a chave derivada de sessão (PBKDF2 100.000 iterações) e gera IV de 12 bytes exclusivamente aleatório por operação.
     */
    async encrypt(plainText, metadata = {}) {
      if (typeof plainText !== 'string') {
        plainText = String(plainText ?? '');
      }

      const cryptoObj = typeof crypto !== 'undefined' ? crypto : (typeof globalThis !== 'undefined' ? globalThis.crypto : null);
      if (!cryptoObj || !cryptoObj.subtle) {
        throw new Error('Web Crypto API não disponível para cifragem.');
      }

      // 1. Obtém salt criptográfico de 16 bytes (128 bits) com derivação PBKDF2 em cache O(1)
      const salt = getSessionSalt(cryptoObj);

      // 2. Deriva (ou recupera do cache em O(1)) a chave AES-GCM 256 bits
      const key = await deriveAesKey(salt);

      // 3. Gera IV único de 12 bytes (96 bits recomendados para AES-GCM) a cada gravação
      const iv = new Uint8Array(IV_LENGTH);
      cryptoObj.getRandomValues(iv);

      // 4. Codifica texto plano em UTF-8
      const encoded = new TextEncoder().encode(plainText);

      // 5. Criptografia autenticada com geração de tag MAC de 128 bits
      const cipherBuffer = await cryptoObj.subtle.encrypt(
        {
          name: ALGORITHM,
          iv: iv
        },
        key,
        encoded
      );

      // 6. Monta envelope estruturado em conformidade com as diretrizes do SIGESP
      const envelope = {
        magic: MAGIC_PREFIX,
        version: 1,
        algo: ALGORITHM,
        keyLength: KEY_LENGTH,
        kdf: `${KDF_ALGO}-${HASH_ALGO}`,
        iter: KDF_ITERATIONS,
        salt: bufferToBase64(salt),
        iv: bufferToBase64(iv),
        ct: bufferToBase64(cipherBuffer),
        ts: new Date().toISOString(),
        ...metadata
      };

      return `${MAGIC_PREFIX}:${JSON.stringify(envelope)}`;
    },

    /**
     * Descriptografa com validação de autenticidade e integridade AES-GCM.
     * Suporta envelopes individuais ou arquivos append-only com múltiplas linhas cifradas.
     */
    async decrypt(encryptedString) {
      if (!this.isEncryptedFile(encryptedString)) {
        throw new Error('Formato inválido: o arquivo não possui o envelope criptográfico SIGESP.');
      }

      const str = String(encryptedString || '').trim();
      const firstNewline = str.indexOf('\n');

      // Fast-path para envelope único (padrão oficial consolidado) sem alocar arrays de split
      if (firstNewline === -1) {
        return await this.decryptSingleEnvelope(str);
      }

      const lines = str.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

      // Se contém múltiplas linhas cifradas independentemente (Modo Append-Only)
      if (lines.length > 1 && lines.some(l => l.startsWith(MAGIC_PREFIX + ':'))) {
        const decryptedChunks = [];
        for (const line of lines) {
          if (line.startsWith(MAGIC_PREFIX + ':') || line.startsWith('{"magic":"' + MAGIC_PREFIX + '"')) {
            try {
              const dec = await this.decryptSingleEnvelope(line);
              decryptedChunks.push(dec.replace(/^\ufeff/, '').trim());
            } catch (lineErr) {
              console.warn('[CryptoService] Falha ao descriptografar linha append:', lineErr);
            }
          } else if (line.trim()) {
            // Linha legada ou cabeçalho texto plano
            decryptedChunks.push(line.replace(/^\ufeff/, '').trim());
          }
        }
        return '\ufeff' + decryptedChunks.filter(Boolean).join('\r\n');
      }

      return await this.decryptSingleEnvelope(str);
    },

    /**
     * Descriptografa um envelope individual AES-GCM
     */
    async decryptSingleEnvelope(singleEnvelopeStr) {
      const cacheKey = singleEnvelopeStr.trim();
      const canCacheEnvelope = cacheKey.length <= 16384;
      if (canCacheEnvelope && _decryptedEnvelopeCache.has(cacheKey)) {
        return _decryptedEnvelopeCache.get(cacheKey);
      }

      let jsonStr = cacheKey;
      if (jsonStr.startsWith(MAGIC_PREFIX + ':')) {
        jsonStr = jsonStr.slice(MAGIC_PREFIX.length + 1);
      }

      let envelope;
      try {
        envelope = JSON.parse(jsonStr);
      } catch {
        throw new Error('Falha ao interpretar contêiner criptográfico: JSON malformado.');
      }

      if (envelope.magic !== MAGIC_PREFIX) {
        throw new Error(`Assinatura mágica incompatível: ${envelope.magic}`);
      }

      const salt = base64ToBuffer(envelope.salt);
      const iv = base64ToBuffer(envelope.iv);
      const cipherBuffer = base64ToBuffer(envelope.ct);

      const key = await deriveAesKey(salt);
      const cryptoObj = typeof crypto !== 'undefined' ? crypto : (typeof globalThis !== 'undefined' ? globalThis.crypto : null);

      try {
        const decryptedBuffer = await cryptoObj.subtle.decrypt(
          {
            name: ALGORITHM,
            iv: iv
          },
          key,
          cipherBuffer
        );

        const decoded = new TextDecoder('utf-8').decode(decryptedBuffer);
        if (canCacheEnvelope) {
          if (_decryptedEnvelopeCache.size >= 48) {
            const oldest = _decryptedEnvelopeCache.keys().next().value;
            if (oldest !== undefined) _decryptedEnvelopeCache.delete(oldest);
          }
          _decryptedEnvelopeCache.set(cacheKey, decoded);
        }
        return decoded;
      } catch (cryptoErr) {
        const err = new Error('Falha de integridade criptográfica: dados adulterados ou chave inválida.');
        err.name = 'CryptoIntegrityError';
        err.cause = cryptoErr;
        throw err;
      }
    },

    /**
     * Retorna o status criptográfico auditável do cofre
     */
    async getStatus() {
      return {
        algorithm: 'AES-GCM-256',
        kdf: 'PBKDF2-HMAC-SHA256',
        iterations: KDF_ITERATIONS,
        saltBytes: SALT_LENGTH,
        ivBytes: IV_LENGTH,
        active: true,
        masterKeyReady: true
      };
    }
  };
})();

if (typeof window !== 'undefined') {
  window.CryptoService = CryptoService;
}
if (typeof globalThis !== 'undefined') {
  globalThis.CryptoService = CryptoService;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CryptoService;
}
