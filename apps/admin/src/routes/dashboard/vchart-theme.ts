import { initVChartArcoTheme } from "@visactor/vchart-arco-theme";

// Arco × VChart 官方接合(arco.design/react/docs/vchart):
// 入口执行一次 initVChartArcoTheme(),VChart 图表即自动套用 Arco 主题(含亮暗跟随)。
// 本模块只在 dashboard 路由内被引入,确保 VChart 相关代码隔离在 dashboard chunk,不进主包。
initVChartArcoTheme();
