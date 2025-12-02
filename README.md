FRD Viewer (Vue 3 + three.js)

快速说明：

1) 安装依赖并启动开发服务器：

```powershell
cd "c:\Users\djl\Desktop\cloud cae\frd-viewer"
npm install
npm run dev
```

2) 打开页面后通过页面顶部的 "Load FRD" 按钮选择你的 `.frd` 文件（例如 `anli\_Kasten.frd`）。

3) 当前实现为最小原型：
   - 解析器 `src/utils/frdParser.js` 只提取以 `-1 <id> x y z` 格式的行作为节点坐标（这是文件中常见的一种行）。
   - 前端会把解析得到的节点以 `THREE.Points` 显示。顶部的 Scale 滑块控制位移放大倍数（当前解析器没有提取位移字段，后续会加入）。

后续计划：
- 支持解析时间步、逐节点/逐单元的位移与应力字段
- 支持生成面/体网格（根据单元定义）并做逐单元着色
- 性能优化（大网格分块 / Worker / 后端预处理）

如果你同意，我下一步会：
- 在 `frdParser.js` 中提取并区分静态节点坐标（初始位置）与位移字段（若 FRD 中包含 Ux,Uy,Uz），并示例实现一个带位移的可视化
- 增加 UI 来选择时间步与场（位移/应力）

请告诉我是否现在继续解析位移/时间步（我会基于 `anli\_Kasten.frd` 的实际结构继续实现解析器）。
