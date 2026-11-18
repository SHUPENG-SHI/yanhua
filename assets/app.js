// 顾客端：选品、计价、赠送、库存提醒、提交
(function () {
  'use strict';

  var U = window.Util;
  var state = { products: [], cart: new Map(), keyword: '', giftOpen: {}, cached: false };

  var dom = {
    products: document.getElementById('products'),
    search: document.getElementById('search'),
    pickedCount: document.getElementById('pickedCount'),
    pickedList: document.getElementById('pickedList'),
    discount: document.getElementById('discount'),
    discountHint: document.getElementById('discountHint'),
    name: document.getElementById('name'),
    note: document.getElementById('note'),
    sumSubtotal: document.getElementById('sumSubtotal'),
    sumDiscount: document.getElementById('sumDiscount'),
    sumFinal: document.getElementById('sumFinal'),
    submitBtn: document.getElementById('submitBtn'),
    barCount: document.getElementById('barCount'),
    barTotal: document.getElementById('barTotal'),
    goCheckout: document.getElementById('goCheckout'),
    checkout: document.getElementById('checkout'),
    mask: document.getElementById('successMask'),
    okPrice: document.getElementById('okPrice'),
    okId: document.getElementById('okId'),
    okName: document.getElementById('okName'),
    okTime: document.getElementById('okTime'),
    okClose: document.getElementById('okClose'),
    toast: document.getElementById('toast'),
    demoTip: document.getElementById('demoTip')
  };

  function toast(msg) {
    dom.toast.textContent = msg;
    dom.toast.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { dom.toast.classList.remove('show'); }, 2200);
  }

  function get(id) {
    return state.products.find(function (p) { return String(p.id) === String(id); });
  }

  function cartOf(id) {
    var key = String(id);
    if (!state.cart.has(key)) state.cart.set(key, { qty: 0, gift: 0 });
    return state.cart.get(key);
  }

  function stars(r) {
    var html = '';
    for (var i = 1; i <= 3; i++) {
      if (r >= i) html += '<span class="star on">★</span>';
      else if (r >= i - 0.5) html += '<span class="star half">★</span>';
      else html += '<span class="star">★</span>';
    }
    return '<span class="stars">' + html + '</span>';
  }

  function cardHtml(p) {
    var c = cartOf(p.id);
    var stockCls = p.stock <= 0 ? 'out' : (p.stock < 5 ? 'low' : '');
    var stockTxt = p.stock <= 0 ? '已售罄' : (p.stock < 5 ? '仅剩 ' + p.stock : '库存 ' + p.stock);
    var open = !!state.giftOpen[p.id];

    return '' +
      '<article class="card" data-id="' + p.id + '">' +
        '<div class="card-top">' +
          '<div class="idx">' + p.seq + '</div>' +
          '<div class="card-info">' +
            '<div class="card-name">' + U.esc(p.name) + '</div>' +
            '<div class="card-meta">' + stars(p.rating) + '<span>' + U.esc(p.unit) + '</span></div>' +
          '</div>' +
          '<div class="price">' + U.money(p.price) + '</div>' +
        '</div>' +
        '<div class="stock-row"><span class="badge ' + stockCls + '">' + stockTxt + '</span></div>' +
        '<div class="ctrl">' +
          '<div class="stepper">' +
            '<button type="button" class="minus" aria-label="减少">−</button>' +
            '<input class="qty" type="number" inputmode="numeric" min="0" step="1" value="' + c.qty + '">' +
            '<button type="button" class="plus" aria-label="增加">+</button>' +
          '</div>' +
          '<button type="button" class="gift-toggle' + (open ? ' on' : '') + '">赠送</button>' +
        '</div>' +
        '<div class="gift-row" ' + (open ? '' : 'hidden') + '>' +
          '另外赠送 <input class="gift" type="number" inputmode="numeric" min="0" step="1" value="' + c.gift + '"> ' +
          U.esc(unitShort(p.unit)) +
        '</div>' +
        '<div class="warn"></div>' +
      '</article>';
  }

  function unitShort(unit) {
    // 只取单位里的主量词，如「条（10小盒）」-> 条
    return String(unit || '').replace(/[（(].*$/, '') || '件';
  }

  function renderProducts() {
    var kw = state.keyword.trim().toLowerCase();
    var list = state.products.filter(function (p) {
      return !kw || p.name.toLowerCase().indexOf(kw) >= 0 || String(p.seq) === kw;
    });
    var notice = state.cached
      ? '<div class="empty" style="padding:6px 0 14px;color:#b26a00">网络不稳定，当前显示的是上次加载的品类和价格<br>' +
        '<button class="btn small ghost" id="retryBtn" type="button" style="margin-top:8px">重新加载</button></div>'
      : '';
    dom.products.innerHTML = notice + (list.length ? list.map(cardHtml).join('') : '<div class="empty">没有找到相关品类</div>');
  }

  function computeTotals() {
    var count = 0, sub = 0;
    state.cart.forEach(function (c, id) {
      var p = get(id);
      if (!p) return;
      count += c.qty + c.gift;
      sub += p.price * c.qty;
    });
    var discount = Math.max(0, parseFloat(dom.discount.value) || 0);
    return { count: count, subtotal: Math.round(sub * 100) / 100, discount: discount, final: Math.round((sub - discount) * 100) / 100 };
  }

  function renderPicked() {
    var rows = [];
    state.cart.forEach(function (c, id) {
      var p = get(id);
      if (!p || c.qty <= 0) return;
      rows.push(
        '<div class="picked-item" data-id="' + p.id + '">' +
          '<span class="nm">' + U.esc(p.name) + ' <span class="qty-txt">×' + c.qty +
          (c.gift > 0 ? ' <span class="badge gift">赠送 ×' + c.gift + '</span>' : '') + '</span></span>' +
          '<span class="amt">' + U.money(p.price * c.qty) + '</span>' +
          '<button type="button" class="del" data-del="' + p.id + '">×</button>' +
        '</div>'
      );
    });
    dom.pickedList.innerHTML = rows.length ? rows.join('') :
      '<div class="picked-empty">还没有选择商品，点上面的「+」添加数量</div>';
  }

  function syncWarnings() {
    state.products.forEach(function (p) {
      var card = dom.products.querySelector('.card[data-id="' + p.id + '"]');
      if (!card) return;
      var c = cartOf(p.id);
      var q = c.qty + c.gift;
      card.classList.toggle('picked', q > 0);

      var msg = '', cls = '';
      if (q > p.stock) {
        msg = '超出库存 ' + (q - p.stock) + ' 个，请核实数量';
        cls = 'red';
      } else if (p.stock <= 0) {
        msg = '已售罄，仍可提交，提交时会提示核实';
        cls = 'yellow';
      } else if (p.stock < 5) {
        msg = '库存紧张，请核实数量';
        cls = 'yellow';
      }
      var warn = card.querySelector('.warn');
      warn.textContent = msg;
      warn.className = 'warn' + (msg ? ' show ' + cls : '');

      var badge = card.querySelector('.badge');
      if (badge) {
        badge.className = 'badge ' + (p.stock <= 0 ? 'out' : (p.stock < 5 ? 'low' : ''));
        badge.textContent = p.stock <= 0 ? '已售罄' : (p.stock < 5 ? '仅剩 ' + p.stock : '库存 ' + p.stock);
      }
    });
  }

  function syncUI() {
    var t = computeTotals();
    syncWarnings();
    renderPicked();

    dom.sumSubtotal.textContent = U.money(t.subtotal);
    dom.sumDiscount.textContent = '-' + U.money(t.discount);
    dom.sumFinal.textContent = U.money(t.final);
    dom.pickedCount.textContent = '已选 ' + t.count + ' 件';
    dom.barCount.textContent = '已选 ' + t.count + ' 件';
    dom.barTotal.textContent = U.money(t.final);

    var over = t.discount > t.subtotal;
    dom.discountHint.classList.toggle('show', over);
  }

  // ---------- 事件 ----------
  dom.products.addEventListener('click', function (e) {
    var card = e.target.closest('.card');
    if (!card) return;
    var id = card.dataset.id;
    var c = cartOf(id);

    if (e.target.classList.contains('plus')) {
      c.qty += 1;
      card.querySelector('.qty').value = c.qty;
      syncUI();
    } else if (e.target.classList.contains('minus')) {
      c.qty = Math.max(0, c.qty - 1);
      card.querySelector('.qty').value = c.qty;
      syncUI();
    } else if (e.target.classList.contains('gift-toggle')) {
      state.giftOpen[id] = !state.giftOpen[id];
      e.target.classList.toggle('on', state.giftOpen[id]);
      var row = card.querySelector('.gift-row');
      row.hidden = !state.giftOpen[id];
      if (!state.giftOpen[id]) {
        c.gift = 0;
        card.querySelector('.gift').value = 0;
      }
      syncUI();
    }
  });

  dom.products.addEventListener('input', function (e) {
    var card = e.target.closest('.card');
    if (!card) return;
    var c = cartOf(card.dataset.id);
    var v = parseInt(e.target.value, 10);
    v = isNaN(v) ? 0 : Math.max(0, v);

    if (e.target.classList.contains('qty')) {
      c.qty = v;
    } else if (e.target.classList.contains('gift')) {
      c.gift = v;
    } else {
      return;
    }
    syncUI();
  });

  dom.products.addEventListener('blur', function (e) {
    if (e.target.classList.contains('qty') || e.target.classList.contains('gift')) {
      if (e.target.value === '') e.target.value = 0;
    }
  }, true);

  dom.pickedList.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-del]');
    if (!btn) return;
    var id = btn.dataset.del;
    var c = cartOf(id);
    c.qty = 0;
    c.gift = 0;
    var card = dom.products.querySelector('.card[data-id="' + id + '"]');
    if (card) {
      card.querySelector('.qty').value = 0;
      card.querySelector('.gift').value = 0;
    }
    syncUI();
  });

  dom.search.addEventListener('input', function () {
    state.keyword = dom.search.value;
    renderProducts();
    syncWarnings();
  });

  dom.discount.addEventListener('input', syncUI);

  dom.goCheckout.addEventListener('click', function () {
    dom.checkout.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  dom.submitBtn.addEventListener('click', function () {
    var name = dom.name.value.trim();
    if (!name) {
      toast('请填写姓名');
      dom.name.focus();
      return;
    }

    var items = [];
    state.cart.forEach(function (c, id) {
      if (c.qty + c.gift <= 0) return;
      items.push({ productId: get(id).id, qty: c.qty, giftQty: c.gift });
    });
    if (!items.length) {
      toast('请先选择商品');
      dom.checkout.scrollIntoView({ behavior: 'smooth' });
      return;
    }

    var over = items.filter(function (it) {
      var p = get(it.productId);
      return p && it.qty + it.giftQty > p.stock;
    });
    if (over.length && !confirm('有 ' + over.length + ' 项超出库存，请核实数量后确认提交？')) return;

    var t = computeTotals();
    dom.submitBtn.disabled = true;
    dom.submitBtn.textContent = '提交中…';

    Store.createOrder({
      name: name,
      note: dom.note.value.trim(),
      discount: t.discount,
      subtotal: t.subtotal,
      items: items
    }).then(function (order) {
      dom.okPrice.textContent = U.money(order.final_price != null ? order.final_price : t.final);
      dom.okId.textContent = String(order.id).slice(0, 8).toUpperCase();
      dom.okName.textContent = name;
      dom.okTime.textContent = U.fmtTime(order.created_at || new Date().toISOString());
      dom.mask.hidden = false;

      state.cart.clear();
      state.giftOpen = {};
      dom.discount.value = 0;
      dom.name.value = '';
      dom.note.value = '';
      return loadProducts();
    }).catch(function (err) {
      console.error(err);
      toast('提交失败：' + (err.message || '请稍后重试'));
    }).then(function () {
      dom.submitBtn.disabled = false;
      dom.submitBtn.textContent = '提交订单';
    });
  });

  dom.okClose.addEventListener('click', function () {
    dom.mask.hidden = true;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // ---------- 初始化 ----------
  function retry(fn, times, delay) {
    return fn().catch(function (err) {
      if (times <= 0) throw err;
      return new Promise(function (resolve) { setTimeout(resolve, delay); })
        .then(function () { return retry(fn, times - 1, delay * 2); });
    });
  }

  function loadProducts() {
    return retry(function () { return Store.getProducts(); }, 2, 800).then(function (list) {
      state.products = list.map(function (p) { return Object.assign({}, p, { price: Number(p.price) }); });
      state.cached = false;
      try { localStorage.setItem('fw_products_cache', JSON.stringify(list)); } catch (e) { /* 忽略 */ }
      renderProducts();
      syncUI();
    });
  }

  function readCache() {
    try {
      var c = JSON.parse(localStorage.getItem('fw_products_cache') || 'null');
      return Array.isArray(c) && c.length ? c : null;
    } catch (e) { return null; }
  }

  function showLoadError(err) {
    console.error(err);
    var cached = readCache();
    if (cached) {
      state.products = cached.map(function (p) { return Object.assign({}, p, { price: Number(p.price) }); });
      state.cached = true;
      renderProducts();
      syncUI();
      return;
    }
    var msg = (err && err.message) || String(err);
    var friendly = /fetch|network|timeout|load failed/i.test(msg)
      ? '网络连不上服务器，可能是手机网络不稳定。点下面「重新加载」，或在微信里点右上角改用系统浏览器打开。'
      : msg;
    dom.products.innerHTML = '<div class="empty">加载失败：' + U.esc(friendly) +
      '<br><button class="btn small ghost" id="retryBtn" type="button" style="margin-top:12px">重新加载</button></div>';
  }

  document.addEventListener('click', function (e) {
    if (e.target && e.target.id === 'retryBtn') {
      dom.products.innerHTML = '<div class="empty">加载中…</div>';
      loadProducts().catch(showLoadError);
    }
  });

  if (Store.isDemo()) dom.demoTip.hidden = false;

  Store.ready().then(loadProducts).catch(showLoadError);
})();
