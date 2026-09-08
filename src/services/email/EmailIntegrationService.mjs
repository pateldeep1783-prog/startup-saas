import { TokenService } from './TokenService.mjs';
import { GmailProvider } from './GmailProvider.mjs';
import { GmailOAuthService } from './GmailOAuthService.mjs';

/**
 * EmailIntegrationService
 * Multi-tenant business logic service for managing business email connections,
 * OAuth flows, secure database persistence, token refresh, mailbox sync, and audit logging.
 */
export class EmailIntegrationService {
  /**
   * @param {Object} supabase - Supabase client instance (with service role key or authenticated context)
   * @param {Object} [options]
   */
  constructor(supabase, options = {}) {
    if (!supabase) {
      throw new Error('EmailIntegrationService requires a valid Supabase client instance.');
    }
    this.supabase = supabase;
    this.gmailProvider = options.gmailProvider || new GmailProvider();
    this.gmailOAuthService = options.gmailOAuthService || new GmailOAuthService();
  }

  /**
   * Helper to get provider instance by provider name.
   * @param {string} provider
   * @returns {EmailProvider}
   */
  getProvider(provider = 'gmail') {
    if (provider.toLowerCase() === 'gmail') {
      return this.gmailProvider;
    }
    throw new Error(`Unsupported email provider: ${provider}. Currently only 'gmail' is supported.`);
  }

  /**
   * Safe public status representation (Strictly NO tokens, secrets, or raw keys returned).
   * @param {string} organizationId
   * @param {string} [provider='gmail']
   * @returns {Promise<Object>} Safe status response
   */
  async getStatus(organizationId, provider = 'gmail') {
    if (!organizationId) {
      throw new Error('Organization ID is required.');
    }

    const { data: integration, error } = await this.supabase
      .from('email_integrations')
      .select('id, provider, provider_account_id, email_address, status, last_synced_at, token_expires_at, created_at, updated_at')
      .eq('organization_id', organizationId)
      .eq('provider', provider)
      .maybeSingle();

    if (error) {
      console.error('[EmailIntegrationService] Status fetch error:', error);
      throw new Error('Failed to fetch email integration status.');
    }

    if (!integration) {
      return {
        provider,
        status: 'disconnected',
        email_address: null,
        last_synced_at: null,
        message: 'No active email connection for this organization.',
      };
    }

    return {
      id: integration.id,
      provider: integration.provider,
      status: integration.status,
      email_address: integration.email_address,
      last_synced_at: integration.last_synced_at,
      created_at: integration.created_at,
      updated_at: integration.updated_at,
    };
  }

  /**
   * Generates authorization URL for Connect Gmail button.
   * @param {string} organizationId
   * @param {string} userId
   * @returns {Promise<{ authorization_url: string, state: string }>}
   */
  async initiateConnect(organizationId, userId) {
    if (!organizationId) {
      throw new Error('Organization ID is required to initiate connection.');
    }

    const state = this.gmailOAuthService.generateState(organizationId, userId);
    const authorization_url = this.gmailOAuthService.getAuthorizationUrl(state);

    await this.logAudit(organizationId, userId, 'gmail_connection_started', { provider: 'gmail' });

    return {
      authorization_url,
      state,
    };
  }

