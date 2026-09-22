import { randomBytes } from "node:crypto";

import { expect, test, type Locator, type Page } from "@playwright/test";

// 登录种子管理员进入仪表盘(与首条用例的前置一致,供视频分片上传用例复用)。
async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login$/);
  await page.getByPlaceholder("用户名").fill("admin");
  await page.getByPlaceholder("密码").fill("admin123");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/admin\/?$/);
}

// 从侧边栏进入视频管理并打开上传弹窗。
async function openVideoUploadDialog(page: Page): Promise<Locator> {
  await page.getByText("视频管理").click();
  await expect(page.getByRole("button", { name: "上传视频" })).toBeVisible();
  await page.getByRole("button", { name: "上传视频" }).click();
  const dialog = page.getByRole("dialog", { name: "上传视频" });
  await expect(dialog).toBeVisible();
  return dialog;
}

// 伪视频文件(代码内生成,不落仓库):服务端只校验扩展名与大小上限(2GB),不做内容解析;
// 12MB 配服务端 5MB 分片(5<<20)= 3 片,足以证明分片路径且不拖慢 CI。
function fakeVideoBuffer(): Buffer {
  return randomBytes(12 * 1024 * 1024);
}

test("video chunked upload uploads a 12MB file in chunks and lists it", async ({ page }) => {
  await loginAsAdmin(page);
  const dialog = await openVideoUploadDialog(page);

  const fileName = "chunked-e2e-video.mp4";
  // 记录分片 PUT 请求的索引:完成时应恰好覆盖 12MB=3 片的全部索引,证明走了分片路径。
  const chunkIndexes = new Set<number>();
  page.on("request", (request) => {
    const match = request.url().match(/\/api\/admin\/uploads\/[^/]+\/chunks\/(\d+)$/);
    if (request.method() === "PUT" && match) {
      chunkIndexes.add(Number(match[1]));
    }
  });

  await dialog.locator('input[type="file"]').setInputFiles({
    name: fileName,
    mimeType: "video/mp4",
    buffer: fakeVideoBuffer()
  });

  // 本地分片上传过快,中间进度态难以稳定断言,以完成后的成功 Message 为准;
  // 伪文件不可解码,不做播放断言,列表出现文件名 + 记录存在即视为达成。
  await expect(page.getByText(`视频「${fileName}」已上传`)).toBeVisible({ timeout: 15_000 });
  expect([...chunkIndexes].sort((a, b) => a - b)).toEqual([0, 1, 2]);

  // 上传弹窗成功后不自动关闭,点关闭按钮后列表出现该文件(标题 = 原始文件名)。
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("cell", { name: fileName })).toBeVisible();
});

test("video chunked upload cancel mid-way resets state and re-upload succeeds from scratch", async ({
  page
}) => {
  await loginAsAdmin(page);
  const dialog = await openVideoUploadDialog(page);

  const fileName = "chunked-cancel-video.mp4";
  // 阻断分片 PUT(永不放行)把上传钉在进行中,让"取消"可确定性点击;
  // 取消会从客户端 abort 这些在途请求,pending 的路由处理器随后随 unroute 丢弃。
  await page.route("**/api/admin/uploads/*/chunks/*", () => new Promise<void>(() => {}));

  await dialog.locator('input[type="file"]').setInputFiles({
    name: fileName,
    mimeType: "video/mp4",
    buffer: fakeVideoBuffer()
  });

  // 进行中状态:进度条显示 0%(分片被阻断),取消按钮可用。
  await expect(page.getByText("0% (0.0MB/12.0MB)")).toBeVisible({ timeout: 15_000 });
  // "暂停"按钮只在 uploading 态渲染;进度块在 preparing 态就已出现。若不等它就点击,
  // init 返回、暂停按钮插入会使"取消上传"右移,点击落点漂到"暂停"上(并行时 init 变慢
  // 放大窗口,表现为"取消未生效"),必须等状态确定后再点。
  await expect(page.getByRole("button", { name: "暂停" })).toBeVisible();
  await page.getByRole("button", { name: "取消上传" }).click();

  // 取消后回到可重新上传状态:进度条与取消按钮整体消失(状态复位为 cancelled)。
  await expect(page.getByText("0% (0.0MB/12.0MB)")).toBeHidden();
  await expect(page.getByRole("button", { name: "取消上传" })).toBeHidden();

  // 取消已清除断点续传指纹,重选同一文件应从头正常上传
  // (若指纹未清会弹"发现未完成的视频上传"对账框,上传不会开始,成功提示不会出现)。
  await page.unroute("**/api/admin/uploads/*/chunks/*");
  await dialog.locator('input[type="file"]').setInputFiles({
    name: fileName,
    mimeType: "video/mp4",
    buffer: fakeVideoBuffer()
  });
  await expect(page.getByText(`视频「${fileName}」已上传`)).toBeVisible({ timeout: 15_000 });

  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("cell", { name: fileName })).toBeVisible();
});

