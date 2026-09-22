import { Card, Grid, Progress, Statistic } from "@arco-design/web-react";

import type { DashboardTotals } from "./use-dashboard-data";

const { Row, Col } = Grid;

function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

// 第一行统计卡:用户/图片/视频总数为真实数据,存储用量为 mock(见 use-dashboard-data.ts 的 TODO)。
export default function StatCards({
  userTotal,
  imageTotal,
  videoTotal,
  storageUsage,
  isPending
}: DashboardTotals) {
  const usedPercent =
    storageUsage.quotaBytes > 0
      ? Math.min(100, Math.round((storageUsage.usedBytes / storageUsage.quotaBytes) * 100))
      : 0;

  const stats: Array<{ title: string; value: string | number }> = [
    { title: "用户总数", value: isPending || userTotal === undefined ? "-" : userTotal },
    { title: "图片总数", value: isPending || imageTotal === undefined ? "-" : imageTotal },
    { title: "视频总数", value: isPending || videoTotal === undefined ? "-" : videoTotal }
  ];

  return (
    <Row gutter={16}>
      {stats.map((stat) => (
        <Col span={6} key={stat.title}>
          <Card>
            <Statistic title={stat.title} value={stat.value} />
          </Card>
        </Col>
      ))}
      <Col span={6}>
        <Card>
          <Statistic
            title="存储用量"
            value={formatBytes(storageUsage.usedBytes)}
            extra={`配额 ${formatBytes(storageUsage.quotaBytes)}`}
          />
          <Progress percent={usedPercent} size="small" showText />
        </Card>
      </Col>
    </Row>
  );
}
