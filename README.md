<p align="center">
  <img src="docs/assets/logo-small.png" width="96" height="96" alt="Folira">
</p>

<h1 align="center">Folira</h1>

<p align="center"><strong>轻量、克制的跨平台 Markdown 编辑器</strong><br>
所见即所得，让注意力留在文字上。</p>

<p align="center">
  <strong>简体中文</strong> · <a href="README.en.md">English</a>
</p>

<p align="center">
  <a href="https://github.com/829304/Folira/releases/latest"><img src="https://img.shields.io/github/v/release/829304/Folira?label=release&style=for-the-badge" alt="release"></a>
  <a href="https://github.com/829304/Folira/releases"><img src="https://img.shields.io/github/downloads/829304/Folira/total.svg?style=for-the-badge" alt="downloads"></a>
  <img src="https://img.shields.io/badge/license-MIT-blue?style=for-the-badge" alt="MIT">
  <img src="https://img.shields.io/static/v1.svg?label=Platform&message=Windows%20%7C%20macOS%20%7C%20Linux&style=for-the-badge" alt="platform">
</p>

## 简介

Folira 是一个开源的桌面 Markdown 编辑器：一边写，看到的就已经是最终排版——没有预览窗口，也没有来回切换。

它由 **Tauri 2 + Rust + Vue 3** 构建，编辑器内核继承自 MarkText 的 Muya 引擎，外壳使用系统自带的 WebView 而不是打包一整份浏览器内核，因此安装包只有几 MB，启动更快，内存占用也更低。

## 截图

> 界面截图会在品牌与主题改造完成后补上。

## 功能

- **所见即所得**：编辑区就是成品，标题、列表、表格、公式在光标处实时成形
- **标准完整**：支持 [CommonMark](https://spec.commonmark.org) 与 [GitHub Flavored Markdown](https://github.github.com/gfm/)，并选择性支持 [Pandoc Markdown](https://pandoc.org/MANUAL.html#pandocs-markdown)
- **扩展语法**：数学公式（KaTeX）、Mermaid 图、PlantUML 时序图与流程图、表格、任务列表、前置元数据（front matter）、emoji
- **三种写作模式**：源代码模式、打字机模式、专注模式
- **导出**：HTML 与 PDF
- **粘贴即插图**：从剪贴板粘贴或直接拖拽图片插入
- **文件管理**：多标签、侧栏文件树、目录（TOC）面板、全文搜索
- **主题**：内置 36 套主题（17 浅 / 19 深），一次选择统一界面、正文与代码高亮
- **十种界面语言**：de、en、es、fr、ja、ko、pt、tr、zh-CN、zh-TW

## 主题

Folira 内置 36 套主题，其中 17 套浅色、19 套深色。主题是一个整体选择：界面（标题栏、侧栏、标签页、菜单、设置页）、正文排版（字号层级、引用、代码块、表格、链接）与代码高亮同时切换，不会出现三者配色互相打架的情况。

「偏好设置 → 主题」里按浅色 / 深色两个页签浏览，可搜索、可悬停即时预览，点击才应用并写入偏好。自定义 CSS 追加在主题样式之后，同权重时按顺序胜出（语法颜色直接写 `.token.*` 即可；主题设置过的排版用 `.editor-wrapper h2` 这类同形选择器覆盖）。

配色大多源自社区方案（GitHub Primer、GitBook、Notion、Catppuccin、Dracula、Nord、Tokyo Night、Solarized 等），完整列表与来源见 [Themes](packages/website/content/docs/end-user/THEMES.md)。

## 下载安装

安装包见 [最新版本](https://github.com/829304/Folira/releases/latest)。每个平台都链接系统 WebView，而不是把浏览器内核打进去——这是体积小的主要原因，也是安装前唯一需要留意的依赖。

#### Windows

x64 的 NSIS 安装包（`.exe`）。需要 Microsoft Edge **WebView2** 运行时：Windows 11 自带，Windows 10 缺失时安装程序会引导安装。

#### macOS

arm64 与 x64 各一个 `.dmg`，没有通用包，请按机型选择。WebView（WKWebView）属于系统，无需另装。

应用目前**未做代码签名与公证**，首次打开会被 Gatekeeper 拦下：右键点击应用 → 选择“打开”，或执行

```bash
xattr -dr com.apple.quarantine /Applications/Folira.app
```

#### Linux

提供 `.AppImage`、`.deb` 与 `.rpm`（x64）。三者都需要发行版提供 **webkit2gtk 4.1** 与 GTK 3：

```bash
# Debian / Ubuntu
sudo apt install libwebkit2gtk-4.1-0 libgtk-3-0 libayatana-appindicator3-1
```

## 与上游的关系

Folira 不是从零写起的编辑器，它站在 MarkText 的肩膀上：

```
MarkText（Electron，原作者 Jocs 与贡献者）
   └── marktext-light（Tauri 重制外壳）
          └── Folira（品牌、界面与主题）
```

- 编辑器内核 [Muya](https://github.com/marktext/muya) 与大部分界面代码来自 [MarkText](https://github.com/marktext/marktext)，遵循 MIT 协议
- 外壳来自 [marktext-light](https://github.com/SugarFatFree/marktext-light)
- Folira 在此基础上做的是：品牌与图标、界面视觉、主题系统，以及后续的图片上传与自动更新

编辑器本身的能力——语法解析、排版、导入导出——以上游为准，Folira 不做重复实现；上游的改进会有选择地同步。

## 开发

前置环境：

- Node.js **>= 20.19**（CI 使用 Node 22）
- pnpm **10.33.4**（由根 `package.json` 的 `packageManager` 固定，可用 `corepack` 启用）
- Rust **stable**，以及平台的 C 工具链：Windows 用 MSVC，macOS 用 Xcode Command Line Tools，Linux 用发行版的 GTK/WebKitGTK 依赖
- Windows 另需 WebView2 运行时

```bash
pnpm install                        # 安装依赖
pnpm --filter folira tauri:dev      # 开发模式：前端热更新 + Rust 增量编译
pnpm --filter folira tauri:build    # 打包当前平台
pnpm --filter folira test:unit      # 单元测试
pnpm --filter folira typecheck      # 类型检查
pnpm lint                           # ESLint
```

仓库结构、模块边界与更细的开发约定见 [CLAUDE.md](CLAUDE.md)；需求与设计记录见 [docs/](docs)。

## 路线图

- [x] 移除 Electron 主进程与构建工具链，只保留 Tauri 外壳
- [x] 修复迁移遗留的构建、类型与单元测试问题
- [x] 品牌改造：名称、图标、窗口标题、安装包标识
- [x] 主题系统：单一主题 id 统一界面、正文与代码高亮，浅色 / 深色分页浏览
- [x] 新增主题：GitHub Light（Primer 界面 + Prettylights 语法）
- [x] 新增浅色主题：Typora GitBook（GitBook / Azure 阅读风格）
- [x] 新增浅色主题：Notion（中性文档风格）
- [x] 新增浅色主题：Bear
- [x] 新增浅色主题：iA Writer
- [x] 新增浅色主题：Paper / Sepia
- [ ] 图片上传（PicGo / 自定义脚本）
- [ ] 自动更新
- [ ] Windows、macOS、Linux 三平台发布流水线

## 贡献

提交 PR 前请先读 [贡献指南](.github/CONTRIBUTING.md)。日常开发在 `develop` 分支，发版时才合并到 `main`。

## 许可

[MIT](LICENSE)。原始版权归 Luo Ran（Jocs）与 MarkText Contributors 所有；Tauri 外壳部分归 marktext-light 作者所有。
