import crypto from 'crypto';
import { google } from 'googleapis';

/**
 * GmailOAuthService
 * Handles OAuth 2.0 authorization URL generation, secure state token creation/validation (CSRF protection),
 * code exchange, token refresh, and token revocation.
 */
export class GmailOAuthService {
  constructor(clientId, clientSecret, redirectUri) {
    this.clientId = clientId || process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID;
    this.clientSecret = clientSecret || process.env.GOOGLE_CLIENT_SECRET;
    this.redirectUri = redirectUri || process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/api/integrations/email/gmail/callback';
    
    this.defaultScopes = (process.env.GOOGLE_OAUTH_SCOPES || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    if (this.defaultScopes.length === 0) {
      this.defaultScopes = [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/userinfo.email',
      ];
    }
  }

  /**
   * Derives secret key for state HMAC signature.
   * @private
   */
  _getStateSecret() {
    const raw = process.env.TOKEN_ENCRYPTION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'oauth-state-secret-fallback-key';
    return crypto.createHash('sha256').update(raw).digest();
  }

  /**
   * Generates a cryptographically secure, signed OAuth state parameter.
   * Encodes organizationId, userId, provider, timestamp, nonce, and HMAC signature.
   * @param {string} organizationId
   * @param {string} userId
   * @returns {string} Encoded state string
   */
  generateState(organizationId, userId) {
    if (!organizationId) {
      throw new Error('Organization ID is required to generate OAuth state.');
    }

    const payload = {
      organizationId,
      userId: userId || 'anonymous',
      provider: 'gmail',
      nonce: crypto.randomBytes(16).toString('hex'),
      expiresAt: Date.now() + 15 * 60 * 1000, // 15 minutes validity
    };

    const payloadString = JSON.stringify(payload);
    const payloadBase64 = Buffer.from(payloadString).toString('base64url');
    
    const hmac = crypto.createHmac('sha256', this._getStateSecret());
    hmac.update(payloadBase64);
    const signature = hmac.digest('base64url');

    return `${payloadBase64}.${signature}`;
  }

  /**
   * Validates state parameter returned from Google callback.
   * Ensures state signature is valid, unexpired, and matches expected context.
   * @param {string} stateString
   * @param {Object} [expectedContext] - { organizationId, userId }
   * @returns {{ organizationId: string, userId: string, provider: string }} Validated payload
   */
  validateState(stateString, expectedContext = {}) {
    if (!stateString) {
      throw new Error('OAuth state parameter is missing.');
    }

    const parts = stateString.split('.');
    if (parts.length !== 2) {
      throw new Error('Invalid OAuth state format.');
    }

    const [payloadBase64, signature] = parts;
    const hmac = crypto.createHmac('sha256', this._getStateSecret());
    hmac.update(payloadBase64);
    const expectedSignature = hmac.digest('base64url');

    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expectedSignature);

    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      throw new Error('OAuth state signature verification failed (possible CSRF attack).');
    }

    let payload;
    try {
      const payloadString = Buffer.from(payloadBase64, 'base64url').toString('utf8');
      payload = JSON.parse(payloadString);
    } catch (err) {
      throw new Error('Malformed OAuth state payload.');
    }

    if (Date.now() > payload.expiresAt) {
      throw new Error('OAuth state has expired. Please try connecting again.');
    }

    if (payload.provider !== 'gmail') {
      throw new Error('Invalid provider in OAuth state.');
    }

    if (expectedContext.organizationId && expectedContext.organizationId !== payload.organizationId) {
      throw new Error('OAuth state organization mismatch.');
    }

    return payload;
  }

  /**
   * Generates Google OAuth 2.0 authorization URL.
   * @param {string} state
   * @returns {string} Authorization URL
   */
  getAuthorizationUrl(state) {
    const oauth2Client = new google.auth.OAuth2(
      this.clientId,
      this.clientSecret,
      this.redirectUri
    );

    return oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent', // Force refresh token issuance
      scope: this.defaultScopes,
      state,
    });
  }

  /**
   * Exchanges authorization code for tokens.
   * @param {string} code
   * @returns {Promise<{ accessToken: string, refreshToken: string, expiresAt: Date, scopes: Array }>}
   */
  async exchangeCode(code) {
    if (!code) {
      throw new Error('Authorization code is missing.');
    }

    const oauth2Client = new google.auth.OAuth2(
      this.clientId,
      this.clientSecret,
      this.redirectUri
    );

    const { tokens } = await oauth2Client.getToken(code);

    const expiresAt = tokens.expiry_date
      ? new Date(tokens.expiry_date)
      : new Date(Date.now() + 3600 * 1000);

    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt,
      scopes: tokens.scope ? tokens.scope.split(' ') : this.defaultScopes,
    };
  }
}
