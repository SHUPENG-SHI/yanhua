// ============================================
// 部署配置
// 1. 在 https://supabase.com 创建一个免费项目
// 2. 打开 Project Settings -> API Keys，复制 Project URL 和 publishable key
// 3. 把两个值填到下面；留空则运行「演示模式」（数据只存在本机浏览器）
// ============================================
window.CONFIG = {
  SUPABASE_URL: 'https://wmztsokokdjwywqnlnrz.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_WDAF0f88xiBlrHbRe_wVoQ_huPMNbL-',

  // 演示模式下的管理员账号（接入 Supabase 后会自动改用 Supabase Auth 账号）
  DEMO_ADMIN: { user: 'admin', password: 'yanhua2025' }
};
