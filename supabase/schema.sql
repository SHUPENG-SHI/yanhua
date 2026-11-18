-- ============================================================
-- 烟花登记网页 · Supabase 建表脚本
-- 使用方法：Supabase 控制台 -> SQL Editor -> 新建查询 -> 粘贴全部 -> Run
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- 表 ----------
drop table if exists public.order_items cascade;
drop table if exists public.orders cascade;
drop table if exists public.products cascade;

create table public.products (
  id          bigserial primary key,
  seq         int not null default 0,
  name        text not null,
  unit        text not null default '个',
  price       numeric(10,2) not null default 0,
  cost        numeric(10,2) not null default 0,   -- 仅管理员可见
  stock       int not null default 0,
  alert_stock int not null default 5,             -- 低于该值提示库存紧张
  rating      numeric(2,1) not null default 3,    -- 推荐星级 0~3，0.5 步进
  active      boolean not null default true
);

create table public.orders (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  customer_name text not null,
  note          text,
  subtotal      numeric(10,2) not null default 0,
  discount      numeric(10,2) not null default 0,
  final_price   numeric(10,2) not null default 0,
  shipping      numeric(10,2) not null default 0,
  total_cost    numeric(10,2) not null default 0,
  profit        numeric(10,2) not null default 0,
  items_count   int not null default 0,
  status        text not null default 'pending'
                check (status in ('pending','adjusted','cancelled')),
  handled_at    timestamptz
);

create table public.order_items (
  id           bigserial primary key,
  order_id     uuid not null references public.orders(id) on delete cascade,
  product_id   bigint,
  product_name text not null,
  unit         text not null default '',
  price        numeric(10,2) not null default 0,
  cost         numeric(10,2) not null default 0,   -- 下单时快照
  qty          int not null default 0,
  gift_qty     int not null default 0
);

create index idx_order_items_order on public.order_items(order_id);
create index idx_orders_created on public.orders(created_at desc);

-- ---------- 行级权限 ----------
alter table public.products    enable row level security;
alter table public.orders      enable row level security;
alter table public.order_items enable row level security;

-- 顾客（匿名）只能读在售商品，且拿不到 cost 列
drop policy if exists products_read on public.products;
create policy products_read on public.products
  for select using (active = true or auth.role() = 'authenticated');

drop policy if exists products_admin on public.products;
create policy products_admin on public.products
  for all to authenticated using (true) with check (true);

-- 订单只有管理员能读写，顾客提交统一走下面的函数
drop policy if exists orders_admin on public.orders;
create policy orders_admin on public.orders
  for all to authenticated using (true) with check (true);

drop policy if exists order_items_admin on public.order_items;
create policy order_items_admin on public.order_items
  for all to authenticated using (true) with check (true);

revoke all on public.products    from anon;
revoke all on public.orders      from anon;
revoke all on public.order_items from anon;

grant select (id, seq, name, unit, price, stock, alert_stock, rating, active)
  on public.products to anon;

