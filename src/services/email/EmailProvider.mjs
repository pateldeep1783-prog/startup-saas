/**
 * Abstract EmailProvider Interface
 * Base contract for provider implementations (GmailProvider, future OutlookProvider).
 */
export class EmailProvider {
  /**
   * Retrieves the connected account's user profile (email address, provider account id).
   * @param {Object} tokens - { accessToken, refreshToken }
   * @returns {Promise<{ emailAddress: string, providerAccountId: string }>}
   */
  async getProfile(tokens) {
    throw new Error('Method getProfile() must be implemented by Provider subclass');
  }

  /**
   * Lists email messages from the user's mailbox.
   * @param {Object} tokens - { accessToken, refreshToken }
   * @param {Object} [options] - Query options (query, maxResults, pageToken)
   * @returns {Promise<{ messages: Array, nextPageToken: string, resultSizeEstimate: number }>}
   */
  async listMessages(tokens, options = {}) {
    throw new Error('Method listMessages() must be implemented by Provider subclass');
  }

  /**
   * Gets details of a specific message by ID.
   * @param {Object} tokens - { accessToken, refreshToken }
   * @param {string} messageId - Message identifier
   * @returns {Promise<Object>}
   */
  async getMessage(tokens, messageId) {
    throw new Error('Method getMessage() must be implemented by Provider subclass');
  }

  /**
   * Sends an email message.
   * @param {Object} tokens - { accessToken, refreshToken }
   * @param {Object} message - { to, subject, body }
   * @returns {Promise<Object>}
   */
  async sendMessage(tokens, message) {
    throw new Error('Method sendMessage() must be implemented by Provider subclass');
  }

  /**
   * Refreshes access token using refresh token.
   * @param {string} refreshToken
   * @returns {Promise<{ accessToken: string, expiresAt: Date, scopes: Array }>}
   */
  async refreshToken(refreshToken) {
    throw new Error('Method refreshToken() must be implemented by Provider subclass');
  }

  /**
   * Revokes user grant/tokens.
   * @param {Object} tokens - { accessToken, refreshToken }
   * @returns {Promise<boolean>}
   */
  async revokeAccess(tokens) {
    throw new Error('Method revokeAccess() must be implemented by Provider subclass');
  }

  /**
   * Registers push notifications watch / subscription.
   * @param {Object} tokens
   * @param {string} topicName
   * @returns {Promise<Object>}
   */
  async createWatch(tokens, topicName) {
    throw new Error('Method createWatch() must be implemented by Provider subclass');
  }

  /**
   * Cancels push notifications watch.
   * @param {Object} tokens
   * @returns {Promise<boolean>}
   */
  async stopWatch(tokens) {
    throw new Error('Method stopWatch() must be implemented by Provider subclass');
  }
}
