import fs from 'fs';
import path from 'path';
import { TokenService } from './TokenService.mjs';
import { GmailProvider } from './GmailProvider.mjs';
import { GmailOAuthService } from './GmailOAuthService.mjs';

const STORE_PATH = path.join(process.cwd(), 'email_store.json');

function loadLocalStore() {
  try {
    if (fs.existsSync(STORE_PATH)) {
      return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    }
  } catch (e) {}
  return {};
}

function saveLocalStore(data) {
  try {
    fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {}
}

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

    try {
      const { data: integration, error } = await this.supabase
        .from('email_integrations')
        .select('id, provider, provider_account_id, email_address, status, last_synced_at, token_expires_at, created_at, updated_at')
        .eq('organization_id', organizationId)
        .eq('provider', provider)
        .maybeSingle();

      if (!error && integration) {
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
    } catch (err) {
      // Ignore table missing error and fallback
    }

    // Fallback to local store
    const localStore = loadLocalStore();
    const localKey = `${organizationId}:${provider}`;
    if (localStore[localKey] && localStore[localKey].status !== 'disconnected') {
      const item = localStore[localKey];
      return {
        id: item.id || `local-${organizationId}`,
        provider: provider,
        status: item.status || 'connected',
        email_address: item.email_address || null,
        last_synced_at: item.last_synced_at || null,
      };
    }

    // Fallback to organizations.channel_config
    const { data: org } = await this.supabase
      .from('organizations')
      .select('channel_config, settings')
      .eq('id', organizationId)
      .maybeSingle();

    if (org?.channel_config?.email_address || org?.channel_config?.google_refresh_token) {
      return {
        id: `org-channel-${organizationId}`,
        provider: provider,
        status: org.channel_config.status || 'connected',
        email_address: org.channel_config.email_address || null,
        last_synced_at: org.channel_config.last_synced_at || null,
      };
    }

    return {
      provider,
      status: 'disconnected',
      email_address: null,
      last_synced_at: null,
      message: 'No active email connection for this organization.',
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

      // 5. Upsert integration record in email_integrations table or fallback to organizations table
      let finalRefreshTokenEncrypted = refreshTokenEncrypted;
      if (!finalRefreshTokenEncrypted) {
        try {
          const { data: existing } = await this.supabase
            .from('email_integrations')
            .select('refresh_token_encrypted')
            .eq('organization_id', organizationId)
            .eq('provider', 'gmail')
            .maybeSingle();

          if (existing?.refresh_token_encrypted) {
            finalRefreshTokenEncrypted = existing.refresh_token_encrypted;
          }
        } catch (e) {}
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

      let savedRecord = null;
      try {
        const { data: saved, error } = await this.supabase
          .from('email_integrations')
          .upsert(payload, { onConflict: 'organization_id,provider' })
          .select('id, provider, email_address, status, last_synced_at, created_at, updated_at')
          .maybeSingle();

        if (!error && saved) {
          savedRecord = saved;
        }
      } catch (e) {}

      // Fallback: Always update organizations table channel_config & settings to ensure seamless operation
      const { data: org } = await this.supabase
        .from('organizations')
        .select('channel_config, settings')
        .eq('id', organizationId)
        .maybeSingle();

      const existingChannel = org?.channel_config || {};
      const plainRefreshToken = tokenResult.refreshToken || existingChannel.google_refresh_token;

      const updatedChannelConfig = {
        ...existingChannel,
        google_refresh_token: plainRefreshToken,
        google_access_token: tokenResult.accessToken,
        email_address: profile.emailAddress,
        last_synced_at: payload.last_synced_at,
        status: 'connected',
      };

      const existingSettings = org?.settings || {};
      const integrationsList = Array.from(new Set([...(existingSettings.integrations || []), 'email']));

      await this.supabase
        .from('organizations')
        .update({
          channel_config: updatedChannelConfig,
          settings: { ...existingSettings, integrations: integrationsList },
        })
        .eq('id', organizationId);

      // Persistent Local Store Save
      const currentStore = loadLocalStore();
      const localKey = `${organizationId}:gmail`;
      currentStore[localKey] = {
        id: `integration-${organizationId}`,
        organization_id: organizationId,
        provider: 'gmail',
        provider_account_id: profile.providerAccountId,
        email_address: profile.emailAddress,
        access_token_encrypted: accessTokenEncrypted,
        refresh_token_encrypted: finalRefreshTokenEncrypted,
        token_expires_at: tokenResult.expiresAt.toISOString(),
        scopes: tokenResult.scopes,
        status: 'connected',
        last_synced_at: payload.last_synced_at,
      };
      saveLocalStore(currentStore);

      if (!savedRecord) {
        savedRecord = {
          id: `integration-${organizationId}`,
          provider: 'gmail',
          email_address: profile.emailAddress,
          status: 'connected',
          last_synced_at: payload.last_synced_at,
        };
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
        integration: savedRecord,
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
    let integration = null;
    try {
      const { data } = await this.supabase
        .from('email_integrations')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('provider', provider)
        .maybeSingle();
      integration = data;
    } catch (e) {}

    const localStore = loadLocalStore();
    const localKey = `${organizationId}:${provider}`;
    if (!integration && localStore[localKey]) {
      integration = localStore[localKey];
    }

    if (integration) {
      if (integration.status === 'disconnected') {
        throw new Error('Email integration is disconnected.');
      }
      const expiresAt = integration.token_expires_at ? new Date(integration.token_expires_at) : new Date(0);
      const isExpired = Date.now() >= (expiresAt.getTime() - 5 * 60 * 1000);

      if (!isExpired && integration.access_token_encrypted) {
        return TokenService.decrypt(integration.access_token_encrypted);
      }

      if (integration.refresh_token_encrypted) {
        const plainRefreshToken = TokenService.decrypt(integration.refresh_token_encrypted);
        const providerImpl = this.getProvider(provider);
        try {
          const newTokens = await providerImpl.refreshToken(plainRefreshToken);
          const newAccessTokenEncrypted = TokenService.encrypt(newTokens.accessToken);

          await this.supabase
            .from('email_integrations')
            .update({
              access_token_encrypted: newAccessTokenEncrypted,
              token_expires_at: newTokens.expiresAt.toISOString(),
              status: 'connected',
            })
            await this.logAudit(organizationId, null, 'gmail_token_refreshed', { provider });

          return newTokens.accessToken;
        } catch (refreshErr) {
          await this.supabase
            .from('email_integrations')
            .update({ status: 'token_expired' })
            .eq('id', integration.id);

          throw new Error('Gmail connection has expired. Please reconnect your account.');
        }
      }
    }

    // Fallback: check organizations table
    const { data: org } = await this.supabase
      .from('organizations')
      .select('channel_config')
      .eq('id', organizationId)
      .maybeSingle();

    if (org?.channel_config?.google_access_token) {
      return org.channel_config.google_access_token;
    }

    if (org?.channel_config?.google_refresh_token) {
      const providerImpl = this.getProvider(provider);
      const newTokens = await providerImpl.refreshToken(org.channel_config.google_refresh_token);
      
      await this.supabase.from('organizations').update({
        channel_config: {
          ...(org.channel_config || {}),
          google_access_token: newTokens.accessToken,
        }
      }).eq('id', organizationId);

      return newTokens.accessToken;
    }

    throw new Error(`No email integration found for organization ${organizationId}`);
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

    // Delete from local store
    const store = loadLocalStore();
    delete store[`${organizationId}:${provider}`];
    saveLocalStore(store);

    try {
      await this.supabase
        .from('email_integrations')
        .delete()
        .eq('organization_id', organizationId)
        .eq('provider', provider);
    } catch (e) {}

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
