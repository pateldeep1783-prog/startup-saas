import assert from 'assert';
import { TokenService } from '../src/services/email/TokenService.mjs';
import { GmailOAuthService } from '../src/services/email/GmailOAuthService.mjs';
import { GmailProvider } from '../src/services/email/GmailProvider.mjs';
import { EmailIntegrationService } from '../src/services/email/EmailIntegrationService.mjs';

// Mock Supabase Database Client for Test Isolation
class MockSupabaseClient {
  constructor() {
    this.integrations = new Map(); // key: orgId:provider
    this.auditLogs = [];
  }

  from(table) {
    const self = this;

    if (table === 'email_integrations') {
      return {
        select(fields) {
          return {
            eq(col, val) {
              return {
                eq(col2, val2) {
                  return {
                    maybeSingle: async () => {
                      const key = `${val}:${val2}`;
                      const item = self.integrations.get(key);
                      return { data: item || null, error: null };
                    },
                    single: async () => {
                      const key = `${val}:${val2}`;
                      const item = self.integrations.get(key);
                      if (!item) return { data: null, error: new Error('Record not found') };
                      return { data: item, error: null };
                    }
                  };
                },
                maybeSingle: async () => {
                  for (const [key, item] of self.integrations.entries()) {
                    if (item[col] === val) return { data: item, error: null };
                  }
                  return { data: null, error: null };
                }
              };
            }
          };
        },
        upsert(payload, options) {
          return {
            select() {
              return {
                single: async () => {
                  const key = `${payload.organization_id}:${payload.provider}`;
                  const existing = self.integrations.get(key) || {};
                  const record = {
                    id: existing.id || `integration-${Math.random().toString(36).substr(2, 9)}`,
                    ...existing,
                    ...payload,
                    created_at: existing.created_at || new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                  };
                  self.integrations.set(key, record);
                  return { data: record, error: null };
                },
                maybeSingle: async () => {
                  const key = `${payload.organization_id}:${payload.provider}`;
                  const existing = self.integrations.get(key) || {};
                  const record = {
                    id: existing.id || `integration-${Math.random().toString(36).substr(2, 9)}`,
                    ...existing,
                    ...payload,
                    created_at: existing.created_at || new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                  };
                  self.integrations.set(key, record);
                  return { data: record, error: null };
                }
              };
            }
          };
        },
        update(payload) {
          return {
            eq(col, val) {
              return {
                eq(col2, val2) {
                  const key = `${val}:${val2}`;
                  const item = self.integrations.get(key);
                  if (item) {
                    Object.assign(item, payload, { updated_at: new Date().toISOString() });
                  }
                  return Promise.resolve({ data: item, error: null });
                },
                then: (resolve) => {
                  for (const [k, item] of self.integrations.entries()) {
                    if (item[col] === val) {
                      Object.assign(item, payload, { updated_at: new Date().toISOString() });
                    }
                  }
                  resolve({ data: true, error: null });
                }
              };
            }
          };
        },
        delete() {
          return {
            eq(col, val) {
              for (const [k, item] of self.integrations.entries()) {
                if (item[col] === val) {
                  self.integrations.delete(k);
                }
              }
              return Promise.resolve({ error: null });
            }
          };
        }
      };
    }

    if (table === 'email_integration_audit_logs') {
      return {
        insert: async (row) => {
          self.auditLogs.push(row);
          return { data: row, error: null };
        }
      };
    }

    if (table === 'organizations') {
      return {
        select(fields) {
          return {
            eq(col, val) {
              return {
                maybeSingle: async () => ({ data: { id: val, channel_config: {}, settings: {} }, error: null }),
                single: async () => ({ data: { id: val, channel_config: {}, settings: {} }, error: null })
              };
            }
          };
        },
        update(payload) {
          return {
            eq(col, val) {
              return Promise.resolve({ data: payload, error: null });
            }
          };
        }
      };
    }

    throw new Error(`Unhandled mock table ${table}`);
  }
}

// Dummy Provider for Testing Token Lifecycle
class MockGmailProvider extends GmailProvider {
  async getProfile(tokens) {
    if (!tokens.accessToken) throw new Error('Access token required');
    return {
      emailAddress: 'clinic-test@gmail.com',
      providerAccountId: 'clinic-test@gmail.com',
    };
  }

