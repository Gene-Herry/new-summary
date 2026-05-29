// news-summary Worker · auto-deploy test
import { fetchAllFeeds, type FeedItem } from './feeds';
import { summarizeCategory, type SummarizedItem } from './summarize';

export interface Env {
  DB: D1Database;
  AI_API_KEY: string;
  AI_API_BASE?: string;
  AI_MODEL?: string;
}

interface SummaryRow {
  week_start: string;
  week_end: string;
  category: string;
  label: string;
  icon: string;
  title: string;
  summary: string;
  sources: string;
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

function computeWeekEnd(weekStart: string): string {
  const d = new Date(weekStart + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().slice(0, 10);
}

// ── API 处理 ──────────────────────────────────────────

async function handleLatest(env: Env): Promise<Response> {
  const result = await env.DB.prepare(
    'SELECT DISTINCT week_start FROM summaries ORDER BY week_start DESC LIMIT 1'
  ).first<{ week_start: string }>();

  if (!result) return json({ categories: [] }, 200);

  return handleWeekly(result.week_start, env);
}

async function handleWeekly(week: string, env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT * FROM summaries WHERE week_start = ? ORDER BY id'
  ).bind(week).all<SummaryRow>();

  if (!results || results.length === 0) {
    return json({ error: `未找到 ${week} 这周的总结` }, 404);
  }

  const weekEnd = results[0].week_end;

  const categoryMap = new Map<string, {
    category: string;
    label: string;
    icon: string;
    items: { title: string; summary: string; sources: { name: string; url: string }[] }[];
  }>();

  for (const row of results) {
    if (!categoryMap.has(row.category)) {
      categoryMap.set(row.category, {
        category: row.category,
        label: row.label,
        icon: row.icon,
        items: [],
      });
    }
    categoryMap.get(row.category)!.items.push({
      title: row.title,
      summary: row.summary,
      sources: JSON.parse(row.sources),
    });
  }

  return json({
    week_start: week,
    week_end: weekEnd,
    categories: [...categoryMap.values()],
  });
}

// ── 定时任务：抓取 + 总结 + 存储 ──────────────────────

async function runScheduled(env: Env): Promise<void> {
  console.log('[cron] 开始抓取 RSS 源...');
  const categories = await fetchAllFeeds();
  console.log(`[cron] 抓取完成，共 ${categories.length} 个领域有数据`);

  const weekStart = new Date();
  const day = weekStart.getUTCDay();
  const diff = weekStart.getUTCDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(Date.UTC(weekStart.getUTCFullYear(), weekStart.getUTCMonth(), diff));
  const sunday = new Date(monday);
  sunday.setUTCDate(sunday.getUTCDate() + 6);
  sunday.setUTCHours(23, 59, 59, 999);

  const weekStartStr = monday.toISOString().slice(0, 10);
  const weekEndStr = sunday.toISOString().slice(0, 10);

  // 先清除本周旧数据
  await env.DB.prepare('DELETE FROM summaries WHERE week_start = ?')
    .bind(weekStartStr)
    .run();

  const stmt = env.DB.prepare(
    'INSERT INTO summaries (week_start, week_end, category, label, icon, title, summary, sources) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );

  // 批量插入
  const batch: D1PreparedStatement[] = [];

  for (const cat of categories) {
    console.log(`[cron] AI 总结中: ${cat.label} (${cat.items.length} 条)`);

    let summarized: SummarizedItem[];
    try {
      summarized = await summarizeCategory(cat, env);
    } catch (err) {
      console.error(`[cron] ${cat.label} AI 总结失败:`, err);
      summarized = [
        {
          title: `${cat.label}本周热点`,
          summary: `本周共抓取到 ${cat.items.length} 条${cat.label}相关新闻，AI 总结暂时不可用。`,
          sources: cat.items.slice(0, 3).map((item) => ({
            name: extractSourceFromDesc(item.description),
            url: item.link,
          })),
        },
      ];
    }

    for (const item of summarized) {
      batch.push(
        stmt.bind(
          weekStartStr,
          weekEndStr,
          cat.category,
          cat.label,
          cat.icon,
          item.title,
          item.summary,
          JSON.stringify(item.sources)
        )
      );
    }
  }

  if (batch.length > 0) {
    await env.DB.batch(batch);
    console.log(`[cron] 成功写入 ${batch.length} 条总结`);
  }

  console.log('[cron] 完成');
}

function extractSourceFromDesc(description: string): string {
  const m = description.match(/\[来源:\s*([^\]]+)\]/);
  return m ? m[1] : '新闻源';
}

// ── 主入口 ────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const path = url.pathname;

    try {
      if (path === '/api/latest') {
        return handleLatest(env);
      }

      if (path === '/api/weekly') {
        const week = url.searchParams.get('week');
        if (!week || !/^\d{4}-\d{2}-\d{2}$/.test(week)) {
          return json({ error: '参数 week 格式应为 YYYY-MM-DD' }, 400);
        }
        return handleWeekly(week, env);
      }

      if (path === '/api/refresh') {
        ctx.waitUntil(runScheduled(env));
        return json({ ok: true, message: '正在抓取并总结，约 30 秒后刷新此页面' });
      }

      return json({ error: 'Not Found' }, 404);
    } catch (err) {
      console.error('[api] 错误:', err);
      return json({ error: '服务器内部错误' }, 500);
    }
  },

  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    try {
      await runScheduled(env);
    } catch (err) {
      console.error('[cron] 致命错误:', err);
    }
  },
};
