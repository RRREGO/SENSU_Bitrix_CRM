/**
 * Abstract communication provider.
 */

export class CommunicationProvider {
  constructor(name) {
    this.name = name;
  }

  async testConnection() {
    throw new Error(`${this.name}: testConnection not implemented`);
  }

  async listChannels() {
    throw new Error(`${this.name}: listChannels not implemented`);
  }

  async sendMessage(_payload) {
    throw new Error(`${this.name}: sendMessage not implemented`);
  }

  async getTemplates(_options = {}) {
    return [];
  }

  async subscribeWebhook(_config) {
    throw new Error(`${this.name}: subscribeWebhook not implemented`);
  }

  async normalizeWebhook(payload) {
    return { provider: this.name, events: [], rawUnknown: Boolean(payload) };
  }

  async getCapabilities(_channel) {
    return {
      canSend: false,
      canReceive: false,
      supportsTemplates: false,
      supportsReadReceipts: false,
      requiresKnownChatId: false,
    };
  }
}
