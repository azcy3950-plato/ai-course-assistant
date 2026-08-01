# AI 课程助手：智能体 B × 知识图谱

这是一个基于 Next.js、PostgreSQL/pgvector、DeepSeek 与 DashScope Embedding 的课程学习系统。知识问答页将智能体 B 与海绵城市知识图谱双向联动，实现“提问 → 节点匹配 → 临近图谱 → 课程资料检索 → 教学回答 → 学习状态更新 → 下一节点推荐”的闭环。

知识图谱的节点和关系来自：

- https://vanitasbean.github.io/knowledge-map/index_static.html

系统会将远程图谱同步并缓存到 PostgreSQL。智能体返回的节点和关系必须来自数据库，不允许自由编造。

## 主要功能

- 智能体 B 流式课程问答及可追溯引用
- 问题与节点的关键词、Embedding 和课程文档联合匹配
- 42 个知识节点、关系边、技术方法层与原图例展示
- 提问后自动切换到当前节点的临近图谱
- 点击节点后切换当前学习节点，并展示上行、下行和相关关系
- 节点详情、课程资料、前置学习、练习生成和下一节点推荐
- 提问次数、学习次数、测验正确率、最近学习时间和掌握度记录
- 约 5 次有效提问后生成阶段小测

## 环境要求

- Node.js 22 或更高版本
- PostgreSQL 16 或更高版本
- pgvector 扩展
- 可访问知识地图、DeepSeek、DashScope 和 OSS 的网络环境

## 本地启动

1. 安装依赖：

   ```bash
   npm install
   ```

2. 复制环境变量模板：

   ```bash
   cp .env.example .env.local
   ```

   Windows PowerShell：

   ```powershell
   Copy-Item .env.example .env.local
   ```

3. 在 PostgreSQL 目标数据库中启用 pgvector：

   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```

4. 在 `.env.local` 中填写数据库、JWT、AI、Embedding 和 OSS 配置。不要提交该文件。

5. 启动开发服务：

   ```bash
   npm run dev -- -p 3211
   ```

6. 打开：

   - http://localhost:3211/knowledge

知识图谱相关表会在第一次访问接口时自动初始化，远程知识地图同步失败时会使用 PostgreSQL 中最近一次成功缓存的数据。

## 生产构建

```bash
npm run build
npm run start -- -p 3211
```

构建命令会自动把 Cesium 静态资源从 `node_modules` 复制到 `public/Cesium`，因此该目录不需要提交 Git。

## 核心目录

```text
src/app/knowledge/page.tsx                 知识问答与图谱联动页面
src/app/api/agent/route.ts                 智能体 B、检索和 graphContext 接口
src/app/api/knowledge-graph/route.ts       图谱读取与学习状态接口
src/components/KnowledgeGraphPanel.tsx     交互式知识图谱
src/components/KnowledgeNodeDrawer.tsx     知识节点详情和学习操作
src/lib/knowledge-graph.ts                 数据库、匹配、进度和推荐逻辑
src/lib/vanitas-knowledge-map.ts            远程知识地图同步与校验
src/services/agent.ts                      前端智能体与图谱服务
src/types/knowledge-graph.ts               图谱类型定义
```

## 接口返回结构

知识问答接口每轮返回：

```text
answer
references
graphContext
  focusNode
  prerequisites
  relatedNodes
  nextNodes
  highlightNodeIds
  highlightEdges
  suggestedNextNode
```

## 安全说明

- `.env.local`、依赖目录、构建缓存、Cesium 生成文件和本地日志均已加入 `.gitignore`。
- `.env.example` 只包含占位符，不应填写真实密钥后提交。
- 任何曾经公开发送或提交过的 API Key、数据库密码、JWT 密钥和 OSS 密钥都应在对应平台撤销并重新生成。
- `mkuser.js` 与 `process-new.js` 只从环境变量或命令行参数读取配置，不包含默认账号或密码。

创建或更新教师账号：

```bash
node --env-file=.env.local mkuser.js teacher@example.com "YOUR_PASSWORD" "教师" teacher
```
