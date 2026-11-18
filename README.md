# 烟花登记网页

顾客选品自助下单，管理员核对、调整、导出 Excel。纯静态页面，可直接部署到 GitHub Pages。

## 目录结构

```
index.html            顾客下单页
admin.html            管理后台
assets/config.js      Supabase 配置（唯一需要改的文件）
assets/data.js        示例商品数据（仅演示模式加载，含成本）
assets/store.js       数据层（云端 / 演示双模式）
assets/app.js         顾客端逻辑
assets/admin.js       后台逻辑
assets/util.js        公共工具
assets/style.css      样式
supabase/schema.sql   数据库建表脚本
```

## 一、先看效果（演示模式）

不配置任何东西，直接用本地服务打开 `index.html`：

```bash
python -m http.server 8080
```

然后访问 http://localhost:8080 。此时数据只存在本机浏览器，后台账号为 `admin` / `yanhua2025`（见 `assets/config.js`）。

> 注意：直接双击 `index.html` 也能打开，但 Chrome 对 `file://` 有限制，建议用上面的本地服务方式。

## 二、接入 Supabase（正式使用）

1. 注册 https://supabase.com ，新建一个免费项目（区域选 Singapore 或 Tokyo 更快）。
2. 打开 **SQL Editor**，把 `supabase/schema.sql` 全部内容粘贴进去执行。
3. 打开 **Authentication → Users → Add user**，创建**唯一一个**管理员账号（邮箱 + 密码，勾选 Auto Confirm）。
   这个邮箱和密码就是后台登录账号，页面上没有注册入口。
4. 打开 **Project Settings → API**，复制 `Project URL` 和 `anon public` key，填进 `assets/config.js`：

```js
SUPABASE_URL: 'https://xxxx.supabase.co',
SUPABASE_ANON_KEY: 'eyJhbGciOi...'
```

5. 刷新页面，顶部「演示模式」提示会消失，数据改为云端同步。

### 上线建议

- 接入云端后，`assets/data.js` 里的成本数据不再被加载，但文件仍可被直接访问。**建议部署前删除该文件**（云端模式不需要它）。
- Supabase 免费项目连续 7 天无访问会被暂停，重新打开控制台即可唤醒，数据不会丢。
- 顾客端是匿名访问，只能读在售商品的公开字段（不含成本），只能通过数据库函数提交订单，看不到任何他人订单。

## 三、部署到 GitHub Pages

1. 新建仓库，把本目录所有文件推到 `main` 分支根目录。
2. 仓库 **Settings → Pages → Source** 选择 `Deploy from a branch`，分支选 `main`，目录选 `/ (root)`，保存。
3. 等一两分钟，访问 `https://用户名.github.io/仓库名/`。
4. 后台地址：`https://用户名.github.io/仓库名/admin.html`。

## 四、使用说明

**顾客**：搜索品类 → 点「+」加数量 → 需要赠送就点「赠送」填数量 → 填优惠金额、姓名（必填）、备注 → 提交。
库存低于预警值（默认 5）会黄色提示「库存紧张，请核实数量」；超出库存会红色提示；提示不拦截提交，超出库存时提交会二次确认。

**管理员**：

- 订单管理：按日期/姓名/状态筛选；点「详情」看明细和成本利润；「调整」可改数量、赠送、优惠、运费、备注（数量改 0 即移除，库存按差额自动回滚）；「取消」会把库存加回去，可再「恢复」。
- 单笔导出：生成 `2025.12.12.11.00明细（史书朋）.xlsx`，文件名取提交时间，内容与计价器表格一致（含成本列、成本总计、最终利润）。
- 商品库存：可改名称、单位、售价、成本、库存、预警值、星级、上下架，改完点「保存」即时生效。

## 五、计价规则

- 单项金额 = 单价 × 数量
- 总价格 = 各项之和（赠送不计金额）
- 最终价格 = 总价格 − 优惠减免
- 成本总计 = Σ 成本 ×（数量 + 赠送数量）
- 最终利润 = 最终价格 − 成本总计 − 运费

## 六、后续更新品类与价格

- 后台「商品库存」页可直接改价、上下架。
- 新增品类目前需在 Supabase 表 `products` 里加一条记录（`seq` 决定排序）。
- `assets/data.js` 只在演示模式使用，正式数据以 Supabase 为准。
