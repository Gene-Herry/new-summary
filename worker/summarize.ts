import type { CategoryItems, FeedItem } from './feeds';

export interface SummarizedItem {
  title: string;
  summary: string;
  sources: { name: string; url: string }[];
}

interface Env {
  AI_API_KEY: string;
  AI_API_BASE?: string;
  AI_MODEL?: string;
}

function getAIConfig(env: Env) {
  const base = (env.AI_API_BASE || 'https://api.deepseek.com').replace(/\/$/, '');
  const isDeepSeek = base.includes('deepseek');
  return {
    base,
    model: env.AI_MODEL || (isDeepSeek ? 'deepseek-chat' : 'gpt-4o-mini'),
    isDeepSeek,
  };
}

function buildPrompt(cat: CategoryItems): string {
  const headlines = cat.items.map((item, i) =>
    `${i + 1}. [${extractSource(item.description)}] ${item.title}`
  ).join('\n');

  return `以下是本周「${cat.label}」领域的英文热点新闻标题。请用中文总结出 3~5 条最重要的趋势或事件。

要求：
1. 每条总结包含一个 title（简要概括，20字以内）和一个 summary（2-3句话说明背景和影响）
2. 跳过重复或琐碎的新闻，只保留有影响力的
3. 严格输出 JSON 数组格式，结构为 [{"title":"...","summary":"..."}]
4. 不要输出其他内容

热点标题：
${headlines}`;
}

function extractSource(description: string): string {
  const m = description.match(/\[来源:\s*([^\]]+)\]/);
  return m ? m[1] : '未知来源';
}

function buildSourceMap(cat: CategoryItems): Map<string, { name: string; url: string }> {
  const map = new Map<string, { name: string; url: string }>();
  for (const item of cat.items) {
    const srcName = extractSource(item.description);
    if (!map.has(srcName)) {
      map.set(srcName, { name: srcName, url: item.link });
    }
  }
  return map;
}

function matchSource(summaryTitle: string, sourceMap: Map<string, { name: string; url: string }>): { name: string; url: string }[] {
  const sources: { name: string; url: string }[] = [];
  for (const [name, info] of sourceMap) {
    if (summaryTitle.includes(name) || name.includes('未知')) {
      sources.push(info);
    }
  }
  if (sources.length === 0 && sourceMap.size > 0) {
    const first = [...sourceMap.values()][0];
    sources.push(first);
  }
  return sources;
}

export async function summarizeCategory(
  cat: CategoryItems,
  env: Env
): Promise<SummarizedItem[]> {
  const { base, model, isDeepSeek } = getAIConfig(env);
  const prompt = buildPrompt(cat);
  const sourceMap = buildSourceMap(cat);

  const body: Record<string, unknown> = {
    model,
    messages: [
      {
        role: 'system',
        content: '你是一个专业的新闻编辑，擅长从大量信息中提炼核心要点。请始终用中文回复，严格输出 JSON 格式。',
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0.3,
    max_tokens: 2048,
  };

  if (!isDeepSeek) {
    body.response_format = { type: 'json_object' };
  }

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.AI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`AI API error (${res.status}): ${err.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    choices: [{ message: { content: string } }];
  };

  const raw = data.choices[0]?.message?.content || '[]';
  const jsonStr = raw.replace(/```json|```/g, '').trim();

  let parsed: { title: string; summary: string }[];
  try {
    const decoded = JSON.parse(jsonStr);
    if (Array.isArray(decoded)) {
      parsed = decoded;
    } else if (decoded && typeof decoded === 'object') {
      parsed = (decoded as Record<string, unknown>).items as typeof parsed
            || (decoded as Record<string, unknown>).summaries as typeof parsed
            || [];
    } else {
      parsed = [];
    }
  } catch {
    parsed = [{ title: '本周热点', summary: raw.slice(0, 300) }];
  }

  return parsed.map((item) => ({
    title: item.title,
    summary: item.summary,
    sources: matchSource(item.title, sourceMap),
  }));
}
