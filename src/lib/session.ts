import { randomUUID } from 'crypto';
import { Session } from './types.js';

class SessionManager {
  private sessions = new Map<string, Session>();

  create(initialState: string = 'initialized'): Session {
    const session: Session = {
      id: randomUUID(),
      state: initialState,
      createdAt: Date.now(),
      data: {},
    };
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  update(id: string, patch: Partial<Session>): void {
    const session = this.sessions.get(id);
    if (session) Object.assign(session, patch);
  }

  delete(id: string): void {
    this.sessions.delete(id);
  }
}

export const sessions = new SessionManager();
