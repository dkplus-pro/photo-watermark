// Dashboard mock 数据(阶段 12,见 docs/admin-enhancement-plan.md)。
//
// TODO(mock):本文件所有数据均为前端 mock,仅用于图表占位演示。
// 待 GET /api/admin/dashboard/summary 落 openapi/admin.yaml 契约后,
// 由 use-dashboard-data.ts 替换 queryFn 接入真实接口,页面结构无需变动,
// 本文件随之删除。

export interface UploadTrendPoint {
  /** 日期(MM-DD) */
  date: string;
  /** 上传类型(图片/视频) */
  type: string;
  /** 当日上传数量 */
  count: number;
}

export interface MediaTypeDistributionItem {
  /** 媒体类型 */
  type: string;
  /** 数量 */
  value: number;
}

export interface StorageUsage {
  /** 已用字节数 */
  usedBytes: number;
  /** 配额字节数 */
  quotaBytes: number;
}

export interface DashboardMockData {
  storageUsage: StorageUsage;
  uploadTrend: UploadTrendPoint[];
  mediaTypeDistribution: MediaTypeDistributionItem[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const TREND_DAYS = 30;

// 用日期序号推导稳定值(不用 Math.random),保证同一天内多次渲染数据一致。
function buildUploadTrend(): UploadTrendPoint[] {
  const points: UploadTrendPoint[] = [];
  const now = Date.now();
  for (let i = TREND_DAYS - 1; i >= 0; i -= 1) {
    const day = new Date(now - i * DAY_MS);
    const date = `${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
    const seed = Math.abs(Math.sin(i * 7.3 + 1.7));
    points.push({ date, type: "图片", count: Math.round(3 + seed * 12) });
    points.push({ date, type: "视频", count: Math.round(seed * 5) });
  }
  return points;
}

export const dashboardMockData: DashboardMockData = {
  storageUsage: {
    usedBytes: 8_912_895_000,
    quotaBytes: 53_687_091_200
  },
  uploadTrend: buildUploadTrend(),
  mediaTypeDistribution: [
    { type: "图片", value: 342 },
    { type: "视频", value: 87 }
  ]
};