test("admin requires login, then renders the landing page", async ({ page }) => {
  // 后台网页整体挂在 /admin 下(basename,见 docs/mvp-plan.md 阶段 8)。
  // 未登录访问业务页被守卫重定向到登录页(/admin/login)。
  await page.goto("/admin");
  // basename 关键断言:守卫重定向后 URL 必须保留 /admin(发现过 runtime 配置文件名
  // 不在约定上导致 basename 静默失效的回归,见 docs/mvp-plan.md 阶段 8 修补)。
  await expect(page).toHaveURL(/\/admin\/login$/);
  await expect(page.getByRole("heading", { name: "CMS 管理后台" })).toBeVisible();
  // 登录页不渲染公共页脚(阶段 16)。
  await expect(page.locator(".app-footer")).toHaveCount(0);

  // 错误口令被拒绝且停留在登录页。
  await page.getByPlaceholder("用户名").fill("admin");
  await page.getByPlaceholder("密码").fill("wrong-password");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByText("用户名或密码错误")).toBeVisible();

  // 种子管理员登录成功进入仪表盘,统计卡为真实接口数据(healthz 经代理连通由各页请求隐式覆盖)。
  await page.getByPlaceholder("密码").fill("admin123");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/admin\/?$/);
  await expect(page.getByText("用户总数")).toBeVisible();
  await expect(page.getByText("近 30 天上传趋势")).toBeVisible();

  // 业务页不渲染页内标题(与面包屑重复,阶段 16 已移除),公共页脚版权可见(阶段 16)。
  await expect(page.locator(".page-title")).toHaveCount(0);
  await expect(page.locator(".app-footer")).toBeVisible();
  await expect(page.locator(".app-footer")).toContainText("© 2026 CMS Template");

  // 顶栏显示当前用户昵称(/auth/me 数据)。
  await expect(page.getByText("管理员")).toBeVisible();

  // 侧边栏目录默认全展开(权限码就绪后仅初始化一次),点击目录可收起、可再展开
  // (回归:受控 openKeys 缺 onOpenKeys 导致展开/收起失效,见 admin-enhancement-plan 阶段 9A)。
  await expect(page.getByText("用户管理")).toBeVisible();
  await page.getByText("系统管理").click();
  await expect(page.getByText("用户管理")).not.toBeVisible();
  await page.getByText("系统管理").click();
  await expect(page.getByText("用户管理")).toBeVisible();

  // 兜底 404 页(arco Result 风格),返回首页可用。
  await page.goto("/admin/no-such-page");
  await expect(page.getByText("抱歉,您访问的页面不存在")).toBeVisible();
  await page.getByRole("button", { name: "返回首页" }).click();
  await expect(page.getByText("用户总数")).toBeVisible();

  // 用户管理:列表加载种子管理员,新建用户成功后出现在表格中。
  await page.getByText("用户管理").click();
  await expect(page).toHaveURL(/\/admin\/system\/users$/);
  // 带 extra 操作区的页面同样无页内标题。
  await expect(page.locator(".page-title")).toHaveCount(0);
  await expect(page.getByRole("cell", { name: "admin", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "新建用户" }).click();
  await page.getByPlaceholder("登录名").fill("bob");
  await page.getByPlaceholder("初始密码").fill("bob-123456");
  await page.getByPlaceholder("显示名", { exact: true }).nth(0).fill("Bob");
  await page.getByRole("button", { name: "确定" }).click();
  await expect(page.getByRole("cell", { name: "bob", exact: true })).toBeVisible();

  // 角色管理页面可达。
  await page.getByText("角色管理").click();
  await expect(page.getByRole("button", { name: "新建角色" })).toBeVisible();

  // 操作日志(业务):创建/删除用户的动作已有描述条目,不出现 HTTP 路径列。
  await page.getByText("操作日志").click();
  await expect(page.getByText("创建用户 Bob(bob)").first()).toBeVisible();
  await expect(page.getByText("user.create").first()).toBeVisible();

  // 系统配置:种子站点名称可见。
  await page.getByText("系统配置").click();
  await expect(page.getByText("站点名称")).toBeVisible();

  // 字典管理:列表页种子字典可见;编辑弹窗里字典项(动态表单)回填。
  await page.getByText("字典管理").click();
  await expect(page.getByRole("cell", { name: "common_status", exact: true })).toBeVisible();
  await page
    .getByRole("row", { name: /common_status/ })
    .getByRole("button", { name: "编辑" })
    .click();
  await expect(page.getByPlaceholder("标签,如 启用").first()).toBeVisible();
  await page.getByRole("button", { name: "取消" }).click();

  // 图片管理:上传(带权限头的内容端点)后网格出现缩略图。
  await page.getByText("图片管理").click();
  await page.getByRole("button", { name: "上传图片" }).click();
  const PNG_1X1 = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAIAAAACUFjqAAAAEElEQVR4nGP8z8Dwn4GBgQEACyoCAqLvVMkAAAAASUVORK5CYII=",
    "base64"
  );
  await page.setInputFiles('input[type="file"]', {
    name: "logo.png",
    mimeType: "image/png",
    buffer: PNG_1X1
  });
  await expect(page.getByText("logo.png").first()).toBeVisible();
  // 上传弹窗为拖拽批量范式,成功后不自动关闭,点关闭按钮继续后续操作。
  await page
    .getByRole("dialog", { name: "上传图片" })
    .getByRole("button", { name: "Close" })
    .click();

  // 视频管理页面可达。
  await page.getByText("视频管理").click();
  await expect(page.getByRole("button", { name: "上传视频" })).toBeVisible();

  // 退出登录回到登录页。
  await page.getByText("管理员", { exact: true }).click();
  await page.getByText("退出登录").click();
  await expect(page).toHaveURL(/\/admin\/login$/);
  await expect(page.getByRole("heading", { name: "CMS 管理后台" })).toBeVisible();
});
