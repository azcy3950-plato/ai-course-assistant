# 海绵城市沙盘（当前版本）

本目录对应当前蓝白风格的「海绵城市沙盘」，案例为紫荆雅苑。它使用平台的导航、登录和样式，需要整个项目一起运行。

## 页面入口

| 路径 | 用途 |
| --- | --- |
| `/sandbox` | 学生设计页，恢复本机草稿 |
| `/sandbox/demo` | 独立案例体验，首次载入四类设施并自动运行 5 年一遇降雨 |
| `/sandbox/legacy` | 保留的原版管网沙盘，见 [旧版说明](legacy/README.md) |

## 当前功能

- 左侧设施工具箱、中间真实地图、右侧空间配置，窄屏使用可折叠侧栏。
- 十个片区内按屋顶、道路、绿地统一配置，保留真实地块及面积、空间适用限制。
- 绿色屋顶、植草沟、雨水花园、透水铺装；支持选择、拖放和修改配置面积。
- 二维/三维查看、滚轮定位缩放、鼠标拖拽、空格平移和键盘控制。
- 真实 SWMM 径流、洪泛、峰值流量和 COD/TN/TP 对比曲线。
- 生态服务卡片突出实际指标，金额为辅助信息；生态核算属于教学估值。
- 草稿自动保存、方案保存/导入/导出、撤销/重做、重置十个片区设施。
- 当前版已移除水位回放时间轴、播放按钮和自动播放；图表的时间坐标保留。

## 在新电脑上运行

需要 Node.js 22.12+（或 24 LTS）、npm、64 位 Python 3.10–3.13。首次安装需要联网。

在**项目根目录**执行：

```sh
npm ci
npm run sandbox:setup
npm run dev
```

然后打开 `http://localhost:3000/sandbox` 或 `/sandbox/demo`。

`sandbox:setup` 会创建项目自己的 `.venv`，从 `requirements-sandbox.txt` 安装固定版本的 SWMM 工具包。无需复制原开发电脑的 Python、`.runtime` 或编辑器目录。

如果存在多个 Python，可以指定解释器（路径仅在本机使用）：

```sh
npm run sandbox:setup -- /path/to/python3.12
```

Windows PowerShell 示例：

```powershell
npm run sandbox:setup -- "C:\Python312\python.exe"
```

后端按以下顺序寻找解释器：`SWMM_PYTHON` 环境变量 → 项目 `.venv` → 系统 `python`（Windows）/`python3`（Linux、macOS）。自行设置 `SWMM_PYTHON` 时，需在该解释器中安装 `requirements-sandbox.txt`。

Linux 若缺少 venv/pip，请先安装对应 Python 的 venv 包。非 x64 机器是否有可用二进制轮子取决于 SWMM 工具包支持情况。

### 环境配置与登录

仅在 `npm run dev` 且通过 localhost/127.0.0.1 访问时，当前沙盘可直接运行，不依赖 AI 或数据库服务。平台完整登录及其他课程功能的配置见根目录 [README](../../../README.md)。

需要配置时将 `.env.example` 复制为 `.env.local`，只在本机或服务器中填写真实值。正式运行仍使用平台 JWT 登录校验，不开放匿名计算。

```sh
npm run build
npm start
```

SWMM 需要可执行 Python 子进程且可写磁盘的 Node.js 服务环境。GitHub 用于保存源码；GitHub Pages 不能运行这个后端。

## 验证

```sh
npm run check
npm run sandbox:verify-source
npm run sandbox:test
npm run build
```

浏览器验收：先启动 `npm run dev`，在另一个终端执行：

```sh
npx playwright install chromium
npm run sandbox:test:browser
```

Linux 自动化环境可用 `npx playwright install --with-deps chromium` 安装浏览器及系统依赖。

- `SANDBOX_BASE_URL` 可设置本机测试端口，默认 `http://localhost:3000`。
- `PLAYWRIGHT_CHANNEL=msedge` 可改用已安装的 Edge；默认使用 Playwright Chromium。
- 验收运行在独立浏览器上下文，不读写用户当前浏览器的草稿。
- 视图控制测试使用明确标记的界面测试数据；生态重置和案例预览测试调用真实 SWMM。
- 预览验收会比较原始 `.rpt` 报告，缓存命中时通过 `runId` 找到对应报告。
- 截图和运行记录输出到 `artifacts/`，不提交 Git。

## 源码与数据

```text
src/app/sandbox/page.tsx              主页面入口
src/app/sandbox/demo/page.tsx         独立案例体验入口
src/components/sandbox/              界面、二维/三维地图、视图控制、结果图表
src/lib/sandbox/                     空间合并、面积校验、INP 编译、生态公式
src/app/api/sandbox/model/route.ts   真实场地模型接口
src/app/api/sandbox/run/route.ts     SWMM 调用、缓存、报告汇总
scripts/sandbox-run.py               Python 引擎执行及结果提取
scripts/sandbox-setup.mjs            跨平台依赖安装
requirements-sandbox.txt             Python 依赖版本
public/zijing_inp.inp                必须提交的原始案例模型
```

计算会在 `.sandbox-runs/<id>/` 写入临时 INP、报告、二进制输出及 JSON，不覆盖原模型。`runId` 保留缓存结果的原始计算目录编号。停止服务后可清理 `.sandbox-runs/`；它不需要上传。

当前案例的水质质量平衡误差偏大，页面会提示校核，不能将教学输出当作已校准的工程预测。生态参数可在页面「查看计算依据」中查看。

## 上传到 GitHub

