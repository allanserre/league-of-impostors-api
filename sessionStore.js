class InMemorySessionStore  {
	constructor() {
		this.sessions = new Map();
	}

	findSession(id) {
		return this.sessions.get(id);
	}

	saveSession(id, session) {
		this.sessions.set(id, session);
	}

	findAllSessions() {
		return [...this.sessions.values()];
	}
}

  const SESSION_TTL = 24 * 60 * 60;
const mapSession = ([id, username, roomId,connected]) =>
  id ? { id, username, roomId, connected: connected === "true" } : undefined;

  module.exports = {
	InMemorySessionStore,
  };