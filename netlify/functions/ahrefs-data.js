// Netlify serverless function: fetches Ahrefs data for a given domain
// Environment variable required: AHREFS_API_KEY

const AHREFS_BASE = 'https://api.ahrefs.com/v3';

async function ahrefsGet(path, params) {
  const url = new URL(`${AHREFS_BASE}/${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    headers: { 'Authorization': `Bearer ${process.env.AHREFS_API_KEY}`, 'Accept': 'application/json' }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ahrefs ${path}: ${res.status} - ${text}`);
  }
  return res.json();
}

// Get today's date in YYYY-MM-DD
function today() {
  return new Date().toISOString().split('T')[0];
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers };
  }

  const qs = event.queryStringParameters || {};
  const domain = qs.domain;
  const brand = qs.brand || domain;
  const competitors = qs.competitors || '';

  if (!domain) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'domain parameter required' }) };
  }

  if (!process.env.AHREFS_API_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'AHREFS_API_KEY not configured' }) };
  }

  const date = today();

  try {
    // Run all API calls in parallel
    const [
      drData,
      metricsData,
      backlinksData,
      topPagesData,
      competitorsData,
      mentionsAiMode,
      mentionsAio,
      mentionsGemini,
      mentionsCopilot,
      mentionsPerplexity,
      mentionsChatgpt,
    ] = await Promise.all([
      // SEO data
      ahrefsGet('site-explorer/domain-rating', { target: domain, date }),
      ahrefsGet('site-explorer/metrics', { target: domain, date, country: 'us', mode: 'subdomains' }),
      ahrefsGet('site-explorer/backlinks-stats', { target: domain, date, mode: 'subdomains' }),
      ahrefsGet('site-explorer/top-pages', {
        target: domain, date, country: 'us', mode: 'subdomains',
        select: 'url,sum_traffic,keywords,top_keyword,top_keyword_volume',
        order_by: 'sum_traffic:desc', limit: '10'
      }),
      ahrefsGet('site-explorer/organic-competitors', {
        target: domain, date, country: 'us', mode: 'subdomains',
        select: 'competitor_domain,keywords_common,domain_rating,traffic',
        order_by: 'keywords_common:desc', limit: '5'
      }),
      // Brand Radar - mentions per engine
      ahrefsGet('brand-radar/mentions-overview', { brand, data_source: 'google_ai_mode', select: 'brand,total' }),
      ahrefsGet('brand-radar/mentions-overview', { brand, data_source: 'google_ai_overviews', select: 'brand,total' }),
      ahrefsGet('brand-radar/mentions-overview', { brand, data_source: 'gemini', select: 'brand,total' }),
      ahrefsGet('brand-radar/mentions-overview', { brand, data_source: 'copilot', select: 'brand,total' }),
      ahrefsGet('brand-radar/mentions-overview', { brand, data_source: 'perplexity', select: 'brand,total' }),
      ahrefsGet('brand-radar/mentions-overview', { brand, data_source: 'chatgpt', select: 'brand,total' }),
    ]);

    // Competitor Brand Radar (if competitors provided)
    let competitorMentions = null;
    if (competitors) {
      const [compChatgpt, compAio, compAiMode] = await Promise.all([
        ahrefsGet('brand-radar/mentions-overview', { brand, competitors, data_source: 'chatgpt', select: 'brand,total' }),
        ahrefsGet('brand-radar/mentions-overview', { brand, competitors, data_source: 'google_ai_overviews', select: 'brand,total' }),
        ahrefsGet('brand-radar/mentions-overview', { brand, competitors, data_source: 'google_ai_mode', select: 'brand,total' }),
      ]);
      competitorMentions = { chatgpt: compChatgpt, aio: compAio, aiMode: compAiMode };
    }

    // Extract mention counts safely
    const getMentions = (data) => {
      const m = data?.metrics?.[0];
      return m?.total || 0;
    };

    const result = {
      domain,
      brand,
      date,
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
      topPages: (topPagesData?.pages || []).map(p => ({
        url: p.url,
        traffic: p.sum_traffic,
        keywords: p.keywords,
        topKeyword: p.top_keyword,
        topKeywordVolume: p.top_keyword_volume,
      })),
      organicCompetitors: (competitorsData?.competitors || []).map(c => ({
        domain: c.competitor_domain,
        commonKeywords: c.keywords_common,
        dr: c.domain_rating,
        traffic: c.traffic,
      })),
      aiMentions: {
        aiMode: getMentions(mentionsAiMode),
        aio: getMentions(mentionsAio),
        gemini: getMentions(mentionsGemini),
        copilot: getMentions(mentionsCopilot),
        perplexity: getMentions(mentionsPerplexity),
        chatgpt: getMentions(mentionsChatgpt),
      },
      competitorMentions,
    };

    result.aiMentions.total = Object.values(result.aiMentions).reduce((a, b) => (typeof b === 'number' ? a + b : a), 0);

    return { statusCode: 200, headers, body: JSON.stringify(result) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
