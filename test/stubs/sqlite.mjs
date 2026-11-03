// 冒烟测试桩:内存版 SQLite 连接,预置「旧版库」——loop_challenge 缺 goal_note 列 + 一条旧挑战行。
// 仅实现 learningLoop 会发出的语句:CREATE(空操作)/BEGIN/COMMIT/ROLLBACK/DELETE/INSERT/SELECT/PRAGMA/ALTER。
const OLD_LOOP_CHALLENGE_COLS = [
  "id", "topic_id", "topic_title", "start_date", "total_days",
  "threshold", "threshold_minutes", "freezes_left", "status", "settled_on",
];
const today = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

class FakeDb {
  constructor() {
    // 旧版 schema:所有表都存在,loop_challenge 没有 goal_note
    this.tables = new Map([
      ["loop_challenge", { columns: [...OLD_LOOP_CHALLENGE_COLS], defaults: {}, rows: [this.#legacyRow()] }],
      ["loop_checkin", { columns: ["id", "challenge_id", "date", "kind", "event_id", "note_id"], defaults: {}, rows: [] }],
      ["loop_point", { columns: ["id", "topic_id", "name", "bloom_level", "mastery", "status", "last_evidence_at"], defaults: {}, rows: [] }],
      ["loop_card", { columns: ["id", "topic_id", "point_id", "source_type", "source_id", "source_title", "front", "back", "ease", "interval_days", "due_date", "status"], defaults: {}, rows: [] }],
      ["loop_review_log", { columns: ["id", "card_id", "reviewed_at", "grade"], defaults: {}, rows: [] }],
      ["loop_teachback", { columns: ["id", "topic_id", "transcript_id", "result_json", "created_at"], defaults: {}, rows: [] }],
    ]);
  }
  #legacyRow() {
    return {
      id: "legacy1", topic_id: "t-old-sqlite", topic_title: "旧库挑战",
      start_date: today(), total_days: 100, threshold: "one_event",
      threshold_minutes: null, freezes_left: 2, status: "active", settled_on: "",
    };
  }
  async open() {}
  async execute(sql) {
    for (const stmt of sql.split(";").map((s) => s.trim()).filter(Boolean)) this.#run(stmt, []);
    return { changes: { values: 1 } };
  }
  async run(sql, params = []) {
    this.#run(sql, params);
    return { changes: { values: 1 } };
  }
  async query(sql) {
    return { values: this.#query(sql) };
  }
  #run(sql, params) {
    let m = /^CREATE TABLE IF NOT EXISTS (\w+)/i.exec(sql);
    if (m) return; // 桩表已预置,IF NOT EXISTS 即空操作
    if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(sql)) return;
    m = /^DELETE FROM (\w+)$/i.exec(sql);
    if (m) {
      this.#table(m[1]).rows.length = 0;
      return;
    }
    m = /^INSERT INTO (\w+)\s*\(([^)]*)\)\s*VALUES\s*\(([^)]*)\)$/i.exec(sql);
    if (m) {
      const table = this.#table(m[1]);
      const cols = m[2].split(",").map((c) => c.trim());
      const placeholders = m[3].split(",").length;
      if (placeholders !== params.length)
        throw new Error(`stub: 占位符 ${placeholders} 与参数 ${params.length} 不匹配: ${sql}`);
      if (cols.length !== placeholders) throw new Error(`stub: 列数与占位符不一致: ${sql}`);
      const row = {};
      cols.forEach((col, i) => { row[col] = params[i] === undefined ? null : params[i]; });
      table.rows.push(row);
      return;
    }
    m = /^ALTER TABLE (\w+) ADD COLUMN (\w+) (.+)$/i.exec(sql);
    if (m) {
      const table = this.#table(m[1]);
      if (table.columns.includes(m[2])) throw new Error(`stub: 列已存在 ${m[2]}`);
      table.columns.push(m[2]);
      const def = /DEFAULT\s+'([^']*)'/i.exec(m[3]);
      const defNum = def ? null : /DEFAULT\s+(-?[\d.]+)/i.exec(m[3]);
      table.defaults[m[2]] = def ? def[1] : defNum ? Number(defNum[1]) : null;
      return;
    }
    throw new Error(`stub: 不支持的语句 ${sql}`);
  }
  #query(sql) {
    let m = /^SELECT \* FROM (\w+)(\s+ORDER BY rowid)?$/i.exec(sql.trim());
    if (m) {
      const table = this.#table(m[1]);
      return table.rows.map((row) => {
        const out = {};
        for (const col of table.columns)
          out[col] = row[col] === undefined ? (col in table.defaults ? table.defaults[col] : null) : row[col];
        return out;
      });
    }
    m = /^PRAGMA table_info\((\w+)\)$/i.exec(sql.trim());
    if (m)
      return this.#table(m[1]).columns.map((name) => ({ name }));
    throw new Error(`stub: 不支持的查询 ${sql}`);
  }
  #table(name) {
    const table = this.tables.get(name);
    if (!table) throw new Error(`stub: 没有表 ${name}`);
    return table;
  }
}
let instance = null;
export class SQLiteConnection {
  // 单例:同一次测试进程里重复 createConnection 返回同一个库,供重读断言
  async createConnection() {
    if (!instance) instance = new FakeDb();
    return instance;
  }
}
export const CapacitorSQLite = {};
export function fakeDb() {
  return instance;
}
