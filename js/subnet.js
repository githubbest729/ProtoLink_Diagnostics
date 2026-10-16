/* ProtoLink Diagnostics — js/subnet.js
 * IPv4 subnet / CIDR math. Pure functions using unsigned 32-bit arithmetic.
 */
(function (g) {
  'use strict';
  const PL = (g.PL = g.PL || {});

  function parseIPv4(s) {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(s).trim());
    if (!m) return null;
    const o = m.slice(1).map(Number);
    if (o.some((x) => x > 255)) return null;
    return (((o[0] << 24) | (o[1] << 16) | (o[2] << 8) | o[3]) >>> 0);
  }
  const ipToStr = (n) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
  const maskFromPrefix = (p) => (p === 0 ? 0 : (0xffffffff << (32 - p)) >>> 0);

  /** Contiguous mask → prefix length, or null. */
  function prefixFromMask(m) {
    m = m >>> 0;
    const inv = (~m) >>> 0;
    if (((inv + 1) & inv) !== 0) return null; // inv must be 2^k - 1
    let p = 0;
    for (let i = 31; i >= 0; i--) { if ((m >>> i) & 1) p++; else break; }
    return p;
  }

  /** Accepts "192.168.1.50/24", "192.168.1.50 255.255.255.0", "192.168.1.50/255.255.255.0". */
  function parse(input) {
    const s = String(input).trim();
    if (!s) return { error: 'Enter an address with a prefix, e.g. 192.168.1.50/24.' };
    const m = /^([\d.]+)\s*(?:\/|\s)\s*([\d.]+)$/.exec(s);
    if (!m) return { error: 'Use the form 192.168.1.50/24 (or an address and a dotted mask).' };
    const ip = parseIPv4(m[1]);
    if (ip === null) return { error: `"${m[1]}" is not a valid IPv4 address (four numbers 0–255).` };
    let prefix;
    if (m[2].includes('.')) {
      const mk = parseIPv4(m[2]);
      if (mk === null) return { error: `"${m[2]}" is not a valid subnet mask.` };
      prefix = prefixFromMask(mk);
      if (prefix === null) return { error: `"${m[2]}" is not a contiguous subnet mask (ones must come first).` };
    } else {
      prefix = Number(m[2]);
      if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return { error: 'Prefix length must be a whole number 0–32.' };
    }
    return { ip, prefix };
  }

  function classify(ip) {
    const a = ip >>> 24, b = (ip >>> 16) & 255;
    if (a === 10) return 'Private (RFC 1918, 10.0.0.0/8)';
    if (a === 172 && b >= 16 && b <= 31) return 'Private (RFC 1918, 172.16.0.0/12)';
    if (a === 192 && b === 168) return 'Private (RFC 1918, 192.168.0.0/16)';
    if (a === 169 && b === 254) return 'Link-local / APIPA (169.254.0.0/16) — device failed to get an address';
    if (a === 127) return 'Loopback (127.0.0.0/8)';
    if (a === 100 && b >= 64 && b <= 127) return 'Carrier-grade NAT (100.64.0.0/10)';
    if (a >= 224 && a <= 239) return 'Multicast (224.0.0.0/4)';
    if (a >= 240) return 'Reserved';
    if (a === 0) return 'This network (0.0.0.0/8)';
    return 'Public';
  }

  /** Full calculation for ip/prefix. */
  function calc(ip, prefix) {
    const mask = maskFromPrefix(prefix);
    const network = (ip & mask) >>> 0;
    const wildcard = (~mask) >>> 0;
    const broadcast = (network | wildcard) >>> 0;
    const total = Math.pow(2, 32 - prefix);
    let first, last, usable;
    if (prefix === 32) { first = last = ip; usable = 1; }
    else if (prefix === 31) { first = network; last = broadcast; usable = 2; } // RFC 3021 point-to-point
    else { first = network + 1; last = broadcast - 1; usable = total - 2; }
    const bin = (n) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].map((x) => x.toString(2).padStart(8, '0')).join('.');
    return {
      ip, prefix, mask, wildcard, network, broadcast, first, last, total, usable,
      maskStr: ipToStr(mask), wildcardStr: ipToStr(wildcard), networkStr: ipToStr(network), broadcastStr: ipToStr(broadcast),
      firstStr: ipToStr(first), lastStr: ipToStr(last), maskBin: bin(mask), kind: classify(ip),
      note: prefix === 32 ? 'Single host route (/32).' : prefix === 31 ? 'Point-to-point link (RFC 3021): both addresses usable, no network/broadcast.' : '',
    };
  }

  const contains = (c, ip) => ((ip & c.mask) >>> 0) === c.network;

  /** Split a network into subnets of newPrefix. Returns {list, count, truncated} or {error}. */
  function split(c, newPrefix, limit) {
    if (!Number.isInteger(newPrefix) || newPrefix <= c.prefix || newPrefix > 32) return { error: `New prefix must be between /${c.prefix + 1} and /32.` };
    limit = limit || 64;
    const count = Math.pow(2, newPrefix - c.prefix);
    const size = Math.pow(2, 32 - newPrefix);
    const list = [];
    for (let i = 0; i < Math.min(count, limit); i++) {
      const net = (c.network + i * size) >>> 0;
      list.push(calc(net, newPrefix));
    }
    return { list, count, truncated: count > limit };
  }

  PL.subnet = { parseIPv4, ipToStr, maskFromPrefix, prefixFromMask, parse, calc, contains, split, classify };
})(typeof window !== 'undefined' ? window : globalThis);
