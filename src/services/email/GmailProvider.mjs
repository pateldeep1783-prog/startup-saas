import { google } from 'googleapis';
import { EmailProvider } from './EmailProvider.mjs';

/**
 * GmailProvider Implementation
 * Interacts directly with Google OAuth 2.0 and Gmail API v1.
 */
export class GmailProvider extends EmailProvider {
  constructor(clientId, clientSecret, redirectUri) {
    super();
    this.clientId = clientId || process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID;
    this.clientSecret = clientSecret || process.env.GOOGLE_CLIENT_SECRET;
    this.redirectUri = redirectUri || process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/api/integrations/email/gmail/callback';
  }

  /**
   * Creates an authenticated OAuth2 client instance.
   * @private
   */
  _createOAuthClient(tokens = {}) {
    const oauth2Client = new google.auth.OAuth2(
      this.clientId,
      this.clientSecret,
      this.redirectUri
    );

    if (tokens.accessToken || tokens.refreshToken) {
      oauth2Client.setCredentials({
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
      });
    }

    return oauth2Client;
  }

  /**
   * Fetches user profile (email address and account ID) from Gmail API.
   * @param {Object} tokens - { accessToken, refreshToken }
   * @returns {Promise<{ emailAddress: string, providerAccountId: string }>}
   */
  async getProfile(tokens) {
    const auth = this._createOAuthClient(tokens);
    const gmail = google.gmail({ version: 'v1', auth });

    const res = await gmail.users.getProfile({ userId: 'me' });
    return {
      emailAddress: res.data.emailAddress,
      providerAccountId: res.data.emailAddress, // Gmail uses email address as primary user account identifier
      messagesTotal: res.data.messagesTotal,
      threadsTotal: res.data.threadsTotal,
      historyId: res.data.historyId,
    };
  }

  /**
   * Lists messages from connected Gmail mailbox.
   * @param {Object} tokens
   * @param {Object} [options]
   */
  async listMessages(tokens, options = {}) {
    const auth = this._createOAuthClient(tokens);
    const gmail = google.gmail({ version: 'v1', auth });

    const res = await gmail.users.messages.list({
      userId: 'me',
      q: options.query || undefined,
      maxResults: options.maxResults || 20,
      pageToken: options.pageToken || undefined,
    });

    return {
      messages: res.data.messages || [],
      nextPageToken: res.data.nextPageToken || null,
      resultSizeEstimate: res.data.resultSizeEstimate || 0,
    };
  }

  /**
   * Gets message payload by ID.
   * @param {Object} tokens
   * @param {string} messageId
   */
  async getMessage(tokens, messageId) {
    const auth = this._createOAuthClient(tokens);
    const gmail = google.gmail({ version: 'v1', auth });

    const res = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });

    return res.data;
  }

  /**
   * Sends email message via Gmail API.
   * @param {Object} tokens
   * @param {Object} message - { to, subject, body }
   */
  async sendMessage(tokens, message) {
    const auth = this._createOAuthClient(tokens);
    const gmail = google.gmail({ version: 'v1', auth });

    const utf8Subject = `=?utf-8?B?${Buffer.from(message.subject || '').toString('base64')}?=`;
    const messageParts = [
      `To: ${message.to}`,
      'Content-Type: text/plain; charset=utf-8',
      'MIME-Version: 1.0',
      `Subject: ${utf8Subject}`,
      '',
      message.body || '',
    ];
    const emailText = messageParts.join('\n');
    const encodedMessage = Buffer.from(emailText)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const res = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage,
      },
    });

    return res.data;
  }

  /**
   * Refreshes OAuth2 access token.
   * @param {string} refreshToken
   */
  async refreshToken(refreshToken) {
    const auth = this._createOAuthClient({ refreshToken });
    const { credentials } = await auth.refreshAccessToken();

    const expiresAt = credentials.expiry_date
      ? new Date(credentials.expiry_date)
      : new Date(Date.now() + 3600 * 1000);

    return {
      accessToken: credentials.access_token,
      expiresAt,
      scopes: credentials.scope ? credentials.scope.split(' ') : [],
    };
  }

  /**
   * Revokes Google access or refresh token.
   * @param {Object} tokens
   */
  async revokeAccess(tokens) {
    try {
      const auth = this._createOAuthClient(tokens);
      const tokenToRevoke = tokens.refreshToken || tokens.accessToken;
      if (tokenToRevoke) {
        await auth.revokeToken(tokenToRevoke);
      }
      return true;
    } catch (err) {
      console.warn('[GmailProvider] Revoke warning:', err.message);
      return false;
    }
  }

  /**
   * Creates Gmail push notification watch via Google Pub/Sub topic.
   * @param {Object} tokens
   * @param {string} topicName
   */
  async createWatch(tokens, topicName) {
    const auth = this._createOAuthClient(tokens);
    const gmail = google.gmail({ version: 'v1', auth });

    const res = await gmail.users.watch({
      userId: 'me',
      requestBody: {
        topicName,
        labelIds: ['INBOX'],
      },
    });

    return res.data;
  }

  /**
   * Cancels push notification watch.
   * @param {Object} tokens
   */
  async stopWatch(tokens) {
    try {
      const auth = this._createOAuthClient(tokens);
      const gmail = google.gmail({ version: 'v1', auth });
      await gmail.users.stop({ userId: 'me' });
      return true;
    } catch (err) {
      console.warn('[GmailProvider] Stop watch warning:', err.message);
      return false;
    }
  }
}
