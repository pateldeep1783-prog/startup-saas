import crypto from 'crypto';

/**
 * TokenService
 * Encrypts and decrypts sensitive OAuth tokens using AES-256-GCM.
 * Ensures zero plain text token exposure to frontend, logs, or databases.
 */
export class TokenService {
  /**
   * Derives a 32-byte key from environment secret or server key fallback.
   * @private
   * @returns {Buffer}
   */
  static _getKey() {
    const rawSecret = process.env.TOKEN_ENCRYPTION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'fallback-email-token-encryption-key-32bytes!';
    return crypto.createHash('sha256').update(rawSecret).digest();
  }

  /**
   * Encrypts plain text string using AES-256-GCM.
   * @param {string} plainText
   * @returns {string} Encrypted string payload (iv:tag:ciphertext)
   */
  static encrypt(plainText) {
    if (!plainText) return null;
    try {
      const iv = crypto.randomBytes(12);
      const key = this._getKey();
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      
      let encrypted = cipher.update(plainText, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      const authTag = cipher.getAuthTag().toString('hex');
      return `${iv.toString('hex')}:${authTag}:${encrypted}`;
    } catch (err) {
      console.error('[TokenService] Encryption error');
      throw new Error('Failed to encrypt credential securely.');
    }
  }

  /**
   * Decrypts encrypted token payload back to plain text.
   * @param {string} encryptedPayload
   * @returns {string} Decrypted plain text token
   */
  static decrypt(encryptedPayload) {
    if (!encryptedPayload) return null;
    try {
      const parts = encryptedPayload.split(':');
      if (parts.length !== 3) {
        throw new Error('Invalid token cipher format');
      }
      
      const [ivHex, authTagHex, encryptedHex] = parts;
      const key = this._getKey();
      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(authTagHex, 'hex');
      
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);
      
      let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (err) {
      console.error('[TokenService] Decryption error');
      throw new Error('Failed to decrypt credential securely.');
    }
  }
}