  /**
   * Handles OAuth callback from Google.
   * Validates state, exchanges authorization code, retrieves profile, encrypts tokens,
   * stores connection securely in DB under organization_id, and logs audit event.
   * @param {string} code
   * @param {string} state
   * @param {Object} [currentUserContext] - Optional session context for strict validation
   * @returns {Promise<Object>} Saved integration record (safe)
   */
  async handleCallback(code, state, currentUserContext = {}) {
    // 1. Validate State (CSRF protection)
    const validatedState = this.gmailOAuthService.validateState(state, currentUserContext);
    const organizationId = validatedState.organizationId;
    const actorId = currentUserContext.userId || validatedState.userId;

    try {
      // 2. Exchange code for tokens
      const tokenResult = await this.gmailOAuthService.exchangeCode(code);

      // 3. Fetch Gmail profile using newly acquired access token
      const profile = await this.gmailProvider.getProfile({
        accessToken: tokenResult.accessToken,
        refreshToken: tokenResult.refreshToken,
      });

      // 4. Encrypt OAuth tokens server-side
      const accessTokenEncrypted = TokenService.encrypt(tokenResult.accessToken);
      const refreshTokenEncrypted = tokenResult.refreshToken
        ? TokenService.encrypt(tokenResult.refreshToken)
        : null;

      // 5. Upsert integration record in database
      // If updating, preserve existing refresh token if Google didn't return a new one on re-auth
      let finalRefreshTokenEncrypted = refreshTokenEncrypted;
      if (!finalRefreshTokenEncrypted) {
        const { data: existing } = await this.supabase
          .from('email_integrations')
          .select('refresh_token_encrypted')
          .eq('organization_id', organizationId)
          .eq('provider', 'gmail')
          .maybeSingle();

        if (existing?.refresh_token_encrypted) {
          finalRefreshTokenEncrypted = existing.refresh_token_encrypted;
        }
      }

      const payload = {
        organization_id: organizationId,
        provider: 'gmail',
        provider_account_id: profile.providerAccountId,
        email_address: profile.emailAddress,
        access_token_encrypted: accessTokenEncrypted,
        refresh_token_encrypted: finalRefreshTokenEncrypted,
        token_expires_at: tokenResult.expiresAt.toISOString(),
        scopes: tokenResult.scopes,
        status: 'connected',
        last_synced_at: new Date().toISOString(),
      };

      const { data: saved, error } = await this.supabase
        .from('email_integrations')
        .upsert(payload, { onConflict: 'organization_id,provider' })
        .select('id, provider, email_address, status, last_synced_at, created_at, updated_at')
        .single();

      if (error) {
        console.error('[EmailIntegrationService] Database save error:', error);
        throw new Error('Failed to save email integration credentials to database.');
      }

      // 6. Log audit event
      await this.logAudit(organizationId, actorId, 'gmail_connected', {
        email_address: profile.emailAddress,
        provider_account_id: profile.providerAccountId,
      });

      return {
        organizationId,
        email_address: profile.emailAddress,
        status: 'connected',
        integration: saved,
      };
    } catch (err) {
      console.error('[EmailIntegrationService] Callback error:', err.message);
      await this.logAudit(organizationId, actorId, 'gmail_connection_failed', {
        error: err.message,
      });
      throw err;
    }
  }

  /**
   * Refreshes access token for an organization's integration if expired or near expiration.
   * @param {string} organizationId
   * @param {string} [provider='gmail']
   * @returns {Promise<string>} Plain text active access token (internal use only)
   */
  async getValidAccessToken(organizationId, provider = 'gmail') {
    const { data: integration, error } = await this.supabase
      .from('email_integrations')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('provider', provider)
      .single();

    if (error || !integration) {
      throw new Error(`No email integration found for organization ${organizationId}`);
    }

    if (integration.status === 'disconnected') {
      throw new Error('Email integration is disconnected.');
    }

    const providerImpl = this.getProvider(provider);
    const expiresAt = integration.token_expires_at ? new Date(integration.token_expires_at) : new Date(0);
    const isExpired = Date.now() >= (expiresAt.getTime() - 5 * 60 * 1000); // 5 minute buffer

    if (!isExpired && integration.access_token_encrypted) {
      return TokenService.decrypt(integration.access_token_encrypted);
    }

    // Token is expired, use refresh token
    if (!integration.refresh_token_encrypted) {
      await this.supabase
        .from('email_integrations')
        .update({ status: 'token_expired' })
        .eq('id', integration.id);

      await this.logAudit(organizationId, null, 'gmail_connection_failed', {
        reason: 'Refresh token missing',
      });

      throw new Error('Connection expired. Refresh token missing, please reconnect Gmail.');
    }

    try {
      const plainRefreshToken = TokenService.decrypt(integration.refresh_token_encrypted);
      const newTokens = await providerImpl.refreshToken(plainRefreshToken);

      const newAccessTokenEncrypted = TokenService.encrypt(newTokens.accessToken);
      
      await this.supabase
        .from('email_integrations')
        .update({
          access_token_encrypted: newAccessTokenEncrypted,
          token_expires_at: newTokens.expiresAt.toISOString(),
          status: 'connected',
        })
        .eq('id', integration.id);

      await this.logAudit(organizationId, null, 'gmail_token_refreshed', {
        provider,
      });

      return newTokens.accessToken;
    } catch (refreshErr) {
      console.error('[EmailIntegrationService] Token refresh failed:', refreshErr.message);

      await this.supabase
        .from('email_integrations')
        .update({ status: 'token_expired' })
        .eq('id', integration.id);

      await this.logAudit(organizationId, null, 'gmail_connection_failed', {
        error: refreshErr.message,
      });

      throw new Error('Gmail connection has expired. Please reconnect your account.');
    }
  }