在 GitHub Desktop 中使用 **File → Add local repository…** 选择这个项目根目录（包含 `.git` 和 `package.json` 的目录）。在 **Changes** 中同时勾选修改文件和新增文件，填写提交说明「补齐景观沙盘交互及资源校验」，点击 **Commit to main**，再点击 **Push origin**。如果使用其他分支，Commit 按钮会显示该分支名称。

本次需要一起提交景观交互源码、`public/sandbox/artwork/zijing-v1/` 的五张 PNG 及来源记录、测试、文档、`package.json`、`package-lock.json`、`.gitattributes` 和 `scripts/sandbox-verify-source.mjs`。已有的原始模型和 Python 安装/运行脚本继续保留在仓库中。

`npm run sandbox:verify-source` 检查五张图片的 SHA-256、尺寸和裁剪范围，并确认原始模型、Python 脚本和 npm 依赖清单完整。`npm run build` 会先自动执行这项检查，漏传资源时会指出具体文件。该检查无需 Git、Python、API 密钥或启动本地服务；下载 ZIP 后也能运行。`.gitattributes` 保证景观 PNG 不进行文本换行转换。

### 保存方案效果图

主视图区默认显示可交互的「俯视编辑」，可点击真实地块和片区标签，也可通过片区下拉框直接跳转 Z01–Z10。四种措施各有独立的添加按钮，当前片区的四项面积及地图标记会即时更新。「景观效果」支持点击片区标签定位、点击屋顶/道路/绿地打开设施配置，以及从工具箱拖放设施到落点片区。点击已布置的设施标记可调整该类设施的合计面积、移除，再通过撤销恢复；所有视图共用同一份模型配置。「三维查看」继续保留。

沙盘提供「查看效果图」；点击「保存方案」会保存配置快照并自动打开效果图。「我的实验」显示已保存方案的缩略图，点击缩略图可重新查看、下载 PNG。旧方案没有图片元数据也可根据原配置生成效果图。

本机方案及设施编号支持没有 `crypto.randomUUID` 的 HTTP 浏览器环境，预览和保存不依赖该接口。

采用固定底图、透明设施素材和浏览器确定性合成，不需要图像生成 API、密钥或额外后端服务。保存记录只存设施配置、计算结果和轻量图片配置，不把大幅 PNG 写入 localStorage。导出的方案 JSON 可继续导入。

新效果图使用 v2 配置，按 Z01–Z10 分别显示四类设施，片区内设施面积控制该片区的示意覆盖范围；主景观图与保存图片使用相同的合成规则。已有 v1 图片配置保留原来的社区总量合成方式，不重写旧快照。蓄水深度、含乔木配置及降雨写入图片说明。原有景观树木属于固定背景，未模拟树木数量或生长。景观图采用人工划定的教学片区及空间热点，尚未逐地块精确配准；设施面积、容量约束和计算均使用原模型，合计面积按同片区同类空间分配。小设施设置了最小视觉尺寸，图片不用于量取面积。

需一起提交：

```text
public/sandbox/artwork/zijing-v1/     固定底图、四类透明素材和来源记录
src/lib/sandbox/artwork-layout.json 已校准视觉区域及树冠遮挡
src/lib/sandbox/landscape-layout.ts 十个教学片区的景观热点和设施示意区域
src/lib/sandbox/artwork.ts          参数汇总、版本和图片配置
src/lib/sandbox/artwork-renderer.ts 画面合成及带说明的 PNG 导出
src/components/sandbox/PlanArtwork.tsx
src/components/sandbox/LandscapeViewport.tsx
src/lib/sandbox/id.ts
src/components/sandbox/StudentSandbox.tsx
src/components/sandbox/studio.module.css
tests/sandbox-artwork.test.ts
tests/sandbox-artwork.browser.mjs
tests/sandbox-landscape-editing.browser.mjs
```

图片资源使用站内路径，代码不依赖开发电脑的绝对路径、临时目录或 `artifacts/`。五张图片合计约 11 MB，作为普通图片文件纳入仓库。图片版本应新增发布，保留旧版本以支持已有方案。

效果图验证：

```sh
npx vitest run tests/sandbox-artwork.test.ts
# 先启动 npm run dev，再运行：
node tests/sandbox-artwork.browser.mjs
node tests/sandbox-landscape.browser.mjs
node tests/sandbox-landscape-editing.browser.mjs
```

浏览器验收使用独立上下文和真实模型接口，检查空方案、参数变化、旧方案、快照恢复、PNG 下载和素材加载失败后重试。景观交互验收覆盖 Z10 的四类空间布置、跨片区原生拖放、错误空间拒绝、标记编辑/删除/撤销、按片区像素变化及手机操作。使用 `SANDBOX_BASE_URL` 指定测试端口。

以**当前项目仓库**为单位提交，保留已有平台代码、`package.json`、`package-lock.json` 和原始模型。新增的 `src/components/sandbox/`、`src/lib/sandbox/`、`src/app/api/sandbox/`、`demo/`、`legacy/`、安装脚本及测试文件必须一起提交，不能只提交 `page.tsx`。

GitHub Desktop 中检查 Changes，提交沙盘源码、依赖清单、文档、`.env.example` 和 `.gitignore`，再使用 Push origin 上传。

`.gitignore` 已排除真实环境配置、`.venv`、`.runtime`、`.sandbox-runs`、`node_modules`、`.next`、截图、临时报告和本地参考附件。已被 Git 跟踪的旧资料不会因忽略规则自动删除；本次未改动其历史。

上传源码不会携带浏览器中的草稿和保存方案；如需迁移方案，使用页面「导出方案」生成 JSON，在新电脑「导入方案」。
