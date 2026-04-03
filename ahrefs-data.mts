const AHREFS_BASE = 'https://api.ahrefs.com/v3';

async function ahrefsGet(path: string, params: Record<string, string>) {
  const url = new URL(`${AHREFS_BASE}/${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }
  const apiKey = Netlify.env.get('AHREFS_API_KEY');
  const res = await fetch(url.toString(), {
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' }
  });
  if (!res.ok) {
    console.error(`Ahrefs ${path}: ${res.status}`);
    return null;
  }
  return res.json();
}

async function safeFetch(path: string, params: Record<string, string>) {
  try { return await ahrefsGet(path, params); }
  catch (e: any) { console.error(`Error ${path}:`, e.message); return null; }
}

function today() { return new Date().toISOString().split('T')[0]; }

export default async (req: Request) => {
  const url = new URL(req.url);
  const domain = url.searchParams.get('domain');
  const brand = url.searchParams.get('brand') || domain || '';
  const competitors = url.searchParams.get('competitors') || '';

  if (!domain) {
    return new Response(JSON.stringify({ error: 'domain parameter required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' }
    });
  }

  const apiKey = Netlify.env.get('AHREFS_API_KEY');
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'AHREFS_API_KEY not configured' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }

  const date = today();
  const [drData, metricsData, backlinksData, topPagesData, competitorsData,
    mentionsAiMode, mentionsAio, mentionsGemini, mentionsCopilot, mentionsPerplexity, mentionsChatgpt
  ] = await Promise.all([
    safeFetch('site-explorer/domain-rating', { target: domain, date }),
    safeFetch('site-explorer/metrics', { target: domain, date, country: 'us', mode: 'subdomains' }),
    safeFetch('site-explorer/backlinks-stats', { target: domain, date, mode: 'subdomains' }),
    safeFetch('site-explorer/top-pages', { target: domain, date, country: 'us', mode: 'subdomains', select: 'url,sum_traffic,keywords,top_keyword,top_keyword_volume', order_by: 'sum_traffic:desc', limit: '10' }),
    safeFetch('site-explorer/organic-competitors', { target: domain, date, country: 'us', mode: 'subdomains', select: 'competitor_domain,keywords_common,domain_rating,traffic', order_by: 'keywords_common:desc', limit: '5' }),
    safeFetch('brand-radar/mentions-overview', { brand, data_source: 'google_ai_mode', select: 'brand,total' }),
    safeFetch('brand-radar/mentions-overview', { brand, data_source: 'google_ai_overviews', select: 'brand,total' }),
    safeFetch('brand-radar/mentions-overview', { brand, data_source: 'gemini', select: 'brand,total' }),
    safeFetch('brand-radar/mentions-overview', { brand, data_source: 'copilot', select: 'brand,total' }),
    safeFetch('brand-radar/mentions-overview', { brand, data_source: 'perplexity', select: 'brand,total' }),
    safeFetch('brand-radar/mentions-overview', { brand, data_source: 'chatgpt', select: 'brand,total' }),
  ]);

  let competitorMentions = null;
  if (competitors) {
    const [cc, ca, cm] = await Promise.all([
      safeFetch('brand-radar/mentions-overview', { brand, competitors, data_source: 'chatgpt', select: 'brand,total' }),
      safeFetch('brand-radar/mentions-overview', { brand, competitors, data_source: 'google_ai_overviews', select: 'brand,total' }),
      safeFetch('brand-radar/mentions-overview', { brand, competitors, data_source: 'google_ai_mode', select: 'brand,total' }),
    ]);
    if (cc || ca || cm) competitorMentions = { chatgpt: cc, aio: ca, aiMode: cm };
  }

  const gm = (d: any) => d?.metrics?.[0]?.total || 0;
  const result = {
    domain, brand, date,
    seo: {
      domainRating: drData?.domain_rating?.domain_rating || 0,
      ahrefsRank: drData?.domain_rating?.ahrefs_rank || null,
      orgTraffic: metricsData?.metrics?.org_traffic || 0,
      orgKeywords: metricsData?.metrics?.org_keywords || 0,
      orgKeywords1to3: metricsData?.metrics?.org_keywords_1_3 || 0,
      orgCost: metricsData?.metrics?.org_cost || 0,
      liveBacklinks: backlinksData?.metrics?.live || 0,
      liveRefdomains: backlinksData?.metrics?.live_refdomains || 0,
      allTimeBacklinks: backlinksData?.metrics?.all_time || 0,
      allTimeRefdomains: backlinksData?.metrics?.all_time_refdomains || 0,
    },
    topPages: (topPagesData?.pages || []).map((p: any) => ({ url: p.url, traffic: p.sum_traffic, keywords: p.keywords, topKeyword: p.top_keyword, topKeywordVolume: p.top_keyword_volume })),
    organicCompetitors: (competitorsData?.competitors || []).map((c: any) => ({ domain: c.competitor_domain, commonKeywords: c.keywords_common, dr: c.domain_rating, traffic: c.traffic })),
    aiMentions: { aiMode: gm(mentionsAiMode), aio: gm(mentionsAio), gemini: gm(mentionsGemini), copilot: gm(mentionsCopilot), perplexity: gm(mentionsPerplexity), chatgpt: gm(mentionsChatgpt) },
    competitorMentions,
  };
  result.aiMentions.total = Object.values(result.aiMentions).reduce((a: number, b) => (typeof b === 'number' ? a + b : a), 0);

  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json' }
  });
};

export const config = {
  path: "/api/ahrefs-data"
};
