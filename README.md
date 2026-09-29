# 云记账 · 多端同步

一个纯前端的个人记账应用，**电脑与手机数据实时同步**，数据存放在你自己的 GitHub 私密 Gist 中，免费、无需服务器、无需注册第三方账号。

## 特性

- **多端同步**：通过 GitHub Gist 在电脑与手机间同步，时间戳合并，不怕冲突丢数据
- **离线可用**：所有数据本地存储（localStorage），断网也能记账，联网自动同步
- **响应式**：电脑用侧边栏布局，手机用底部导航，同一套界面自适应
- **完整记账**：收入/支出、自定义分类、按月统计、支出分类占比环形图、近 6 月趋势图、本周支出柱状图
- **数据安全**：数据导出/导入 JSON 备份，Token 仅存本地不上传

## 在线访问

部署到 GitHub Pages 后，电脑和手机用同一个网址即可：

```
https://<你的用户名>.github.io/<仓库名>/
```

## 同步配置（一次配置，多端通用）

### 1. 生成 GitHub Token

1. 打开 https://github.com/settings/tokens （头像 → Settings → Developer settings → Personal access tokens → **Tokens (classic)**）
2. 点 **Generate new token (classic)**
3. Note 随便填（如 `ledger`），Expiration 选 `No expiration` 或长期
4. 权限只勾选 **`gist`** 一项
5. 生成后复制 `ghp_...` 开头的 Token

### 2. 在应用内配置

1. 打开应用 → **设置** 页
2. 粘贴 Token 到「GitHub Token」
3. 「Gist ID」留空（首次同步会自动创建私密 Gist）
4. 点 **保存并测试**，看到「同步成功」即完成

### 3. 在另一台设备上同步

在手机上打开同一网址 → 设置页 → 填入**同一个 Token** 和**上一步自动生成的 Gist ID**（在 https://gist.github.com 可看到）→ 保存并测试。之后每次记账都会自动同步。

> 建议把 Gist ID 也记下来。多端首次连接后，各设备间会双向合并历史数据。

## 本地预览

直接用浏览器打开 `index.html` 即可。同步功能需通过 `http://` 或 `https://` 访问（GitHub Pages 自带 HTTPS），`file://` 下 fetch 可能受限。

## 技术说明

- 纯 HTML/CSS/JS，无构建步骤、无依赖，可直接托管在 GitHub Pages / 任意静态服务器
- 同步冲突解决：每条记录带 `updatedAt` 时间戳，合并时保留较新版本；删除以墓碑（`deleted`）传播，30 天后自动清理
- 货币符号、自动同步开关可在设置中调整

## 文件结构

```
ledger-app/
├── index.html   # 应用结构与弹窗
├── style.css    # 样式与响应式布局
├── app.js       # 全部逻辑：状态、渲染、图表、Gist 同步
└── README.md
```
