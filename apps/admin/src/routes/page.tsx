import { Card, Grid, Spin } from "@arco-design/web-react";

import PageContainer from "../components/page-container";
import MediaTypeDistributionChart from "./dashboard/media-type-chart";
import StatCards from "./dashboard/stat-cards";
import UploadTrendChart from "./dashboard/upload-trend-chart";
import { useDashboardData, useDashboardTotals } from "./dashboard/use-dashboard-data";

const { Row, Col } = Grid;

// 首页仪表盘(阶段 12,见 docs/admin-enhancement-plan.md):
// 统计卡走真实列表接口的 total(存储用量为 mock),两张图表走 mock 数据(见 dashboard/mock.ts 的 TODO)。
// 图表组件(VChart)只在 routes/dashboard/ 内引入,路由级代码分割保证不进主包。
export default function HomePage() {
  const { data: mockData } = useDashboardData();
  const totals = useDashboardTotals();

  return (
    <PageContainer>
      <StatCards
        userTotal={totals.userTotal}
        imageTotal={totals.imageTotal}
        videoTotal={totals.videoTotal}
        storageUsage={totals.storageUsage}
        isPending={totals.isPending}
      />

      <Row gutter={16} style={{ marginTop: 16 }}>
        <Col span={14}>
          <Card title="近 30 天上传趋势">
            {mockData ? (
              <UploadTrendChart data={mockData.uploadTrend} />
            ) : (
              <Spin style={{ display: "block", margin: "140px auto", width: "100%" }} />
            )}
          </Card>
        </Col>
        <Col span={10}>
          <Card title="媒体类型分布">
            {mockData ? (
              <MediaTypeDistributionChart data={mockData.mediaTypeDistribution} />
            ) : (
              <Spin style={{ display: "block", margin: "140px auto", width: "100%" }} />
            )}
          </Card>
        </Col>
      </Row>
    </PageContainer>
  );
}
