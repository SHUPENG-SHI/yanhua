// ============================================
// 数据层：自动在「Supabase 云端模式」和「本地演示模式」之间切换
// 演示模式数据存放在浏览器 localStorage，仅用于预览，不能多人共用
// ============================================
window.Store = (function () {
  'use strict';

  var CFG = window.CONFIG || {};
  var CLOUD = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY);
  var LS_KEY = 'fireworks_store_v1';
  var client = null;

  function isDemo() { return !CLOUD; }

  function round(n) { return Math.round((Number(n) || 0) * 100) / 100; }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('资源加载失败：' + src)); };
      document.head.appendChild(s);
    });
  }

  function ready() {
    if (!CLOUD) {
      // 演示模式下才加载示例商品数据（含成本，接入云端后不再加载）
      if (window.PRODUCTS) return Promise.resolve();
      // 演示数据文件已移除时不影响云端模式
      return loadScript('assets/data.js').catch(function () { return null; });
    }
    if (client) return Promise.resolve();
    var load = window.supabase ? Promise.resolve() : loadScript('assets/vendor/supabase-js.js');
    return load.then(function () {
      client = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
    });
  }

  // ---------- 演示模式存储 ----------
  function readDemo() {
    var db = null;
    try { db = JSON.parse(localStorage.getItem(LS_KEY)); } catch (e) { db = null; }
    if (!db || !db.products) {
      db = {
        products: (window.PRODUCTS || []).map(function (p, i) {
          return {
            id: i + 1, seq: p.seq, name: p.name, unit: p.unit, price: p.price, cost: p.cost,
            stock: p.stock, alert_stock: 5, rating: p.rating, active: p.active !== false
          };
        }),
        orders: []
      };
      saveDemo(db);
    }
    return db;
  }

  function saveDemo(db) {
    localStorage.setItem(LS_KEY, JSON.stringify(db));
  }

  // ---------- 商品 ----------
  function getProducts() {
    if (isDemo()) {
      return Promise.resolve(readDemo().products.filter(function (p) { return p.active; })
        .sort(function (a, b) { return a.seq - b.seq; }));
    }
    return ready().then(function () {
      return client.from('products')
        .select('id,seq,name,unit,price,stock,alert_stock,rating,active')
        .eq('active', true).order('seq');
    }).then(function (res) {
      if (res.error) throw res.error;
      return res.data;
    });
  }

  function getAllProducts() {
    if (isDemo()) {
      return Promise.resolve(readDemo().products.slice().sort(function (a, b) { return a.seq - b.seq; }));
    }
    return ready().then(function () {
      return client.from('products').select('*').order('seq');
    }).then(function (res) {
      if (res.error) throw res.error;
      return res.data;
    });
  }

  function updateProduct(id, patch) {
    if (isDemo()) {
      var db = readDemo();
      var p = db.products.find(function (x) { return x.id === id; });
      if (!p) throw new Error('商品不存在');
      Object.keys(patch).forEach(function (k) { p[k] = patch[k]; });
      saveDemo(db);
      return Promise.resolve(p);
    }
    return ready().then(function () {
      return client.from('products').update(patch).eq('id', id);
    }).then(function (res) {
      if (res.error) throw res.error;
      return true;
    });
  }

  // ---------- 订单：顾客提交 ----------
  function createOrder(input) {
    if (isDemo()) {
      var db = readDemo();
      var items = [];
      var subtotal = 0, totalCost = 0, count = 0;

      input.items.forEach(function (i) {
        var p = db.products.find(function (x) { return x.id === i.productId; });
        if (!p || !p.active) return;
        var qty = Math.max(0, parseInt(i.qty, 10) || 0);
        var gift = Math.max(0, parseInt(i.giftQty, 10) || 0);
        if (qty + gift <= 0) return;
        p.stock -= qty + gift;
        items.push({
          product_id: p.id, product_name: p.name, unit: p.unit,
          price: p.price, cost: p.cost, qty: qty, gift_qty: gift
        });
        subtotal += p.price * qty;
        totalCost += p.cost * (qty + gift);
        count += qty + gift;
      });

      if (!items.length) throw new Error('请至少选择一件商品');

      var discount = Math.max(0, Number(input.discount) || 0);
      var order = {
        id: uuid(), created_at: new Date().toISOString(),
        customer_name: (input.name || '').trim(), note: (input.note || '').trim(),
        subtotal: round(subtotal), discount: round(discount),
        final_price: round(subtotal - discount), shipping: 0,
        total_cost: round(totalCost), profit: round(subtotal - discount - totalCost),
        items_count: count, status: 'pending', handled_at: null, items: items
      };
      db.orders.unshift(order);
      saveDemo(db);
      return Promise.resolve(order);
    }

    var sum = Number(input.subtotal) || 0;
    var disc = Math.max(0, Number(input.discount) || 0);
    return ready().then(function () {
      return client.rpc('create_order', {
        payload: {
          customer_name: input.name,
          note: input.note,
          discount: disc,
          items: input.items.map(function (i) {
            return { product_id: i.productId, qty: parseInt(i.qty, 10) || 0, gift_qty: parseInt(i.giftQty, 10) || 0 };
          })
        }
      });
    }).then(function (res) {
      if (res.error) throw res.error;
      return { id: res.data, final_price: round(sum - disc) };
    });
  }

  // ---------- 订单：管理员 ----------
  function normalize(row) {
    var items = (row.order_items || row.items || []).map(function (it) {
      return {
        product_id: it.product_id, product_name: it.product_name, unit: it.unit,
        price: Number(it.price), cost: Number(it.cost),
        qty: it.qty, gift_qty: it.gift_qty
      };
    });
    var o = Object.assign({}, row, { items: items });
    delete o.order_items;
    ['subtotal', 'discount', 'final_price', 'shipping', 'total_cost', 'profit'].forEach(function (k) {
      o[k] = Number(o[k]) || 0;
    });
    return o;
  }

  function listOrders() {
    if (isDemo()) {
      return Promise.resolve(readDemo().orders.slice().sort(function (a, b) {
        return new Date(b.created_at) - new Date(a.created_at);
      }));
    }
    return ready().then(function () {
      return client.from('orders').select('*, order_items(*)').order('created_at', { ascending: false });
    }).then(function (res) {
      if (res.error) throw res.error;
      return res.data.map(normalize);
    });
  }

  function updateOrder(id, patch) {
    if (isDemo()) {
      var db = readDemo();
      var o = db.orders.find(function (x) { return x.id === id; });
      if (!o) throw new Error('订单不存在');

      if (o.status !== 'cancelled') {
        o.items.forEach(function (it) {
          var p = db.products.find(function (x) { return x.id === it.product_id; });
          if (p) p.stock += it.qty + it.gift_qty;
        });
      }

      var items = [], subtotal = 0, cost = 0, count = 0;
      (patch.items || []).forEach(function (i) {
        var p = db.products.find(function (x) { return x.id === i.product_id; });
        if (!p) return;
        var qty = Math.max(0, parseInt(i.qty, 10) || 0);
        var gift = Math.max(0, parseInt(i.gift_qty, 10) || 0);
        if (qty + gift <= 0) return;
        p.stock -= qty + gift;
        items.push({
          product_id: p.id, product_name: p.name, unit: p.unit,
          price: p.price, cost: p.cost, qty: qty, gift_qty: gift
        });
        subtotal += p.price * qty;
        cost += p.cost * (qty + gift);
        count += qty + gift;
      });

      var discount = Math.max(0, Number(patch.discount) || 0);
      var shipping = Math.max(0, Number(patch.shipping) || 0);
      Object.assign(o, {
        customer_name: patch.customer_name != null ? patch.customer_name : o.customer_name,
        note: patch.note != null ? patch.note : o.note,
        items: items, subtotal: round(subtotal), discount: round(discount),
        final_price: round(subtotal - discount), shipping: round(shipping),
        total_cost: round(cost), profit: round(subtotal - discount - cost - shipping),
        items_count: count, status: 'adjusted', handled_at: new Date().toISOString()
      });
      saveDemo(db);
      return Promise.resolve(o);
    }

    return ready().then(function () {
      return client.rpc('adjust_order', {
        p_order_id: id,
        payload: {
          customer_name: patch.customer_name,
          note: patch.note,
          discount: Number(patch.discount) || 0,
          shipping: Number(patch.shipping) || 0,
          items: (patch.items || []).map(function (i) {
            return { product_id: i.product_id, qty: i.qty, gift_qty: i.gift_qty };
          })
        }
      });
    }).then(function (res) {
      if (res.error) throw res.error;
      return true;
    });
  }

  function cancelOrder(id) {
    if (isDemo()) {
      var db = readDemo();
      var o = db.orders.find(function (x) { return x.id === id; });
      if (!o) throw new Error('订单不存在');
      if (o.status === 'cancelled') return Promise.resolve(true);
      o.items.forEach(function (it) {
        var p = db.products.find(function (x) { return x.id === it.product_id; });
        if (p) p.stock += it.qty + it.gift_qty;
      });
      o.status = 'cancelled';
      o.handled_at = new Date().toISOString();
      saveDemo(db);
      return Promise.resolve(true);
    }
    return ready().then(function () {
      return client.rpc('cancel_order', { p_order_id: id });
    }).then(function (res) {
      if (res.error) throw res.error;
      return true;
    });
  }

  function restoreOrder(id) {
    if (isDemo()) {
      var db = readDemo();
      var o = db.orders.find(function (x) { return x.id === id; });
      if (!o) throw new Error('订单不存在');
      if (o.status !== 'cancelled') return Promise.resolve(true);
      o.items.forEach(function (it) {
        var p = db.products.find(function (x) { return x.id === it.product_id; });
        if (p) p.stock -= it.qty + it.gift_qty;
      });
      o.status = 'pending';
      o.handled_at = new Date().toISOString();
      saveDemo(db);
      return Promise.resolve(true);
    }
    return ready().then(function () {
      return client.rpc('restore_order', { p_order_id: id });
    }).then(function (res) {
      if (res.error) throw res.error;
      return true;
    });
  }

  // ---------- 登录 ----------
  function signIn(user, password) {
    if (isDemo()) {
      var ok = user === CFG.DEMO_ADMIN.user && password === CFG.DEMO_ADMIN.password;
      if (ok) sessionStorage.setItem('fw_admin', '1');
      return Promise.resolve(ok ? { ok: true } : { ok: false, message: '账号或密码错误' });
    }
    return ready().then(function () {
      return client.auth.signInWithPassword({ email: user, password: password });
    }).then(function (res) {
      if (res.error) return { ok: false, message: '账号或密码错误' };
      return { ok: true };
    });
  }

  function signOut() {
    if (isDemo()) {
      sessionStorage.removeItem('fw_admin');
      return Promise.resolve();
    }
    return ready().then(function () { return client.auth.signOut(); });
  }

  function isSignedIn() {
    if (isDemo()) return Promise.resolve(sessionStorage.getItem('fw_admin') === '1');
    return ready().then(function () {
      return client.auth.getSession();
    }).then(function (res) { return !!(res.data && res.data.session); });
  }

  return {
    isDemo: isDemo,
    ready: ready,
    getProducts: getProducts,
    getAllProducts: getAllProducts,
    updateProduct: updateProduct,
    createOrder: createOrder,
    listOrders: listOrders,
    updateOrder: updateOrder,
    cancelOrder: cancelOrder,
    restoreOrder: restoreOrder,
    signIn: signIn,
    signOut: signOut,
    isSignedIn: isSignedIn,
    round: round
  };
})();
