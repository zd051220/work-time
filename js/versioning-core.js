(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.VersioningCore = api;
})(typeof globalThis !== 'undefined' ? globalThis :
   (typeof self !== 'undefined' ? self : this), function () {
  'use strict';

  var SEMVER_RE = /^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-((?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)(?:\\.(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\\+([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?$/;
  var LEGACY_RE = /^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)$/;

  // Compare non-negative decimal strings without Number/BigInt precision loss.
  function compareDecimalStrings(a, b) {
    a = String(a);
    b = String(b);
    if (a.length !== b.length) return a.length < b.length ? -1 : 1;
    return a < b ? -1 : a > b ? 1 : 0;
  }
  function incrementDecimalString(value) {
    if (typeof value !== 'string' || !/^(0|[1-9]\\d*)$/.test(value)) {
      throw new TypeError('版本数字必须是非负规范十进制字符串');
    }
    var digits = value.split('');
    for (var i = digits.length - 1; i >= 0; i--) {
      if (digits[i] !== '9') {
        digits[i] = String(Number(digits[i]) + 1);
        return digits.join('');
      }
      digits[i] = '0';
    }
    return '1' + digits.join('');
  }
  function parseSemVer(input) {
    if (typeof input !== 'string') throw new TypeError('版本号必须是字符串');
    var m = SEMVER_RE.exec(input);
    if (!m) throw new Error('无效的 SemVer 版本号：' + input);
    return {
      major: m[1], minor: m[2], patch: m[3],
      prerelease: m[4] ? m[4].split('.') : [],
      build: m[5] ? m[5].split('.') : [],
      raw: input
    };
  }
  function parseRuntimeVersion(input) {
    if (typeof input !== 'string') throw new TypeError('运行时版本号必须是字符串');
    if (LEGACY_RE.test(input)) return Object.assign({}, parseSemVer(input + '.0'), {legacy:true, sourceVersion:input});
    return Object.assign({}, parseSemVer(input), {legacy:false, sourceVersion:input});
  }
  function compareIdentifiers(a, b) {
    var an = /^\\d+$/.test(a), bn = /^\\d+$/.test(b);
    if (an && bn) return compareDecimalStrings(a, b);
    if (an !== bn) return an ? -1 : 1;
    return a < b ? -1 : a > b ? 1 : 0;
  }
  function compareSemVer(left, right) {
    var a = typeof left === 'string' ? parseRuntimeVersion(left) : left;
    var b = typeof right === 'string' ? parseRuntimeVersion(right) : right;
    var keys = ['major', 'minor', 'patch'];
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var coreComparison = compareDecimalStrings(a[key], b[key]);
      if (coreComparison) return coreComparison;
    }
    var ap = a.prerelease || [], bp = b.prerelease || [];
    if (!ap.length && !bp.length) return 0;
    if (!ap.length) return 1;
    if (!bp.length) return -1;
    for (var j = 0; j < Math.max(ap.length, bp.length); j++) {
      if (j >= ap.length) return -1;
      if (j >= bp.length) return 1;
      var c = compareIdentifiers(ap[j], bp[j]);
      if (c) return c;
    }
    return 0;
  }
  function validateVersionConfig(config) {
    var errors = [];
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      return {valid:false, errors:['version.json 必须是 JSON 对象']};
    }
    var parsed;
    try { parsed = parseRuntimeVersion(config.version); }
    catch (e) { errors.push(e.message); }
    if (typeof config.url !== 'string' || !config.url.trim()) {
      errors.push('url 必须是非空相对路径字符串');
    } else {
      if (config.url !== config.url.trim()) errors.push('url 不能包含首尾空白字符');
      var url = config.url;
      if (url.charAt(0) === '/' || url.indexOf('\\\\') !== -1 ||
          url.indexOf('?') !== -1 || url.indexOf('#') !== -1 ||
          /^[A-Za-z][A-Za-z0-9+.-]*:/.test(url) ||
          url.split('/').some(function (p) { return p === '..' || p === '.' || !p; })) {
        errors.push('url 必须是站点内安全相对路径，不能包含协议、根路径、路径穿越或空路径段');
      }
      if (!/^[A-Za-z0-9._/-]+$/.test(url)) errors.push('url 只能包含字母、数字、点、下划线、斜杠和连字符');
      if (!url.toLowerCase().endsWith('.html')) errors.push('url 必须指向 .html 页面');
    }
    if (typeof config.note !== 'string' || config.note.length > 500) errors.push('note 必须是字符串，且不超过 500 个字符');
    return {
      valid:errors.length === 0,
      errors:errors,
      normalizedVersion:parsed ? parsed.major+'.'+parsed.minor+'.'+parsed.patch+(parsed.prerelease.length?'-'+parsed.prerelease.join('.'):'') : null,
      legacyVersion:Boolean(parsed && parsed.legacy)
    };
  }
  return Object.freeze({
    parseSemVer:parseSemVer,
    parseRuntimeVersion:parseRuntimeVersion,
    compareSemVer:compareSemVer,
    incrementDecimalString:incrementDecimalString,
    validateVersionConfig:validateVersionConfig
  });
});