  async listMessages(tokens) {
    return { messages: [{ id: 'msg-1' }, { id: 'msg-2' }] };
  }

  async refreshToken(refreshToken) {
    if (refreshToken === 'invalid-refresh-token') {
      throw new Error('Invalid Grant / Token Revoked');
    }
    return {
      accessToken: `refreshed-access-token-${Date.now()}`,
      expiresAt: new Date(Date.now() + 3600 * 1000),
      scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    };
  }

  async revokeAccess(tokens) {
    return true;
  }
}

// -------------------------------------------------------------
// TEST SUITE
// -------------------------------------------------------------
async function runTestSuite() {
  console.log('🧪 Starting Email Integration Module Automated Test Suite...\n');

  // 1. TOKEN ENCRYPTION TESTS
  console.log('1️⃣ Testing TokenService (AES-256-GCM Encryption)...');
  const secretToken = 'ya29.a0Axoo88X_sample_google_oauth_access_token_12345';
  const encrypted = TokenService.encrypt(secretToken);
  
  assert.ok(encrypted, 'Encrypted output should not be null');
  assert.notStrictEqual(encrypted, secretToken, 'Encrypted output must not equal plain text');
  assert.strictEqual(encrypted.includes(secretToken), false, 'Encrypted string must not contain plain token');
  
  const decrypted = TokenService.decrypt(encrypted);
  assert.strictEqual(decrypted, secretToken, 'Decrypted string must match original token');
  console.log('   ✅ Token encryption & decryption verified.');

  // 2. OAUTH STATE & CSRF TESTS
  console.log('2️⃣ Testing GmailOAuthService (State Generation & CSRF Validation)...');
  const oauthService = new GmailOAuthService('client-id', 'client-secret', 'http://localhost:3001/callback');
  const orgA = 'org-uuid-aaaa-1111';
  const userA = 'user-uuid-uuuu-1111';

  const state = oauthService.generateState(orgA, userA);
  assert.ok(state, 'State should be generated');

  const validated = oauthService.validateState(state, { organizationId: orgA });
  assert.strictEqual(validated.organizationId, orgA, 'Validated state organizationId should match orgA');
  assert.strictEqual(validated.provider, 'gmail', 'Provider should be gmail');

  // Tampered state test
  assert.throws(() => {
    oauthService.validateState(state + 'tampered', { organizationId: orgA });
  }, /verification failed/i, 'Tampered state must be rejected');

  // Org mismatch test
  assert.throws(() => {
    oauthService.validateState(state, { organizationId: 'org-uuid-bbbb-2222' });
  }, /organization mismatch/i, 'Cross-tenant state mismatch must be rejected');
  console.log('   ✅ OAuth state generation and CSRF protection verified.');

  // 3. SERVICE & DATABASE LIFECYCLE TESTS
  console.log('3️⃣ Testing EmailIntegrationService Lifecycle & Safe Status...');
  const mockDb = new MockSupabaseClient();
  const mockProvider = new MockGmailProvider();
  const service = new EmailIntegrationService(mockDb, { gmailProvider: mockProvider, gmailOAuthService: oauthService });

  // Status before connect
  let status = await service.getStatus(orgA);
  assert.strictEqual(status.status, 'disconnected', 'Status should initially be disconnected');
  assert.strictEqual(status.access_token, undefined, 'Status MUST NOT leak tokens');
  assert.strictEqual(status.refresh_token, undefined, 'Status MUST NOT leak refresh token');

  // Simulate OAuth callback execution
  const mockCode = 'valid-google-auth-code';
  const callbackState = oauthService.generateState(orgA, userA);
  
  // Override exchangeCode for unit test mock
  oauthService.exchangeCode = async (code) => ({
    accessToken: secretToken,
    refreshToken: 'sample-google-refresh-token-9999',
    expiresAt: new Date(Date.now() + 3600 * 1000),
    scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
  });

  const connectResult = await service.handleCallback(mockCode, callbackState);
  assert.strictEqual(connectResult.status, 'connected');
  assert.strictEqual(connectResult.email_address, 'clinic-test@gmail.com');

  // Check stored database record
  const savedRecord = mockDb.integrations.get(`${orgA}:gmail`);
  assert.ok(savedRecord, 'Record must be saved in database');
  assert.notStrictEqual(savedRecord.access_token_encrypted, secretToken, 'Access token in DB MUST be encrypted');
  assert.strictEqual(TokenService.decrypt(savedRecord.access_token_encrypted), secretToken, 'Decrypted DB token matches secretToken');

  // Safe status after connect
  status = await service.getStatus(orgA);
  assert.strictEqual(status.status, 'connected');
  assert.strictEqual(status.email_address, 'clinic-test@gmail.com');
  assert.strictEqual(status.access_token_encrypted, undefined, 'Safe status MUST NOT expose access_token_encrypted');
  assert.strictEqual(status.refresh_token_encrypted, undefined, 'Safe status MUST NOT expose refresh_token_encrypted');
  console.log('   ✅ Connection lifecycle and safe status response verified.');

  // 4. MULTI-TENANT ISOLATION TESTS
  console.log('4️⃣ Testing Multi-Tenant Isolation (Org A vs Org B)...');
  const orgB = 'org-uuid-bbbb-2222';
  const statusB = await service.getStatus(orgB);
  assert.strictEqual(statusB.status, 'disconnected', 'Org B must be isolated and not see Org A connection');

  // Org B attempts to disconnect Org A
  await service.disconnect(orgB, 'userB');
  const statusAAfterOrgBDisconnect = await service.getStatus(orgA);
  assert.strictEqual(statusAAfterOrgBDisconnect.status, 'connected', 'Org B action must not affect Org A');
  console.log('   ✅ Multi-tenant isolation verified.');

  // 5. MAILBOX SYNC & TOKEN REFRESH TESTS
  console.log('5️⃣ Testing Mailbox Sync & Automatic Token Refresh...');
  const syncResult = await service.syncMailbox(orgA);
  assert.strictEqual(syncResult.success, true);
  assert.strictEqual(syncResult.emailAddress, 'clinic-test@gmail.com');
  assert.strictEqual(syncResult.messageCount, 2);

  // Expire access token to force refresh
  savedRecord.token_expires_at = new Date(Date.now() - 1000).toISOString();
  const refreshedToken = await service.getValidAccessToken(orgA);
  assert.ok(refreshedToken.startsWith('refreshed-access-token-'), 'Access token refreshed automatically');

  // Simulate refresh failure
  savedRecord.refresh_token_encrypted = TokenService.encrypt('invalid-refresh-token');
  savedRecord.token_expires_at = new Date(Date.now() - 1000).toISOString();

  await assert.rejects(async () => {
    await service.getValidAccessToken(orgA);
  }, /connection has expired/i, 'Failed refresh must throw expired error');

  const statusAfterFailedRefresh = await service.getStatus(orgA);
  assert.strictEqual(statusAfterFailedRefresh.status, 'token_expired', 'Status should update to token_expired on refresh failure');
  console.log('   ✅ Mailbox sync and automatic token refresh lifecycle verified.');

  // 6. DISCONNECT & AUDIT LOG TESTS
  console.log('6️⃣ Testing Disconnect & Audit Logs...');
  await service.disconnect(orgA);
  const statusAfterDisconnect = await service.getStatus(orgA);
  assert.strictEqual(statusAfterDisconnect.status, 'disconnected');

  assert.ok(mockDb.auditLogs.length > 0, 'Audit logs must record lifecycle events');
  const actionsLogged = mockDb.auditLogs.map(l => l.action);
  assert.ok(actionsLogged.includes('gmail_connected'), 'Audit log must record gmail_connected');
  assert.ok(actionsLogged.includes('gmail_token_refreshed'), 'Audit log must record gmail_token_refreshed');
  assert.ok(actionsLogged.includes('gmail_disconnected'), 'Audit log must record gmail_disconnected');
  console.log('   ✅ Disconnect and audit logging verified.');

  console.log('\n🎉 ALL EMAIL INTEGRATION TESTS PASSED SUCCESSFULLY! (100% PASS rate)');
}

runTestSuite().catch(err => {
  console.error('\n❌ TEST SUITE FAILURE:', err);
  process.exit(1);
});
