/**
 * 异步对战的「幽灵卡组」数据库（SQLite，文件在 data/ghosts.db）。
 * 作为 Vite 中间件挂在 dev / preview 服务器上：
 *   POST /api/ghosts                       保存一份卡组快照
 *   GET  /api/ghosts/match?day=3&exclude=x 按天数匹配一个别人的卡组
 *   GET  /api/ghosts/stats                 每天有多少份快照
 * 以后要上线，把这三个接口原样搬到正式后端即可。
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { IncomingMessage, ServerResponse } from 'node:http';

type Next = (err?: unknown) => void;

export function createGhostMiddleware(file: string) {
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE IF NOT EXISTS ghosts_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      name TEXT NOT NULL,
      day INTEGER NOT NULL,
      stars INTEGER NOT NULL,
      hp INTEGER NOT NULL,
      cls TEXT NOT NULL DEFAULT '',
      gold INTEGER NOT NULL DEFAULT 0,
      deck TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(run_id, day)
    );
    CREATE INDEX IF NOT EXISTS idx_ghosts_v2_day ON ghosts_v2(day);
  `);
  const insert = db.prepare(
    `INSERT OR REPLACE INTO ghosts_v2 (run_id, name, day, stars, hp, cls, gold, deck, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const sameDay = db.prepare(`SELECT * FROM ghosts_v2 WHERE day = ? AND run_id != ? ORDER BY RANDOM() LIMIT 1`);
  // 同一天没人时，找最接近的一天（优先更早的）
  const nearest = db.prepare(
    `SELECT * FROM ghosts_v2 WHERE run_id != ? ORDER BY ABS(day - ?) ASC, (day > ?) ASC, RANDOM() LIMIT 1`,
  );
  const stats = db.prepare(`SELECT day, COUNT(*) AS n FROM ghosts_v2 GROUP BY day ORDER BY day`);

  const send = (res: ServerResponse, code: number, body: unknown) => {
    res.statusCode = code;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
  };

  const readBody = (req: IncomingMessage) =>
    new Promise<string>((resolve, reject) => {
      let s = '';
      req.on('data', (chunk) => {
        s += chunk;
        if (s.length > 200_000) reject(new Error('too large'));
      });
      req.on('end', () => resolve(s));
      req.on('error', reject);
    });

  const toGhost = (row: Record<string, unknown> | undefined) =>
    row && {
      runId: row.run_id, name: row.name, day: row.day, stars: row.stars, hp: row.hp, cls: row.cls, gold: row.gold,
      deck: JSON.parse(String(row.deck)),
    };

  return async (req: IncomingMessage, res: ServerResponse, next: Next) => {
    if (!req.url?.startsWith('/api/ghosts')) return next();
    const url = new URL(req.url, 'http://local');
    try {
      if (req.method === 'POST' && url.pathname === '/api/ghosts') {
        const g = JSON.parse(await readBody(req));
        const deck = sanitizeDeck(g.deck);
        const day = int(g.day, 1, 10_000);
        if (!deck || !day || typeof g.runId !== 'string') return send(res, 400, { error: 'bad ghost' });
        insert.run(g.runId.slice(0, 64), String(g.name ?? '玩家').slice(0, 16), day,
          int(g.stars, 0, 99) ?? 0, int(g.hp, 0, 99) ?? 0, String(g.cls ?? '').slice(0, 16),
          int(g.gold, 0, 100_000) ?? 0, JSON.stringify(deck), Date.now());
        return send(res, 200, { ok: true });
      }
      if (req.method === 'GET' && url.pathname === '/api/ghosts/match') {
        const day = int(url.searchParams.get('day'), 1, 10_000) ?? 1;
        const ex = url.searchParams.get('exclude') ?? '';
        const row = (sameDay.get(day, ex) ?? nearest.get(ex, day, day)) as Record<string, unknown> | undefined;
        return send(res, 200, { ghost: toGhost(row) ?? null });
      }
      if (req.method === 'GET' && url.pathname === '/api/ghosts/stats') {
        return send(res, 200, { days: stats.all() });
      }
      send(res, 404, { error: 'not found' });
    } catch (e) {
      send(res, 500, { error: String(e) });
    }
  };
}

function int(v: unknown, lo: number, hi: number): number | undefined {
  const n = Number(v);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : undefined;
}

/** 字段做格式和范围检查，防止乱写的数据把别人的游戏搞坏（卡牌 id 是否存在由客户端再过滤） */
function sanitizeDeck(deck: unknown) {
  if (!Array.isArray(deck) || deck.length > 300) return null;
  const out = [];
  for (const [i, c] of deck.entries()) {
    if (!c || typeof c.id !== 'string' || !/^[a-z]\d{2}$/.test(c.id)) return null;
    const tier = int(c.tier, 0, 2);
    const bonus = int(c.bonus, 0, 10_000_000);
    if (tier === undefined || bonus === undefined) return null;
    out.push({ uid: `g${i}`, id: c.id, tier, bonus });
  }
  return out;
}
