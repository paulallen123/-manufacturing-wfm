'use strict';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const PATCH_MARK = Symbol.for('wfm.hostedListenGuard');

function installHostedListenGuard(httpModule, options = {}) {
  if (!options.hosted) return false;
  const proto = httpModule?.Server?.prototype;
  if (!proto || typeof proto.listen !== 'function') {
    throw new Error('HTTP Server.listen is unavailable.');
  }
  if (proto[PATCH_MARK]) return false;

  const originalListen = proto.listen;
  Object.defineProperty(proto, PATCH_MARK, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });

  proto.listen = function hostedListenGuard(...args) {
    if (typeof args[0] === 'number') {
      if (typeof args[1] === 'string' && LOOPBACK_HOSTS.has(args[1].toLowerCase())) {
        args[1] = '0.0.0.0';
      }
    } else if (args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])) {
      const opts = { ...args[0] };
      if (typeof opts.host === 'string' && LOOPBACK_HOSTS.has(opts.host.toLowerCase())) {
        opts.host = '0.0.0.0';
      }
      args[0] = opts;
    }
    return originalListen.apply(this, args);
  };

  return true;
}

module.exports = { installHostedListenGuard, LOOPBACK_HOSTS };
