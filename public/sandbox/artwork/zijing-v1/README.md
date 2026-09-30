# 紫荆雅苑方案效果图素材 v1

本目录必须随代码提交。素材均为本任务使用内置 image_gen 制作并由用户确认的图片；未分发用户提供的风格参考原图。文件来源和 SHA-256 见 `provenance.json`。

- `base.png`：固定景观底图，1484 × 1060 像素。
- `green-roof.png`、`bioswale.png`、`rain-garden.png`、`permeable-paving.png`：独立设施素材，保留透明通道。
- 位置、裁剪范围和树冠遮挡蒙版在 `src/lib/sandbox/artwork-layout.json`。

该版本图片路径在应用内固定为 `/sandbox/artwork/zijing-v1/`。发布后不要直接覆盖此版本图片；修改素材或映射时新增版本目录和版本号，以免已保存方案的图片发生变化。

v1 图片配置按社区设施总量表达，继续使用 `artwork-layout.json` 的原始区域。新 v2 图片配置复用这些固定素材，使用独立的 `src/lib/sandbox/landscape-layout.ts` 按十个教学片区合成，支持空间点击、落点拖放和设施标记编辑。景观位置为教学示意，面积、容量和计算使用实际模型；不表示模型各地块的精确设施位置。新增布局不改写本目录素材或已有 v1 快照。