  /**
   * Disconnects an email integration, revokes Google OAuth tokens, and clears database credentials.
   * @param {string} organizationId
   * @param {string} [actorId]
   * @param {string} [provider='gmail']
   * @returns {Promise<{ success: boolean }>}
   */
  async disconnect(organizationId, actorId = null, provider = 'gmail') {
    if (!organizationId) {
      throw new Error('Organization ID is required to disconnect integration.');
    }

    const { data: integration } = await this.supabase
      .from('email_integrations')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('provider', provider)
      .maybeSingle();

    if (!integration) {
      return { success: true, message: 'No active integration found.' };
    }

    // Try revoking Google token
    try {
      const accessToken = integration.access_token_encrypted
        ? TokenService.decrypt(integration.access_token_encrypted)
        : null;
      const refreshToken = integration.refresh_token_encrypted
        ? TokenService.decrypt(integration.refresh_token_encrypted)
        : null;

      const providerImpl = this.getProvider(provider);
      await providerImpl.revokeAccess({ accessToken, refreshToken });
    } catch (revokeErr) {
      console.warn('[EmailIntegrationService] Revoke warning during disconnect:', revokeErr.message);
    }

    // Delete or set to disconnected and clear credentials
    const { error: dbErr } = await this.supabase
      .from('email_integrations')
      .delete()
      .eq('id', integration.id);

    if (dbErr) {
      console.error('[EmailIntegrationService] Disconnect DB error:', dbErr);
      throw new Error('Failed to remove integration record.');
    }

    await this.logAudit(organizationId, actorId, 'gmail_disconnected', {
      email_address: integration.email_address,
      provider,
    });

    return { success: true };
  }

  /**
   * Manually syncs email metadata from mailbox and updates last_synced_at.
   * Foundation for receiving and reading business emails.
   * @param {string} organizationId
   * @param {string} [actorId]
   * @param {string} [provider='gmail']
   * @returns {Promise<Object>} Sync result summary
   */
  async syncMailbox(organizationId, actorId = null, provider = 'gmail') {
    if (!organizationId) {
      throw new Error('Organization ID is required to sync mailbox.');
    }

    const accessToken = await this.getValidAccessToken(organizationId, provider);
    const providerImpl = this.getProvider(provider);

    await this.logAudit(organizationId, actorId, 'gmail_sync_started', { provider });

    try {
      const profile = await providerImpl.getProfile({ accessToken });
      const messageList = await providerImpl.listMessages({ accessToken }, { maxResults: 10 });

      const now = new Date().toISOString();

      await this.supabase
        .from('email_integrations')
        .update({
          last_synced_at: now,
          status: 'connected',
        })
        .eq('organization_id', organizationId)
        .eq('provider', provider);

      return {
        success: true,
        emailAddress: profile.emailAddress,
        last_synced_at: now,
        messageCount: messageList.messages.length,
      };
    } catch (syncErr) {
      console.error('[EmailIntegrationService] Mailbox sync failed:', syncErr.message);

      await this.logAudit(organizationId, actorId, 'gmail_sync_failed', {
        error: syncErr.message,
      });

      throw new Error(`Sync failed: ${syncErr.message}`);
    }
  }

  /**
   * Logs an entry to email_integration_audit_logs table.
   * @param {string} organizationId
   * @param {string|null} actorId
   * @param {string} action
   * @param {Object} [metadata]
   */
  async logAudit(organizationId, actorId, action, metadata = {}) {
    if (!organizationId) return;
    try {
      // Ensure no tokens or secrets ever enter audit logs metadata
      const safeMetadata = { ...metadata };
      delete safeMetadata.access_token;
      delete safeMetadata.refresh_token;
      delete safeMetadata.access_token_encrypted;
      delete safeMetadata.refresh_token_encrypted;
      delete safeMetadata.code;

      await this.supabase
        .from('email_integration_audit_logs')
        .insert({
          organization_id: organizationId,
          actor_id: actorId || null,
          action,
          metadata: safeMetadata,
        });
    } catch (err) {
      console.error('[EmailIntegrationService] Audit logging failed:', err.message);
    }
  }
}
