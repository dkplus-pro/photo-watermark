import { VChart } from "@visactor/react-vchart";
import type { IPieChartSpec } from "@visactor/react-vchart";

import type { MediaTypeDistributionItem } from "./mock";
import "./vchart-theme";

const CHART_HEIGHT = 320;

// 媒体类型分布(饼图,mock 数据)。
export default function MediaTypeDistributionChart({
  data
}: {
  data: MediaTypeDistributionItem[];
}) {
  const spec: IPieChartSpec = {
    type: "pie",
    data: [{ id: "mediaTypeDistribution", values: data }],
    categoryField: "type",
    valueField: "value",
    outerRadius: 0.8,
    innerRadius: 0.5,
    label: { visible: true },
    legends: { visible: true, orient: "right" }
  };

  // autoFit:容器宽度自适应(窗口 resize 自动重排)
  return (
    <VChart
      spec={spec}
      options={{ autoFit: true }}
      style={{ width: "100%", height: CHART_HEIGHT }}
    />
  );
}
