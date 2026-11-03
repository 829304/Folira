# Folira 开发需求概要

## 一、项目定位

基于 [marktext-light](https://github.com/SugarFatFree/marktext-light) 开发 **Folira**，一款轻量、精致、跨平台的 Markdown 所见即所得编辑器。

**核心原则：只做 UI、外观、主题及必要的品牌适配，不自行开发或重构 Markdown 编辑引擎。**

技术栈沿用上游：Tauri 2 + Rust + Vue 3 + TypeScript + Muya。

## 二、主要开发任务

### 1. 品牌替换

- 软件名称统一修改为 Folira。

- 使用已经确定的 `F.` Logo：Geist Bold 风格、纯黑字母、小句点、白色圆角背景。

- 替换应用图标、窗口标题、安装包名称、应用标识。

- 保留开源协议和上游项目署名。

### 2. 新增 Markdown 主题

优先实现以下主题：

| 主题           | 模式         |
| -------------- | ------------ |
| Folira Default | Light / Dark |
| GitHub         | Light / Dark |
| Typora GitBook | Light        |
| Claude         | Light / Dark |
| Bear           | Light        |
| Notion         | Light / Dark |
| iA Writer      | Light / Dark |
| Linear         | Dark         |
| Paper / Sepia  | Light        |
| OLED Black     | Dark         |

保留上游已有主题，不重复开发相同配色。

主题不仅需要修改背景颜色，还应优化标题、正文、字体、行距、引用块、代码块、表格、链接等 Markdown 排版细节。

### 3. 整体 UI 美化

参考 Apple/macOS 原生应用、Typora 和现代桌面应用设计，重点优化：

- 标题栏与窗口控制区域

- 左侧文件树与侧边栏

- 顶部标签页

- 菜单、按钮、图标和工具提示

- 设置页面与主题选择界面

- 字体、间距、圆角、边框、颜色和动画

- 深色模式与浅色模式

- 不同窗口尺寸及高 DPI 适配

整体设计要求：**极简、精致、低干扰、阅读舒适，避免过度装饰。**

### 4. 主题系统优化

尽可能将以下设置解耦：

- 应用 UI 主题

- Markdown 内容排版主题

- 代码语法高亮主题

支持跟随系统深浅色模式、主题实时预览和设置持久化。

优先沿用上游现有主题架构，避免不必要的重构。

### 5. 跨平台适配

确保 Windows、macOS、Linux 三个平台界面正常。

- 尊重各平台原生窗口操作习惯。

- 避免字体、布局、滚动条和窗口装饰异常。

- 保持 Tauri 的轻量优势。

- 使用 GitHub Actions 构建安装包。

## 三、明确不做的内容

- 不重写 Muya Markdown 引擎。

- 不自主开发大型 Markdown 文件优化。

- 不开发虚拟滚动、增量解析或独立阅读引擎。

- 不重写已有的 Markdown 编辑功能。

- 暂不增加复杂的新功能或插件系统。

- 暂不开发自动更新功能，后续再考虑。

**Muya 的功能更新、Bug 修复和性能优化交由上游负责。Folira 后续选择性同步合并。**

## 四、代码修改原则

1. 尽量将 Folira 专属样式放在独立的 CSS、主题配置与视觉组件中。

2. 不修改 Muya 核心代码，除非修复明确的兼容性问题。

3. 避免大范围修改上游业务逻辑，降低未来合并冲突。

4. 每完成一个模块就运行构建、测试并检查视觉效果。

5. 不得因外观修改破坏编辑、光标、选区、中文输入、撤销和保存功能。

6. DSH 独立负责开发、调试、测试与提交，重要架构变更需先说明原因。

## 五、开发优先级

**P0：** 品牌替换、Logo、Folira Default、GitHub、Typora、Claude 主题。

**P1：** 标题栏、侧边栏、标签页、设置页面和整体 UI 美化。

**P2：** Bear、Notion、iA Writer、Linear、Paper、OLED Black 主题，以及主题系统优化。

**P3：** 三平台视觉细节、动画、DPI 适配与构建发布。

## 六、最终目标

Folira 应成为一款拥有独立品牌、现代化 UI、丰富 Markdown 主题的轻量桌面编辑器。

**产品核心：上游 MarkText/Muya 的编辑能力 + Folira 自己的精致外观。**

不追求增加大量功能，重点把现有功能的视觉体验做到优秀，并始终保持与上游代码的可同步性。

