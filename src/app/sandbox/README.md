# 电子沙盘 (Electronic Sandbox)

紫荆雅园城市排水与内涝防治三维电子沙盘。

## 静态沙盘

- 真实 SWMM INP 模型三维可视化
- 节点井筒（CylinderGeometry，井底→地表）
- 管道（TubeGeometry，按 XSECTIONS 管径映射）
- 汇水区（POLYGONS 半透明薄面）
- 旋转/缩放/平移、全景/俯视/地下视图
- 图层开关、对象点击、中文属性面板
- 工程参考面：基于节点地表高程计算的平均平面（非 DEM 地形）

## 动态推演

- 降雨倍率参数配置
- 实时 SWMM 仿真（PySWMM 2.1.0 + SWMM 5.2.004）
- 287 个报告时间步（5 分钟间隔）
- 播放/暂停/继续/停止/重置、0.5×/1×/2×/5× 速度
- 可拖动时间轴，真实 timestamps 复盘
- 节点水柱动画（depth）、管道流向/流速着色（flow + velocity）
- 节点/管道实时属性查看
- ECharts 时间序列曲线（水深/入流/积水/洪泛，流量/水深/流速/容量）
- 每次仿真独立 simulationId（UUID）

## 数据流

```
INP (紫荆雅园_改造后.inp)
  ├─ 前端静态解析 → Three.js 3D 场景（90 节点 / 89 管道 / 汇水区）
  └─ POST /api/swmm → 生成临时 INP（降雨倍率修改）
       └─ PySWMM Simulation.execute() → .out 文件
            └─ PySWMM Output API (LinkAttribute / NodeAttribute)
                 └─ JSON 时间序列 → 前端动态回放
```

## simulationId 目录结构

```
/tmp/swmm_simulations/{simulationId}/
  ├── model.inp      # 临时 INP（降雨已修改）
  ├── model.rpt      # SWMM 报告文件
  ├── model.out      # SWMM 二进制输出
  ├── result.json    # 提取的时间序列 JSON
  └── run.py          # 仿真 Python 脚本
```

- 30 分钟自动清理（`cleanupStaleTasks`）
- 原始 INP 文件不被覆盖

## 环境

| 组件 | 版本 |
|------|------|
| SWMM Engine | 5.2.004 |
| pyswmm | 2.1.0 |
| swmm.toolkit | embedded in pyswmm |
| 模型单位 | SI (CMS = m³/s) |
| Next.js | 16 |
| Three.js | via npm |
| ECharts | via npm |

## 构建与部署

```bash
# 构建
npm run build

# 启动（PM2）
pm2 restart aicourse

# 查看日志
pm2 logs aicourse
```

## 工程参考面说明

当前地面为根据节点地表高程（invert + maxDepth）计算的工程参考平面，不代表真实 DEM 地形。

## 仿真文件清理

仿真临时文件位于 `/tmp/swmm_simulations/`，30 分钟后由服务端自动清理。
