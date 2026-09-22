import { VChart } from "@visactor/react-vchart";
import type { ILineChartSpec } from "@visactor/react-vchart";

import type { UploadTrendPoint } from "./mock";
import "./vchart-theme";

const CHART_HEIGHT = 320;

// 近 30 天上传趋势(折线图,mock 数据,按图片/视频双系列展示)。
export default function UploadTrendChart({ data }: { data: UploadTrendPoint[] }) {
  const spec: ILineChartSpec = {
    type: "line",
    data: [{ id: "uploadTrend", values: data }],
    xField: "date",
    yField: "count",
    seriesField: "type",
    legends: { visible: true, orient: "top", position: "end" },
    point: { style: { size: 4 } }
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