-- 管理员（登录用户）需要完整的表权限；
-- 如果创建项目时关掉了「Automatically expose new tables」，默认不会自动授权
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.products    to authenticated;
grant select, insert, update, delete on public.orders      to authenticated;
grant select, insert, update, delete on public.order_items to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- ---------- 下单（原子扣库存） ----------
create or replace function public.create_order(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_discount numeric := greatest(coalesce((payload->>'discount')::numeric, 0), 0);
  v_item     jsonb;
  v_p        products%rowtype;
  v_qty      int;
  v_gift     int;
  v_subtotal numeric := 0;
  v_cost     numeric := 0;
  v_count    int := 0;
begin
  if coalesce(btrim(payload->>'customer_name'), '') = '' then
    raise exception '请填写姓名';
  end if;
  if coalesce(jsonb_array_length(payload->'items'), 0) = 0 then
    raise exception '请至少选择一件商品';
  end if;

  insert into orders (customer_name, note, discount)
  values (
    left(btrim(payload->>'customer_name'), 20),
    nullif(left(btrim(coalesce(payload->>'note', '')), 100), ''),
    v_discount
  )
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(payload->'items')
  loop
    v_qty  := greatest(coalesce((v_item->>'qty')::int, 0), 0);
    v_gift := greatest(coalesce((v_item->>'gift_qty')::int, 0), 0);
    continue when v_qty + v_gift = 0;

    select * into v_p from products
      where id = (v_item->>'product_id')::bigint and active;
    if not found then
      raise exception '商品不存在或已下架';
    end if;

    update products set stock = stock - (v_qty + v_gift) where id = v_p.id;

    insert into order_items (order_id, product_id, product_name, unit, price, cost, qty, gift_qty)
    values (v_order_id, v_p.id, v_p.name, v_p.unit, v_p.price, v_p.cost, v_qty, v_gift);

    v_subtotal := v_subtotal + v_p.price * v_qty;
    v_cost     := v_cost + v_p.cost * (v_qty + v_gift);
    v_count    := v_count + v_qty + v_gift;
  end loop;

  if v_count = 0 then
    raise exception '请至少选择一件商品';
  end if;

  update orders set
    subtotal    = round(v_subtotal, 2),
    final_price = round(v_subtotal - v_discount, 2),
    total_cost  = round(v_cost, 2),
    profit      = round(v_subtotal - v_discount - v_cost, 2),
    items_count = v_count
  where id = v_order_id;

  return v_order_id;
end;
$$;

-- ---------- 调整订单（按差额回滚库存） ----------
create or replace function public.adjust_order(p_order_id uuid, payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status   text;
  v_discount numeric := greatest(coalesce((payload->>'discount')::numeric, 0), 0);
  v_shipping numeric := greatest(coalesce((payload->>'shipping')::numeric, 0), 0);
  v_item     jsonb;
  v_p        products%rowtype;
  v_qty      int;
  v_gift     int;
  v_subtotal numeric := 0;
  v_cost     numeric := 0;
  v_count    int := 0;
begin
  select status into v_status from orders where id = p_order_id for update;
  if v_status is null then
    raise exception '订单不存在';
  end if;

  -- 已取消的订单库存早已退回，不能再退一次
  if v_status <> 'cancelled' then
    update products p set stock = p.stock + oi.qty + oi.gift_qty
      from order_items oi
      where oi.order_id = p_order_id and oi.product_id = p.id;
  end if;

  delete from order_items where order_id = p_order_id;

  for v_item in select * from jsonb_array_elements(coalesce(payload->'items', '[]'::jsonb))
  loop
    v_qty  := greatest(coalesce((v_item->>'qty')::int, 0), 0);
    v_gift := greatest(coalesce((v_item->>'gift_qty')::int, 0), 0);
    continue when v_qty + v_gift = 0;

    select * into v_p from products where id = (v_item->>'product_id')::bigint;
    if not found then
      raise exception '商品不存在';
    end if;

    update products set stock = stock - (v_qty + v_gift) where id = v_p.id;

    insert into order_items (order_id, product_id, product_name, unit, price, cost, qty, gift_qty)
    values (p_order_id, v_p.id, v_p.name, v_p.unit, v_p.price, v_p.cost, v_qty, v_gift);

    v_subtotal := v_subtotal + v_p.price * v_qty;
    v_cost     := v_cost + v_p.cost * (v_qty + v_gift);
    v_count    := v_count + v_qty + v_gift;
  end loop;

  update orders set
    customer_name = coalesce(nullif(left(btrim(coalesce(payload->>'customer_name', '')), 20), ''), customer_name),
    note          = nullif(left(btrim(coalesce(payload->>'note', '')), 100), ''),
    subtotal      = round(v_subtotal, 2),
    discount      = v_discount,
    shipping      = v_shipping,
    final_price   = round(v_subtotal - v_discount, 2),
    total_cost    = round(v_cost, 2),
    profit        = round(v_subtotal - v_discount - v_cost - v_shipping, 2),
    items_count   = v_count,
    status        = 'adjusted',
    handled_at    = now()
  where id = p_order_id;
end;
$$;

-- ---------- 取消 / 恢复 ----------
create or replace function public.cancel_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  select status into v_status from orders where id = p_order_id for update;
  if v_status is null then
    raise exception '订单不存在';
  end if;
  if v_status = 'cancelled' then
    return;
  end if;

  update products p set stock = p.stock + oi.qty + oi.gift_qty
    from order_items oi
    where oi.order_id = p_order_id and oi.product_id = p.id;

  update orders set status = 'cancelled', handled_at = now() where id = p_order_id;
end;
$$;

create or replace function public.restore_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  select status into v_status from orders where id = p_order_id for update;
  if v_status is null then
    raise exception '订单不存在';
  end if;
  if v_status <> 'cancelled' then
    return;
  end if;

  update products p set stock = p.stock - oi.qty - oi.gift_qty
    from order_items oi
    where oi.order_id = p_order_id and oi.product_id = p.id;

  update orders set status = 'pending', handled_at = now() where id = p_order_id;
end;
$$;

revoke all on function public.create_order(jsonb) from public;
revoke all on function public.adjust_order(uuid, jsonb) from public;
revoke all on function public.cancel_order(uuid) from public;
revoke all on function public.restore_order(uuid) from public;

grant execute on function public.create_order(jsonb) to anon, authenticated;
grant execute on function public.adjust_order(uuid, jsonb) to authenticated;
grant execute on function public.cancel_order(uuid) to authenticated;
grant execute on function public.restore_order(uuid) to authenticated;

-- ============================================================
-- 初始商品数据（库存先为 0，请在后台「商品库存」里录入真实库存）
-- ============================================================
do $$
begin
  if (select count(*) from products) = 0 then
    insert into products (seq, name, unit, price, cost, stock, alert_stock, rating, active) values
      (1,  '君子加特林',     '个',                 38, 22.2,  0, 5, 2.5, true),
      (2,  '光合能量加特林', '个',                 58, 28.3,  0, 5, 3,   true),
      (3,  '时空幻境加特林', '个',                 60, 28.3,  0, 5, 3,   true),
      (4,  '虹彩三分钟',     '个',                 25, 10.5,  0, 5, 3,   true),
      (5,  '中洲三分钟',     '个',                 32, 12.3,  0, 5, 3,   true),
      (6,  '28寸仙女棒',     '束（一束8支）',       8, 1.75,  0, 5, 2.5, true),
      (7,  '36寸仙女棒',     '束（一束6支）',      10, 2,     0, 5, 3,   true),
      (8,  '小金鱼',         '条（25小盒，250粒）', 15, 3.2,   0, 5, 2.5, true),
      (9,  '中号舞龙棒',     '个',                 11, 3.1,   0, 5, 3,   true),
      (10, '金色童年舞龙棒', '个',                 13, 5.1,   0, 5, 3,   true),
      (11, '狼嚎火箭',       '把（一把6根）',      35, 15,    0, 5, 3,   true),
      (12, '虹彩孔雀开屏',   '个',                 22, 8,     0, 5, 3,   true),
      (13, '水母乐园',       '盒',                 20, 9.5,   0, 5, 3,   true),
      (14, '雪花棒',         '盒（2支）',          18, 3.3,   0, 5, 3,   true),
      (15, '黄金树',         '个',                 58, 28.3,  0, 5, 3,   true),
      (16, '飞毛腿',         '个（一个4支）',      15, 7.12,  0, 5, 3,   true),
      (17, '黑老大擦炮',     '条（一条10小盒）',   15, 0,     0, 5, 2.5, true),
      (18, '一朵鲜花擦炮',   '条（10小盒）',       20, 0,     0, 5, 2.5, true),
      (19, '超级无敌大擦炮', '盒',                 18, 0,     0, 5, 2.5, true),
      (20, '超级沙炮',       '条（10小盒）',       40, 0,     0, 5, 3,   true),
      (21, '炫彩照明弹',     '个（4根）',          15, 0,     0, 5, 3,   true),
      (22, '君子你好哇花筒', '盒（4个）',          16, 6,     0, 5, 3,   true),
      (23, '大西炮',         '包（3个）',           5, 0,     0, 5, 3,   true),
      (24, '机甲猎鹰',       '个',                 19, 5.7,   0, 5, 3,   true),

      -- 原表存在、新价目表尚未确认的品类，先下架，可在后台启用
      (25, '时光灯笼',       '个',                 15, 4.2,   0, 5, 3,   false),
      (26, '太空飞碟',       '个',                 25, 12,    0, 5, 3,   false),
      (27, '霸王熊',         '盒（3个）',          16, 8.1,   0, 5, 3,   false),
      (28, '钱来/喜乐喷花',  '个',                 20, 9.5,   0, 5, 3,   false),
      (29, '绚丽彩菊',       '盒（6个）',          15, 6.75,  0, 5, 3,   false),
      (30, '庆泰之花',       '条',                 25, 13.5,  0, 5, 3,   false),
      (31, '蓝庆泰花',       '个',                 28, 16.5,  0, 5, 3,   false),
      (32, '喜闹龙灯',       '盒（2个）',          12, 6.1,   0, 5, 3,   false),
      (33, '金玉满堂',       '盒（3个）',          10, 3,     0, 5, 3,   false),
      (34, '旋转佩奇',       '个',                 40, 21.66, 0, 5, 3,   false),
      (35, '君子孔雀开屏',   '个',                 24, 12,    0, 5, 3,   false),
      (36, '新年快乐',       '个',                 25, 21.6,  0, 5, 3,   false);
  end if;
end $$;
