# SmartEdu Textbook Crawler

批量抓取国家中小学智慧教育平台（`basic.smartedu.cn`）电子教材原始 PDF。

当前脚本通过教材详情页内嵌的 PDF.js viewer 读取原始 PDF 数据并保存，因此适合处理直接 `curl` 容易返回 `401` 的教材资源。

项目现在已适配 Windows、macOS 和 Linux。命令行示例尽量使用单行写法，便于直接在 PowerShell、CMD 或 Bash 中执行。

## 文件

- 脚本：`scripts/smartedu_textbook_batch.js`
- 本地前端服务：`scripts/server.js`
- 前端页面：`scripts/ui/index.html`

## 依赖

需要先安装 Node.js 18+，然后安装 Playwright。

如果你想直接在项目根目录操作，现在也可以：

```powershell
npm run setup
```

推荐在 [`scripts/package.json`](./scripts/package.json) 所在目录安装依赖：

```powershell
Set-Location .\scripts
npm install
```

浏览器使用顺序：

- 优先使用你本机已安装的 `Google Chrome`
- 如果本机 Chrome 不可用，再使用 Playwright 自带的 `Chromium`

如果你没有安装 Chrome，或者想使用 Playwright 自带浏览器，再执行：

```powershell
npx playwright install chromium
```

## 启动方法

### 0. 启动本地前端

最省事的根目录启动方式：

```powershell
npm run crawl-ui
```

或者直接双击 / 执行：

```powershell
.\start-ui.ps1
```

如果你想启动后自动打开浏览器：

```powershell
npm run crawl-ui:open
```

或者直接双击：

```powershell
.\start-ui-open.ps1
```

Windows PowerShell：

```powershell
Set-Location .\scripts
npm install
npm run crawl-ui
```

macOS / Linux：

```bash
cd ./scripts
npm install
npm run crawl-ui
```

然后打开：

```text
http://127.0.0.1:3210
```

前端会在本机启动爬虫脚本，并实时显示日志。

如果你使用的是 Windows `cmd`，也可以直接运行：

```bat
start-ui.cmd
```

自动打开浏览器的 `cmd` 版本：

```bat
start-ui-open.cmd
```

### 1. 抓取全站所有电子教材

```powershell
node .\scripts\smartedu_textbook_batch.js --all-electronic --output-dir .\downloads\smartedu_all_electronic
```

### 2. 抓取某个筛选页下的全部教材

```powershell
node .\scripts\smartedu_textbook_batch.js --url 'https://basic.smartedu.cn/tchMaterial?defaultTag=xxx' --output-dir .\downloads\smartedu_page_books
```

### 3. 抓取全站中某类教材

例如抓“小学数学”：

```powershell
node .\scripts\smartedu_textbook_batch.js --all-electronic --stage 小学 --subject 数学 --output-dir .\downloads\smartedu_primary_math
```

例如抓“沪教版高中数学”：

```powershell
node .\scripts\smartedu_textbook_batch.js --all-electronic --stage 高中 --subject 数学 --publisher 沪教版 --output-dir .\downloads\smartedu_highschool_math_hj
```

例如并发下载 4 本：

```powershell
node .\scripts\smartedu_textbook_batch.js --all-electronic --stage 初中 --subject 英语 --concurrency 4 --output-dir .\downloads\smartedu_junior_english
```

## 常用参数

- `--all-electronic`：抓全站所有电子教材
- `--url <列表页>`：抓某个 SmartEdu 筛选页
- `--output-dir <目录>`：输出目录
- `--user-data-dir <目录>`：浏览器用户目录，用于保留登录态
- `--headless`：无头运行
- `--force`：即使文件已存在也重新下载
- `--limit <n>`：只下载前 `n` 本
- `--concurrency <n>`：同时并发下载的教材数量，默认 `1`
- `--resume`：从输出目录已有的 `manifest.json` 恢复进度，默认开启
- `--no-resume`：忽略已有 `manifest.json`，本次从头开始扫描任务
- `--stage <名称>`：学段过滤，如 `小学`、`初中`、`高中`
- `--subject <名称>`：学科过滤，如 `数学`、`语文`
- `--publisher <名称>`：版本过滤，如 `沪教版`、`统编版`
- `--grade <名称>`：年级过滤，如 `一年级`、`高中年级`
- `--volume <名称>`：册次过滤，如 `上册`、`必修 第一册`
- `--tag <名称>`：额外标签过滤，可重复传入
- `--keyword <关键词>`：按标题或出版社名模糊过滤

Windows 路径示例：

- `--output-dir C:\smartedu\downloads`
- `--user-data-dir C:\smartedu\profile`

## 登录说明

- 脚本默认会优先打开本机 Chrome 持久化会话
- 如果本机 Chrome 不可用，会回退到 Playwright Chromium
- 如果某本教材需要登录后才能查看，脚本会提示你先在浏览器中完成登录，再按回车继续
- 并发下载时会复用同一个浏览器登录态，建议先从 `2-4` 的并发数开始
- 每完成一本教材都会立即更新 `manifest.json`，中断后重新运行可继续未完成部分
- 登录态默认保存在：

```bash
.\.smartedu-profile
```

你也可以通过 `--user-data-dir` 指定其他目录。

## 输出结果

每次运行会在输出目录生成：

- 下载好的 PDF 文件
- 文件名默认包含关键标签：`序号_学段_学科_版本_年级_册次_标题_ID.pdf`
- `manifest.json`：记录每本教材的下载结果、详情页地址、输出路径、失败原因等

## 断点续传说明

- 默认会读取输出目录下已有的 `manifest.json`
- 如果某本教材在 `manifest.json` 中已完成，且对应 PDF 仍然存在，重新运行时会直接跳过
- 如果中途中断，已完成部分仍保留在 `manifest.json` 中，下次会从未完成部分继续
- 如果你想无视历史进度重新抓取，可以加 `--force` 或 `--no-resume`

## 不支持的资源类型

- 当前下载器已支持两类资源：
- 普通电子教材：走 PDF 阅读页下载
- `专题课 / thematic_course`：自动从专题资源清单中抓取主 PDF
- 如果遇到平台上其他未知资源类型，才会记为 `unsupported` 并跳过

## 查看帮助

```bash
npm run crawl -- --help
```

## GitHub 上传

当前目录还不是 Git 仓库，所以我已经把前端和脚本写好了，但还没有上传到 GitHub。

如果你要我继续上传，需要二选一：

- 给我一个已有 GitHub 仓库地址
- 或者让我帮你初始化 Git 仓库并连接一个新仓库
