package archguard

// 权限对账守护测试:admin.yaml 契约 ↔ httpapi.RoutePermissions 注册表双向断言。
// 漏一条注册 = 该端点静默降级为"登录即可";幽灵条目 = 注册表指向不存在的契约端点。口径见 apps/server/AGENTS.md §6。

import (
	"fmt"
	"strings"
	"testing"

	"github.com/cms-template/server/internal/httpapi"
	"github.com/getkin/kin-openapi/openapi3"
)

const adminContractPath = "../../../../openapi/admin.yaml" // 测试 cwd 为本包目录:internal/archguard 上溯至仓库根

// publicEndpoints 免鉴权白名单(JWTSkipPaths,AGENTS.md §6 规定仅此两处)。
var publicEndpoints = map[string]string{
	"GET /api/admin/healthz":     "存活探针",
	"POST /api/admin/auth/login": "登录",
}

// loginOnlyEndpoints 登录即可端点:仅要求 JWT、无权限码;必须在契约中存在,且不得进入注册表。
var loginOnlyEndpoints = map[string]string{
	"POST /api/admin/auth/logout":                      "注销",
	"GET /api/admin/auth/me":                           "当前用户信息",
	"PUT /api/admin/auth/password":                     "修改本人密码",
	"GET /api/admin/files/{id}/content":                "媒体内容预览/播放(handler/media.go 注释:登录即可)",
	"GET /api/admin/uploads/{uploadId}":                "分片上传状态(注册表注释:仅要求登录+会话属主校验)",
	"DELETE /api/admin/uploads/{uploadId}":             "分片上传中止",
	"PUT /api/admin/uploads/{uploadId}/chunks/{index}": "分片写入",
	"POST /api/admin/uploads/{uploadId}/complete":      "分片合并",
}

// TestAdminContractPermissionReconciliation 契约与权限注册表双向对账 + 分类清单防腐化。
func TestAdminContractPermissionReconciliation(t *testing.T) {
	loader := openapi3.NewLoader()
	doc, err := loader.LoadFromFile(adminContractPath)
	if err != nil {
		t.Fatalf("加载契约 %s 失败: %v", adminContractPath, err)
	}
	if err := doc.Validate(loader.Context); err != nil {
		t.Fatalf("契约校验失败: %v", err)
	}

	contract := map[string]bool{} // "METHOD {规范化路径}",占位符统一为 {}
	publicSet := normalizeKeys(publicEndpoints)
	loginOnlySet := normalizeKeys(loginOnlyEndpoints)
	for path, item := range doc.Paths.Map() {
		for method := range item.Operations() {
			contract[normalizeEndpoint(method, path)] = true
		}
	}
	if len(contract) == 0 {
		t.Fatal("契约未解析到任何端点,检查加载路径是否正确")
	}

	// 契约 → 注册表:非公开、非登录即可的端点必须命中注册表(复用生产匹配逻辑)
	for key := range contract {
		if _, isPublic := publicSet[key]; isPublic {
			continue
		}
		if _, isLoginOnly := loginOnlySet[key]; isLoginOnly {
			continue
		}
		method, path := splitEndpoint(key)
		if _, ok := httpapi.MatchRoutePermission(method, path); !ok {
			t.Errorf("契约端点 %q 未注册权限码(静默降级为登录即可):请登记 RoutePermissions,或显式归入登录即可清单", key)
		}
	}

	// 注册表 → 契约:每条注册条目必须在契约中存在,且不得与公开/登录即可清单重叠
	for _, rp := range httpapi.RoutePermissions {
		key := normalizeEndpoint(rp.Method, rp.Pattern)
		if !contract[key] {
			t.Errorf("注册表条目 %q 在 admin.yaml 中不存在(幽灵条目)", key)
		}
		if reason, ok := publicSet[key]; ok {
			t.Errorf("注册表条目 %q 与公开端点清单重叠(%s)", key, reason)
		}
		if reason, ok := loginOnlySet[key]; ok {
			t.Errorf("注册表条目 %q 与登录即可清单重叠(%s)", key, reason)
		}
	}

	// 分类清单 → 契约:清单条目必须真实存在于契约(防清单腐化)
	for key, reason := range publicSet {
		if !contract[key] {
			t.Errorf("公开端点清单条目 %q(%s)在契约中不存在", key, reason)
		}
	}
	for key, reason := range loginOnlySet {
		if !contract[key] {
			t.Errorf("登录即可清单条目 %q(%s)在契约中不存在", key, reason)
		}
	}
}

// normalizeKeys 将分类清单的键归一为 "METHOD {规范化路径}" 形态。
func normalizeKeys(m map[string]string) map[string]string {
	out := make(map[string]string, len(m))
	for k, v := range m {
		method, path := splitEndpoint(k)
		out[normalizeEndpoint(method, path)] = v
	}
	return out
}

// normalizeEndpoint 统一端点键:方法大写 + 占位符段归一为 {},避免占位符命名差异误报。
func normalizeEndpoint(method, path string) string {
	segs := strings.Split(path, "/")
	for i, seg := range segs {
		if strings.HasPrefix(seg, "{") && strings.HasSuffix(seg, "}") {
			segs[i] = "{}"
		}
	}
	return fmt.Sprintf("%s %s", strings.ToUpper(method), strings.Join(segs, "/"))
}

func splitEndpoint(key string) (method, path string) {
	parts := strings.SplitN(key, " ", 2)
	return parts[0], parts[1]
}
