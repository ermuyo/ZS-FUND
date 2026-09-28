# ZS FUND

资管系统：GP / LP 双角色，实时估值，MacBook 网页 + 手机（添加到主屏幕）。

## 结构
- `src/` 前端（React + Vite），C0「极光玻璃」风格
- `supabase/migrations/` 数据库结构、行级权限、定时任务
- `supabase/functions/update-prices/` 价格服务（加密：Coinbase / OKX 实时；港股 / 美股：Yahoo，腾讯兜底；汇率）
- `public/lib.json` 全市场标的搜索库（快照）

## 线上环境
- 数据库：Supabase 项目 `zs-fund-app`（东京）
- 价格：每分钟自动更新；每天 23:55 UTC 记录净值快照
- GP 登录邮箱：在 `settings.gp_email`

## 本地运行
```
npm install
npm run dev
```
`.env` 里是 Supabase 的地址和公开 key（可以放进前端）。

## 部署
`npm run build` 后把 `dist/` 上传到 Netlify（或任何静态托管）。`public/_redirects` 已配置单页应用路由。
