// 公共小工具
window.Util = (function () {
  'use strict';

  function cnParts(iso) {
    var d = new Date(iso);
    var f = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
    });
    var p = {};
    f.formatToParts(d).forEach(function (x) { p[x.type] = x.value; });
    return {
      y: p.year, mo: p.month, d: p.day,
      h: p.hour === '24' ? '00' : p.hour, mi: p.minute
    };
  }

  function fmtTime(iso) {
    var t = cnParts(iso);
    return t.y + '.' + t.mo + '.' + t.d + ' ' + t.h + ':' + t.mi;
  }

  function fmtDate(iso) {
    var t = cnParts(iso);
    return t.y + '-' + t.mo + '-' + t.d;
  }

  // 导出文件名：2025.12.12.11.00明细（史书朋）.xlsx
  function fileName(name, iso) {
    var t = cnParts(iso);
    var safe = String(name || '').replace(/[\\/:*?"<>|]/g, '').trim();
    return t.y + '.' + t.mo + '.' + t.d + '.' + t.h + '.' + t.mi + '明细（' + safe + '）.xlsx';
  }

  function money(n) {
    var v = Math.round((Number(n) || 0) * 100) / 100;
    return '¥' + v.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  }

  function num(n) {
    var v = Math.round((Number(n) || 0) * 100) / 100;
    return v.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  }

  function round2(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  return {
    cnParts: cnParts,
    fmtTime: fmtTime,
    fmtDate: fmtDate,
    fileName: fileName,
    money: money,
    num: num,
    round2: round2,
    esc: esc
  };
})();
