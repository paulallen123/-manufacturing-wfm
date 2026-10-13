'use strict';

const ROBOTS_BODY = 'User-agent: *\nDisallow: /\n';

function applyCrawlerBoundary(req, res, { hosted } = {}) {
  if (!hosted) return false;
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  if (String(req?.url || '').split('?')[0] !== '/robots.txt') return false;

  const method = String(req?.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD');
    res.end('Method Not Allowed');
    return true;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Length', String(Buffer.byteLength(ROBOTS_BODY)));
  res.end(method === 'HEAD' ? undefined : ROBOTS_BODY);
  return true;
}

module.exports = { applyCrawlerBoundary };
