exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };
  const qs = event.queryStringParameters || {};
  const domain = qs.domain;
  const brand = qs.brand || domain;
  const competitors = qs.competitors || '';
  if (!domain) return { statusCode: 400, headers, body: JSON.stringify({ error: 'domain required' }) };

  const API_KEY = process.env.AHREFS_API_KEY;
  if (!API_KEY) return { statusCode: 500, headers, body: JSON.stringify({ error: 'AHREFS_API_KEY not configured' }) };

  const BASE = 'https://api.ahrefs.com/v3';
  const date = new Date().toISOString().split('T')[0];

  async function get(path, params) {
    try {
      const url = new URL(BASE + '/' + path);
      Object.entries(params).forEach(([k,v]) => { if (v) url.searchParams.set(k, v); });
      const r = await fetch(url.toString(), { headers: { 'Authorization': 'Bearer ' + API_KEY, 'Accept': 'application/json' } });
      if (!r.ok) { console.error(path, r.status); return null; }
      return r.json();
    } catch(e) { console.error(path, e.message); return null; }
  }

  const [dr, met, bl, tp, oc, mAM, mAO, mGe, mCo, mPe, mGP] = await Promise.all([
    get('site-explorer/domain-rating', { target: domain, date }),
    get('site-explorer/metrics', { target: domain, date, country: 'us', mode: 'subdomains' }),
    get('site-explorer/backlinks-stats', { target: domain, date, mode: 'subdomains' }),
    get('site-explorer/top-pages', { target: domain, date, country: 'us', mode: 'subdomains', select: 'url,sum_traffic,keywords,top_keyword,top_keyword_volume', order_by: 'sum_traffic:desc', limit: '10' }),
    get('site-explorer/organic-competitors', { target: domain, date, country: 'us', mode: 'subdomains', select: 'competitor_domain,keywords_common,domain_rating,traffic', order_by: 'keywords_common:desc', limit: '5' }),
    get('brand-radar/mentions-overview', { brand, data_source: 'google_ai_mode', select: 'brand,total' }),
    get('brand-radar/mentions-overview', { brand, data_source: 'google_ai_overviews', select: 'brand,total' }),
    get('brand-radar/mentions-overview', { brand, data_source: 'gemini', select: 'brand,total' }),
    get('brand-radar/mentions-overview', { brand, data_source: 'copilot', select: 'brand,total' }),
    get('brand-radar/mentions-overview', { brand, data_source: 'perplexity', select: 'brand,total' }),
    get('brand-radar/mentions-overview', { brand, data_source: 'chatgpt', select: 'brand,total' }),
  ]);

  let competitorMentions = null;
  if (competitors) {
    const [cc, ca, cm] = await Promise.all([
      get('brand-radar/mentions-overview', { brand, competitors, data_source: 'chatgpt', select: 'brand,total' }),
      get('brand-radar/mentions-overview', { brand, competitors, data_source: 'google_ai_overviews', select: 'brand,total' }),
      get('brand-radar/mentions-overview', { brand, competitors, data_source: 'google_ai_mode', select: 'brand,total' }),
    ]);
    if (cc || ca || cm) competitorMentions = { chatgpt: cc, aio: ca, aiMode: cm };
  }

  const gm = (d) => d?.metrics?.[0]?.total || 0;
  const result = {
    domain, brand, date,
    seo: {
      domainRating: dr?.domain_rating?.domain_rating || 0,
      ahrefsRank: dr?.domain_rating?.ahrefs_rank || null,
      orgTraffic: met?.metrics?.org_traffic || 0,
      orgKeywords: met?.metrics?.org_keywords || 0,
      orgKeywords1to3: met?.metrics?.org_keywords_1_3 || 0,
      orgCost: met?.metrics?.org_cost || 0,
      liveBacklinks: bl?.metrics?.live || 0,
      liveRefdomains: bl?.metrics?.live_refdomains || 0,
      allTimeBacklinks: bl?.metrics?.all_time || 0,
      allTimeRefdomains: bl?.metrics?.all_time_refdomains || 0,
    },
    topPages: (tp?.pages || []).map(p => ({ url: p.url, traffic: p.sum_traffic, keywords: p.keywords, topKeyword: p.top_keyword, topKeywordVolume: p.top_keyword_volume })),
    organicCompetitors: (oc?.competitors || []).map(c => ({ domain: c.competitor_domain, commonKeywords: c.keywords_common, dr: c.domain_rating, traffic: c.traffic })),
    aiMentions: { aiMode: gm(mAM), aio: gm(mAO), gemini: gm(mGe), copilot: gm(mCo), perplexity: gm(mPe), chatgpt: gm(mGP) },
    competitorMentions,
  };
  result.aiMentions.total = Object.values(result.aiMentions).reduce((a, b) => (typeof b === 'number' ? a + b : a), 0);

  return { statusCode: 200, headers, body: JSON.stringify(result) };
};
