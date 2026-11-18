// 管理后台：登录、汇总、订单调整/取消、导出、商品库存维护
(function () {
  'use strict';

  var U = window.Util;
  var $ = function (id) { return document.getElementById(id); };

  var state = {
    orders: [],
    products: [],
    period: 'today',
    editingId: null
  };

  function toast(msg) {
    var el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove('show'); }, 2200);
  }

  var STATUS = {
    pending: { txt: '已提交', cls: 'pending' },
    adjusted: { txt: '已调整', cls: 'adjusted' },
    cancelled: { txt: '已取消', cls: 'cancelled' }
  };

  // ---------------- 登录 ----------------
  function enterApp() {
    $('loginView').hidden = true;
    $('appView').hidden = false;
    $('modeTip').textContent = Store.isDemo()
      ? '演示模式 · 数据存在本机浏览器'
      : '云端模式 · 数据实时同步';
    loadAll();
  }

  $('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var account = $('account').value.trim();
    var pwd = $('password').value;
    if (!account || !pwd) { $('loginErr').textContent = '请输入账号和密码'; return; }

    Store.signIn(account, pwd).then(function (res) {
      if (!res.ok) { $('loginErr').textContent = res.message || '登录失败'; return; }
      $('loginErr').textContent = '';
      $('password').value = '';
      enterApp();
    }).catch(function (err) {
      $('loginErr').textContent = err.message || '登录失败';
    });
  });

  $('logoutBtn').addEventListener('click', function () {
    Store.signOut().then(function () { location.reload(); });
  });

  // ---------------- 数据加载 ----------------
  function loadAll() {
    Promise.all([Store.listOrders(), Store.getAllProducts()]).then(function (res) {
      state.orders = res[0];
      state.products = res[1];
      renderSummary();
      renderOrders();
      renderProducts();
    }).catch(function (err) {
      console.error(err);
      toast('加载失败：' + (err.message || err));
    });
  }

  function loadOrders() {
    return Store.listOrders().then(function (list) {
      state.orders = list;
      renderSummary();
      renderOrders();
    });
  }

  // ---------------- 汇总 ----------------
  function inPeriod(o) {
    if (state.period === 'all') return true;
    var d = U.fmtDate(o.created_at);
    var today = U.fmtDate(new Date().toISOString());
    if (state.period === 'today') return d === today;
    return d.slice(0, 7) === today.slice(0, 7);
  }

  function renderSummary() {
    var list = state.orders.filter(function (o) { return inPeriod(o) && o.status !== 'cancelled'; });
    var amount = 0, discount = 0, cost = 0, profit = 0;
    list.forEach(function (o) {
      amount += o.final_price;
      discount += o.discount;
      cost += o.total_cost;
      profit += o.profit;
    });
    var rate = amount > 0 ? (profit / amount * 100).toFixed(1) + '%' : '—';

    $('summaryGrid').innerHTML =
      stat('订单数', list.length + ' 单') +
      stat('成交额', U.money(amount), 'red') +
      stat('优惠合计', U.money(discount), 'gold') +
      stat('成本合计', U.money(cost), 'gold') +
      stat('利润合计', U.money(profit), 'green') +
      stat('利润率', rate, 'green');
  }

  function stat(label, value, cls) {
    return '<div class="stat"><div class="label">' + label + '</div>' +
      '<div class="value ' + (cls || '') + '">' + value + '</div></div>';
  }

  // ---------------- 订单列表 ----------------
  function filteredOrders() {
    var from = $('dateFrom').value;
    var to = $('dateTo').value;
    var kw = $('nameFilter').value.trim();
    var st = $('statusFilter').value;

    return state.orders.filter(function (o) {
      var d = U.fmtDate(o.created_at);
      if (from && d < from) return false;
      if (to && d > to) return false;
      if (kw && String(o.customer_name).indexOf(kw) < 0) return false;
      if (st && o.status !== st) return false;
      return true;
    });
  }

  function renderOrders() {
    var list = filteredOrders();
    if (!list.length) {
      $('orderBody').innerHTML = '<tr><td colspan="9" style="text-align:center;color:#8b8378;padding:26px">暂无订单</td></tr>';
      return;
    }
    $('orderBody').innerHTML = list.map(function (o) {
      var s = STATUS[o.status] || STATUS.pending;
      var ops = '<button class="btn small ghost" data-act="detail" data-id="' + o.id + '">详情</button>' +
        '<button class="btn small ghost" data-act="export" data-id="' + o.id + '">导出</button>';
      if (o.status === 'cancelled') {
        ops += '<button class="btn small ghost" data-act="restore" data-id="' + o.id + '">恢复</button>';
      } else {
        ops += '<button class="btn small ghost" data-act="adjust" data-id="' + o.id + '">调整</button>' +
          '<button class="btn small danger" data-act="cancel" data-id="' + o.id + '">取消</button>';
      }
      return '<tr>' +
        '<td class="num">' + U.fmtTime(o.created_at) + '</td>' +
        '<td class="strong">' + U.esc(o.customer_name) + '</td>' +
        '<td class="num">' + (o.items_count || 0) + '</td>' +
        '<td class="num">' + U.num(o.subtotal) + '</td>' +
        '<td class="num">' + U.num(o.discount) + '</td>' +
        '<td class="num strong">' + U.num(o.final_price) + '</td>' +
        '<td><span class="tag ' + s.cls + '">' + s.txt + '</span></td>' +
        '<td class="wrap">' + U.esc(o.note || '') + '</td>' +
        '<td><div class="ops">' + ops + '</div></td>' +
        '</tr>';
    }).join('');
  }

  $('orderBody').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-act]');
    if (!btn) return;
    var id = btn.dataset.id;
    var act = btn.dataset.act;
    var order = state.orders.find(function (o) { return String(o.id) === String(id); });
    if (!order) return;

    if (act === 'detail') showDetail(order);
    if (act === 'export') exportOrder(order);
    if (act === 'adjust') showAdjust(order);
    if (act === 'cancel') doCancel(order);
    if (act === 'restore') doRestore(order);
  });

  ['periodSel', 'dateFrom', 'dateTo', 'nameFilter', 'statusFilter'].forEach(function (id) {
    var el = $(id);
    el.addEventListener(id === 'periodSel' ? 'change' : 'input', function () {
      if (id === 'periodSel') { state.period = el.value; renderSummary(); return; }
      renderOrders();
    });
  });

  $('refreshBtn').addEventListener('click', function () {
    Store.listOrders().then(function (list) {
      state.orders = list;
      renderSummary();
      renderOrders();
      toast('已刷新');
    }).catch(function (err) { toast('刷新失败：' + (err.message || err)); });
  });

  // ---------------- 详情 ----------------
  function showDetail(o) {
    var s = STATUS[o.status] || STATUS.pending;
    var kv = '<div class="kv">' +
      '<div>姓名：<b>' + U.esc(o.customer_name) + '</b></div>' +
      '<div>提交时间：<b>' + U.fmtTime(o.created_at) + '</b></div>' +
      '<div>状态：<b>' + s.txt + '</b></div>' +
      '<div>件数：<b>' + (o.items_count || 0) + '</b></div>' +
      '<div>总价格：<b>' + U.money(o.subtotal) + '</b></div>' +
      '<div>优惠减免：<b>' + U.money(o.discount) + '</b></div>' +
      '<div>最终价格：<b>' + U.money(o.final_price) + '</b></div>' +
      '<div>运费：<b>' + U.money(o.shipping) + '</b></div>' +
      '<div>成本总计：<b>' + U.money(o.total_cost) + '</b></div>' +
      '<div>最终利润：<b>' + U.money(o.profit) + '</b></div>' +
      '<div style="grid-column:1/-1">备注：<b>' + U.esc(o.note || '无') + '</b></div>' +
      '</div>';

    var rows = o.items.map(function (it, i) {
      return '<tr><td>' + (i + 1) + '</td><td>' + U.esc(it.product_name) + '</td>' +
        '<td>' + U.esc(it.unit) + '</td><td class="num">' + U.num(it.price) + '</td>' +
        '<td class="num">' + U.num(it.cost) + '</td><td class="num">' + it.qty + '</td>' +
        '<td class="num">' + it.gift_qty + '</td>' +
        '<td class="num">' + U.num(it.price * it.qty) + '</td></tr>';
    }).join('');

    var table = '<div class="table-scroll"><table class="data" style="min-width:560px">' +
      '<thead><tr><th>#</th><th>商品</th><th>单位</th><th>单价</th><th>成本</th><th>数量</th><th>赠送</th><th>小计</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>';

    openModal('订单详情', kv + table,
      '<button class="btn ghost" data-close="1" type="button">关闭</button>' +
      '<button class="btn primary" data-export="' + o.id + '" type="button">导出 Excel</button>');
  }

  // ---------------- 调整 ----------------
  function showAdjust(o) {
    state.editingId = o.id;
    var rows = o.items.map(function (it, i) {
      return '<tr>' +
        '<td>' + (i + 1) + '</td>' +
        '<td>' + U.esc(it.product_name) + '</td>' +
        '<td class="num">' + U.num(it.price) + '</td>' +
        '<td><input data-adj="qty" data-i="' + i + '" type="number" min="0" step="1" value="' + it.qty + '"></td>' +
        '<td><input data-adj="gift" data-i="' + i + '" type="number" min="0" step="1" value="' + it.gift_qty + '"></td>' +
        '<td class="num" data-sub="' + i + '">' + U.num(it.price * it.qty) + '</td>' +
        '</tr>';
    }).join('');

    var body =
      '<div class="form-row"><label>姓名</label><input id="adjName" value="' + U.esc(o.customer_name) + '" maxlength="20"></div>' +
      '<div class="form-row"><label>备注</label><input id="adjNote" value="' + U.esc(o.note || '') + '" maxlength="100"></div>' +
      '<div class="form-row"><label>优惠减免</label><input id="adjDiscount" type="number" min="0" step="0.01" value="' + o.discount + '"></div>' +
      '<div class="form-row"><label>运费</label><input id="adjShipping" type="number" min="0" step="0.01" value="' + o.shipping + '"></div>' +
      '<div style="font-size:12.5px;color:#8b8378;margin:6px 0 8px">修改数量会自动按差额增减库存；数量填 0 即从本单移除</div>' +
      '<div class="table-scroll table-edit"><table class="data" style="min-width:520px">' +
      '<thead><tr><th>#</th><th>商品</th><th>单价</th><th>数量</th><th>赠送</th><th>小计</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>' +
      '<div class="summary" style="margin-top:14px">' +
      '<div class="line"><span>总价格</span><b id="adjSubtotal">-</b></div>' +
      '<div class="line"><span>最终价格</span><b id="adjFinal">-</b></div>' +
      '</div>';

    openModal('调整订单', body,
      '<button class="btn ghost" data-close="1" type="button">取消</button>' +
      '<button class="btn primary" id="adjSave" type="button">保存调整</button>');

    var modalBody = $('modalBody');
    function recalc() {
      var sub = 0;
      o.items.forEach(function (it, i) {
        var q = parseInt(modalBody.querySelector('[data-adj="qty"][data-i="' + i + '"]').value, 10) || 0;
        sub += it.price * q;
        modalBody.querySelector('[data-sub="' + i + '"]').textContent = U.num(it.price * q);
      });
      var disc = parseFloat($('adjDiscount').value) || 0;
      $('adjSubtotal').textContent = U.money(sub);
      $('adjFinal').textContent = U.money(sub - disc);
    }
    modalBody.addEventListener('input', function (e) {
      if (e.target.matches('[data-adj]') || e.target.id === 'adjDiscount') recalc();
    });
    recalc();

    $('adjSave').addEventListener('click', function () {
      var items = o.items.map(function (it, i) {
        return {
          product_id: it.product_id,
          qty: parseInt(modalBody.querySelector('[data-adj="qty"][data-i="' + i + '"]').value, 10) || 0,
          gift_qty: parseInt(modalBody.querySelector('[data-adj="gift"][data-i="' + i + '"]').value, 10) || 0
        };
      });
      var name = $('adjName').value.trim();
      if (!name) { toast('姓名不能为空'); return; }

      $('adjSave').disabled = true;
      Store.updateOrder(o.id, {
        customer_name: name,
        note: $('adjNote').value.trim(),
        discount: parseFloat($('adjDiscount').value) || 0,
        shipping: parseFloat($('adjShipping').value) || 0,
        items: items
      }).then(function () {
        closeModal();
        toast('已保存调整');
        return loadOrders();
      }).catch(function (err) {
        toast('保存失败：' + (err.message || err));
      }).then(function () { $('adjSave').disabled = false; });
    });
  }

  // ---------------- 取消 / 恢复 ----------------
  function doCancel(o) {
    if (!confirm('取消后会把库存加回去，确认取消「' + o.customer_name + '」的这一单？')) return;
    Store.cancelOrder(o.id).then(function () {
      toast('已取消');
      return loadOrders();
    }).catch(function (err) { toast('操作失败：' + (err.message || err)); });
  }

  function doRestore(o) {
    if (!confirm('恢复后会重新扣减库存，确认恢复这一单？')) return;
    Store.restoreOrder(o.id).then(function () {
      toast('已恢复');
      return loadOrders();
    }).catch(function (err) { toast('操作失败：' + (err.message || err)); });
  }

  // ---------------- 导出 Excel ----------------
  function exportOrder(o) {
    if (!window.XLSX) {
      toast('导出组件未加载，请检查网络后刷新');
      return;
    }
    var rows = [];
    rows.push(['烟花明细表']);
    rows.push(['提交人：' + o.customer_name, '', '', '', '', '', '', '', '', '提交时间：' + U.fmtTime(o.created_at), '', '']);
    rows.push(['序号', '产品名称', '单位', '单个售价', '单个成本', '数量', '赠送数量', '计算区间', '', '']);
    o.items.forEach(function (it, i) {
      rows.push([i + 1, it.product_name, it.unit, Number(it.price), Number(it.cost),
        it.qty, it.gift_qty, U.round2(Number(it.price) * it.qty), '', '']);
    });
    rows.push([]);
    rows.push(['总价格', '', '', '', '', '', '', o.subtotal, '', '成本总计', '', o.total_cost]);
    rows.push(['优惠减免', '', '', '', '', '', '', o.discount, '', '成本增加', '', 0]);
    rows.push(['最终价格', '', '', '', '', '', '', o.final_price, '', '最终成本', '', o.total_cost]);
    rows.push(['运费', '', '', '', '', '', '', o.shipping, '', '', '', '']);
    rows.push(['最终利润', '', '', '', '', '', '', o.profit, '', '', '', '']);
    if (o.note) {
      rows.push([]);
      rows.push(['备注', o.note]);
    }

    var ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 10 }, { wch: 24 }, { wch: 22 }, { wch: 10 }, { wch: 10 },
      { wch: 8 }, { wch: 10 }, { wch: 12 }, { wch: 2 }, { wch: 12 }, { wch: 10 }, { wch: 12 }];
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 7 } }];

    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '明细');
    XLSX.writeFile(wb, U.fileName(o.customer_name, o.created_at));
    toast('已导出 ' + U.fileName(o.customer_name, o.created_at));
  }

  // ---------------- 商品与库存 ----------------
  function renderProducts() {
    $('productBody').innerHTML = state.products.map(function (p) {
      return '<tr data-pid="' + p.id + '">' +
        '<td class="num">' + p.seq + '</td>' +
        '<td><input class="wide" data-f="name" value="' + U.esc(p.name) + '"></td>' +
        '<td><input class="wide" data-f="unit" value="' + U.esc(p.unit) + '"></td>' +
        '<td><input data-f="price" type="number" min="0" step="0.01" value="' + p.price + '"></td>' +
        '<td><input data-f="cost" type="number" min="0" step="0.01" value="' + p.cost + '"></td>' +
        '<td><input data-f="stock" type="number" step="1" value="' + p.stock + '"></td>' +
        '<td><input data-f="alert_stock" type="number" step="1" value="' + (p.alert_stock || 5) + '"></td>' +
        '<td><input data-f="rating" type="number" min="0" max="3" step="0.5" value="' + p.rating + '"></td>' +
        '<td><input data-f="active" type="checkbox" ' + (p.active ? 'checked' : '') + '></td>' +
        '<td><button class="btn small ghost" data-save="' + p.id + '" type="button">保存</button></td>' +
        '</tr>';
    }).join('');
  }

  $('productBody').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-save]');
    if (!btn) return;
    var row = btn.closest('tr');
    var id = btn.dataset.save;
    var val = function (f) { return row.querySelector('[data-f="' + f + '"]'); };

    var patch = {
      name: val('name').value.trim(),
      unit: val('unit').value.trim(),
      price: parseFloat(val('price').value) || 0,
      cost: parseFloat(val('cost').value) || 0,
      stock: parseInt(val('stock').value, 10) || 0,
      alert_stock: parseInt(val('alert_stock').value, 10) || 0,
      rating: parseFloat(val('rating').value) || 0,
      active: val('active').checked
    };
    if (!patch.name) { toast('商品名称不能为空'); return; }

    btn.disabled = true;
    Store.updateProduct(Number(id) || id, patch).then(function () {
      toast('已保存：' + patch.name);
      var p = state.products.find(function (x) { return String(x.id) === String(id); });
      if (p) Object.assign(p, patch);
    }).catch(function (err) {
      toast('保存失败：' + (err.message || err));
    }).then(function () { btn.disabled = false; });
  });

  $('reloadProducts').addEventListener('click', function () {
    Store.getAllProducts().then(function (list) {
      state.products = list;
      renderProducts();
      toast('已刷新');
    }).catch(function (err) { toast('刷新失败：' + (err.message || err)); });
  });

  // ---------------- 弹窗 & 标签页 ----------------
  function openModal(title, bodyHtml, footHtml) {
    $('modalTitle').textContent = title;
    $('modalBody').innerHTML = bodyHtml;
    $('modalFoot').innerHTML = footHtml || '<button class="btn ghost" data-close="1" type="button">关闭</button>';
    $('modal').hidden = false;
  }

  function closeModal() {
    $('modal').hidden = true;
    $('modalBody').innerHTML = '';
    $('modalFoot').innerHTML = '';
    state.editingId = null;
  }

  $('modalClose').addEventListener('click', closeModal);
  $('modal').addEventListener('click', function (e) {
    if (e.target.id === 'modal') closeModal();
    var close = e.target.closest('[data-close]');
    if (close) closeModal();
    var exp = e.target.closest('[data-export]');
    if (exp) {
      var o = state.orders.find(function (x) { return String(x.id) === String(exp.dataset.export); });
      if (o) exportOrder(o);
    }
  });

  document.querySelectorAll('.tabs button').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.tabs button').forEach(function (b) { b.classList.remove('on'); });
      btn.classList.add('on');
      var tab = btn.dataset.tab;
      $('tabOrders').hidden = tab !== 'orders';
      $('tabProducts').hidden = tab !== 'products';
    });
  });

  // ---------------- 启动 ----------------
  Store.ready().then(function () {
    return Store.isSignedIn();
  }).then(function (ok) {
    if (ok) enterApp();
  }).catch(function (err) {
    console.error(err);
    var msg = (err && err.message) ? err.message : '请检查网络或 config.js 配置';
    $('loginErr').textContent = '无法连接数据服务：' + msg;
  });
})();
