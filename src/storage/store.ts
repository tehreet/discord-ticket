import { Database } from "bun:sqlite";

export type Phase = "new" | "interviewing" | "awaiting_approval" | "approved" | "filed" | "rejected";

export interface ThreadRow {
  thread_id: string;
  session_id: string | null;
  phase: Phase;
  draft_json: string | null;
  github_issue_number: number | null;
  last_seen_message_id: string | null;
  created_at: number;
  updated_at: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS threads (
  thread_id             TEXT PRIMARY KEY,
  session_id            TEXT,
  phase                 TEXT NOT NULL CHECK (phase IN (
                          'new','interviewing','awaiting_approval',
                          'approved','filed','rejected'
                        )),
  draft_json            TEXT,
  github_issue_number   INTEGER,
  last_seen_message_id  TEXT,
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_threads_phase ON threads(phase);
`;

export class SessionStore {
  private db: Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(SCHEMA);
    // Shared-DB migration: threads.owner + agent_inbox for build-bot handoff.
    // Idempotent — safe to run whichever bot starts first.
    const cols = this.db.query(`PRAGMA table_info(threads)`).all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === "owner")) {
      this.db.exec(`ALTER TABLE threads ADD COLUMN owner TEXT NOT NULL DEFAULT 'ticket-bot'`);
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_inbox (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        recipient   TEXT NOT NULL,
        thread_id   TEXT NOT NULL,
        message_id  TEXT NOT NULL UNIQUE,
        author_id   TEXT NOT NULL,
        content     TEXT NOT NULL,
        created_at  INTEGER NOT NULL,
        consumed_at INTEGER
      );
    `);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_inbox_unread ON agent_inbox(recipient, consumed_at);`);
  }

  getOwner(threadId: string): string | null {
    const row = this.db
      .query(`SELECT owner FROM threads WHERE thread_id = ?`)
      .get(threadId) as { owner: string } | null;
    return row?.owner ?? null;
  }

  setOwner(threadId: string, owner: "ticket-bot" | "build-bot"): void {
    this.db
      .query(`UPDATE threads SET owner = ?, updated_at = ? WHERE thread_id = ?`)
      .run(owner, Date.now(), threadId);
  }

  insertInbox(args: {
    recipient: string;
    thread_id: string;
    message_id: string;
    author_id: string;
    content: string;
  }): boolean {
    const res = this.db
      .query(
        `INSERT OR IGNORE INTO agent_inbox
         (recipient, thread_id, message_id, author_id, content, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(args.recipient, args.thread_id, args.message_id, args.author_id, args.content, Date.now());
    return res.changes > 0;
  }

  insertThread(threadId: string): void {
    const now = Date.now();
    this.db
      .query(`INSERT OR IGNORE INTO threads
              (thread_id, phase, created_at, updated_at)
              VALUES (?, 'new', ?, ?)`)
      .run(threadId, now, now);
  }

  getThread(threadId: string): ThreadRow | null {
    const row = this.db
      .query(`SELECT * FROM threads WHERE thread_id = ?`)
      .get(threadId) as ThreadRow | null;
    return row ?? null;
  }

  getPhase(threadId: string): Phase | null {
    const row = this.db
      .query(`SELECT phase FROM threads WHERE thread_id = ?`)
      .get(threadId) as { phase: Phase } | null;
    return row?.phase ?? null;
  }

  setPhase(threadId: string, phase: Phase): void {
    this.db
      .query(`UPDATE threads SET phase = ?, updated_at = ? WHERE thread_id = ?`)
      .run(phase, Date.now(), threadId);
  }

  setSession(threadId: string, sessionId: string): void {
    this.db
      .query(`UPDATE threads SET session_id = ?, updated_at = ? WHERE thread_id = ?`)
      .run(sessionId, Date.now(), threadId);
  }

  getSession(threadId: string): string | null {
    const row = this.db
      .query(`SELECT session_id FROM threads WHERE thread_id = ?`)
      .get(threadId) as { session_id: string | null } | null;
    return row?.session_id ?? null;
  }

  setDraft(threadId: string, draft: unknown): void {
    this.db
      .query(`UPDATE threads SET draft_json = ?, updated_at = ? WHERE thread_id = ?`)
      .run(JSON.stringify(draft), Date.now(), threadId);
  }

  getDraft(threadId: string): unknown | null {
    const row = this.db
      .query(`SELECT draft_json FROM threads WHERE thread_id = ?`)
      .get(threadId) as { draft_json: string | null } | null;
    return row?.draft_json ? JSON.parse(row.draft_json) : null;
  }

  setLastSeenMessage(threadId: string, messageId: string): void {
    this.db
      .query(`UPDATE threads SET last_seen_message_id = ?, updated_at = ? WHERE thread_id = ?`)
      .run(messageId, Date.now(), threadId);
  }

  setIssueNumber(threadId: string, number: number): void {
    this.db
      .query(`UPDATE threads SET github_issue_number = ?, phase = 'filed', updated_at = ?
              WHERE thread_id = ?`)
      .run(number, Date.now(), threadId);
  }

  listActiveThreads(): ThreadRow[] {
    return this.db
      .query(`SELECT * FROM threads WHERE phase NOT IN ('filed','rejected')`)
      .all() as ThreadRow[];
  }
}
