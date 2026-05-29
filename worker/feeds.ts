export interface FeedSource {
  url: string;
  name: string;
  category: string;
  label: string;
  icon: string;
}

export interface FeedItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
}

export interface CategoryItems {
  category: string;
  label: string;
  icon: string;
  items: FeedItem[];
}

export const FEEDS: FeedSource[] = [
  // ── 科技 ──
  { url: 'https://hnrss.org/frontpage', name: 'Hacker News', category: 'tech', label: '科技', icon: '💻' },
  { url: 'https://feeds.feedburner.com/TechCrunch', name: 'TechCrunch', category: 'tech', label: '科技', icon: '💻' },
  { url: 'https://www.theverge.com/rss/index.xml', name: 'The Verge', category: 'tech', label: '科技', icon: '💻' },
  { url: 'https://feeds.arstechnica.com/arstechnica/index', name: 'Ars Technica', category: 'tech', label: '科技', icon: '💻' },

  // ── 财经 ──
  { url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114', name: 'CNBC', category: 'finance', label: '财经', icon: '📈' },
  { url: 'https://feeds.marketwatch.com/marketwatch/topstories', name: 'MarketWatch', category: 'finance', label: '财经', icon: '📈' },

  // ── 国际 ──
  { url: 'https://feeds.bbci.co.uk/news/world/rss.xml', name: 'BBC World', category: 'world', label: '国际', icon: '🌍' },
  { url: 'https://www.aljazeera.com/xml/rss/all.xml', name: 'Al Jazeera', category: 'world', label: '国际', icon: '🌍' },

  // ── 科学 ──
  { url: 'https://www.sciencedaily.com/rss/all.xml', name: 'Science Daily', category: 'science', label: '科学', icon: '🔬' },
  { url: 'https://rss.nytimes.com/services/xml/rss/nyt/Science.xml', name: 'NYT Science', category: 'science', label: '科学', icon: '🔬' },

  // ── 体育 ──
  { url: 'https://www.espn.com/espn/rss/news', name: 'ESPN', category: 'sports', label: '体育', icon: '⚽' },

  // ── 健康 ──
  { url: 'https://www.who.int/rss-feeds/news-english.xml', name: 'WHO News', category: 'health', label: '健康', icon: '🏥' },

  // ── 娱乐 ──
  { url: 'https://variety.com/feed/', name: 'Variety', category: 'entertainment', label: '娱乐', icon: '🎬' },
];

function parseRSS(xml: string): FeedItem[] {
  const items: FeedItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = extractTag(block, 'title');
    const link = extractTag(block, 'link');
    const description = stripHTML(extractTag(block, 'description'));
    const pubDate = extractTag(block, 'pubDate');

    if (title && link) {
      items.push({ title, link, description, pubDate });
    }
  }
  return items;
}

function extractTag(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = xml.match(re);
  return m ? m[1].trim() : '';
}

function stripHTML(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&[a-z]+;/gi, ' ').trim();
}

function isThisWeek(dateStr: string, weekStart: Date, weekEnd: Date): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  return d >= weekStart && d <= weekEnd;
}

function getWeekRange(): { start: Date; end: Date; startStr: string; endStr: string } {
  const now = new Date();
  const day = now.getUTCDay();
  const diff = now.getUTCDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), diff));
  const sunday = new Date(monday);
  sunday.setUTCDate(sunday.getUTCDate() + 6);
  sunday.setUTCHours(23, 59, 59, 999);

  return {
    start: monday,
    end: sunday,
    startStr: monday.toISOString().slice(0, 10),
    endStr: sunday.toISOString().slice(0, 10),
  };
}

export async function fetchAllFeeds(): Promise<CategoryItems[]> {
  const { start, end } = getWeekRange();
  const results: FeedItem[][] = await Promise.all(
    FEEDS.map(async (feed) => {
      try {
        const res = await fetch(feed.url, {
          headers: { 'User-Agent': 'NewsSummary/1.0 (+https://github.com)' },
        });
        if (!res.ok) return [];
        const xml = await res.text();
        const allItems = parseRSS(xml);
        return allItems.filter((item) => isThisWeek(item.pubDate, start, end));
      } catch {
        return [];
      }
    })
  );

  const categoryMap = new Map<string, CategoryItems>();
  for (const cat of FEEDS) {
    if (!categoryMap.has(cat.category)) {
      categoryMap.set(cat.category, {
        category: cat.category,
        label: cat.label,
        icon: cat.icon,
        items: [],
      });
    }
  }

  FEEDS.forEach((feed, i) => {
    const cat = categoryMap.get(feed.category)!;
    const labeled = results[i].map((item) => ({
      ...item,
      description: `${item.description} [来源: ${feed.name}]`,
    }));
    cat.items.push(...labeled);
  });

  return [...categoryMap.values()].filter((cat) => cat.items.length > 0);
}
