package httpapi

import (
	"context"
	"log/slog"
	"net/http"
	"slices"
	"strings"
)

// RoutePermission 单个接口的权限码绑定;code 命名规范:模块:资源:动作(见 docs/api-pages.md)。
// Name 为权限点展示名,ParentMenu 为该 API 点在权限树上挂载的菜单权限点。
type RoutePermission struct {
	Method   string
	Pattern  string // 支持 {id} 路径参数占位
	Code     string
	Name     string
	Menu     string
	MenuName string
}

// RoutePermissions API 权限注册表:服务端鉴权的唯一事实源,
// 启动时由 main 经 repo.UpsertApiPermissions 同步进 permissions 表(type=api)。
var RoutePermissions = []RoutePermission{
	{"GET", "/api/admin/users", "system:user:list", "用户列表", "menu:system:user", "用户管理"},
	{"POST", "/api/admin/users", "system:user:create", "创建用户", "menu:system:user", "用户管理"},
	{"GET", "/api/admin/users/{id}", "system:user:list", "用户列表", "menu:system:user", "用户管理"},
	{"PUT", "/api/admin/users/{id}", "system:user:update", "编辑用户", "menu:system:user", "用户管理"},
	{"DELETE", "/api/admin/users/{id}", "system:user:delete", "删除用户", "menu:system:user", "用户管理"},
	{"PATCH", "/api/admin/users/{id}/status", "system:user:update", "启用禁用用户", "menu:system:user", "用户管理"},
	{"PUT", "/api/admin/users/{id}/roles", "system:user:assign", "分配用户角色", "menu:system:user", "用户管理"},

	{"GET", "/api/admin/roles", "system:role:list", "角色列表", "menu:system:role", "角色管理"},
	{"POST", "/api/admin/roles", "system:role:create", "创建角色", "menu:system:role", "角色管理"},
	{"GET", "/api/admin/roles/{id}", "system:role:list", "角色列表", "menu:system:role", "角色管理"},
	{"PUT", "/api/admin/roles/{id}", "system:role:update", "编辑角色", "menu:system:role", "角色管理"},
	{"DELETE", "/api/admin/roles/{id}", "system:role:delete", "删除角色", "menu:system:role", "角色管理"},
	{"PUT", "/api/admin/roles/{id}/permissions", "system:role:assign", "分配角色权限", "menu:system:role", "角色管理"},
	// 全量角色列表与 /roles 同属角色域读接口;此前漏注册静默降级为"登录即可",权限对账守护测试强制要求登记。
	{"GET", "/api/admin/roles/all", "system:role:list", "全量角色列表", "menu:system:role", "角色管理"},

	{"GET", "/api/admin/permissions", "system:role:assign", "分配角色权限", "menu:system:role", "角色管理"},

	{"GET", "/api/admin/operation-logs", "system:log:list", "操作日志列表", "menu:system:log", "操作日志"},

	{"GET", "/api/admin/configs/{group}", "system:config:list", "读取配置", "menu:system:config", "系统配置"},
	{"PUT", "/api/admin/configs/{group}", "system:config:update", "更新配置", "menu:system:config", "系统配置"},

	{"GET", "/api/admin/dicts", "system:dict:list", "字典列表", "menu:system:dict", "字典管理"},
	{"POST", "/api/admin/dicts", "system:dict:create", "创建字典", "menu:system:dict", "字典管理"},
	{"PUT", "/api/admin/dicts/{id}", "system:dict:update", "编辑字典", "menu:system:dict", "字典管理"},
	{"DELETE", "/api/admin/dicts/{id}", "system:dict:delete", "删除字典", "menu:system:dict", "字典管理"},
	{"GET", "/api/admin/dicts/{code}/items", "system:dict:list", "字典项列表", "menu:system:dict", "字典管理"},
	{"POST", "/api/admin/dicts/{code}/items", "system:dict:update", "创建字典项", "menu:system:dict", "字典管理"},
	{"PUT", "/api/admin/dicts/{code}/items/{itemId}", "system:dict:update", "编辑字典项", "menu:system:dict", "字典管理"},
	{"DELETE", "/api/admin/dicts/{code}/items/{itemId}", "system:dict:update", "删除字典项", "menu:system:dict", "字典管理"},
	{"PATCH", "/api/admin/dicts/{id}/status", "system:dict:update", "字典上下线", "menu:system:dict", "字典管理"},
	{"PUT", "/api/admin/dicts/{id}/entries", "system:dict:update", "覆写字典项", "menu:system:dict", "字典管理"},

	{"GET", "/api/admin/images", "media:image:list", "图片列表", "menu:media:image", "图片管理"},
	{"POST", "/api/admin/images", "media:image:upload", "上传图片", "menu:media:image", "图片管理"},
	{"GET", "/api/admin/images/{id}", "media:image:list", "图片列表", "menu:media:image", "图片管理"},
	{"DELETE", "/api/admin/images/{id}", "media:image:delete", "删除图片", "menu:media:image", "图片管理"},
	// 媒体分组为图片/视频共用能力,权限码独立为 media:group:*;
	// 注册表的 ParentMenu 是单值字段,统一挂"图片管理"菜单(计划文档已注明此取舍)。
	{"GET", "/api/admin/media-groups", "media:group:list", "媒体分组列表", "menu:media:image", "图片管理"},
	{"POST", "/api/admin/media-groups", "media:group:create", "创建媒体分组", "menu:media:image", "图片管理"},
	{"PUT", "/api/admin/media-groups/{id}", "media:group:update", "编辑媒体分组", "menu:media:image", "图片管理"},
	{"DELETE", "/api/admin/media-groups/{id}", "media:group:delete", "删除媒体分组", "menu:media:image", "图片管理"},
	// 移动分组按资源类型复用各自的 update 权限码,不新增移动专用码。
	{"PATCH", "/api/admin/images/{id}/group", "media:image:update", "移动图片分组", "menu:media:image", "图片管理"},
	{"PATCH", "/api/admin/videos/{id}/group", "media:video:update", "移动视频分组", "menu:media:video", "视频管理"},
	{"GET", "/api/admin/videos", "media:video:list", "视频列表", "menu:media:video", "视频管理"},
	{"POST", "/api/admin/videos", "media:video:upload", "上传视频", "menu:media:video", "视频管理"},
	{"GET", "/api/admin/videos/{id}", "media:video:list", "视频列表", "menu:media:video", "视频管理"},
	{"DELETE", "/api/admin/videos/{id}", "media:video:delete", "删除视频", "menu:media:video", "视频管理"},
	// 分片上传(阶段 14):权限只在初始化端点按 kind 静态绑定;分片/状态/合并/中止
	// 不入注册表,仅要求登录 + 会话属主校验。
	{"POST", "/api/admin/uploads/images", "media:image:upload", "上传图片", "menu:media:image", "图片管理"},
	{"POST", "/api/admin/uploads/videos", "media:video:upload", "上传视频", "menu:media:video", "视频管理"},
}

// MatchRoutePermission 按方法与路径匹配注册表;未命中的接口仅需登录。
// 路径裁剪必须用 TrimPrefix + 逐段比较:按字符集 Trim 会把首尾恰好落在
// "/api/admin/" 字符集(/,a,p,i,d,m,n)内的真实路径字符一并吃掉,且旧实现
// 以 "/api/admin/" 作 Split 分隔符永远切不开,导致 {id} 通配端点全部漏配。
func MatchRoutePermission(method, path string) (string, bool) {
	pathSegs := strings.Split(strings.TrimPrefix(path, "/api/admin/"), "/")
	for _, rp := range RoutePermissions {
		if rp.Method != method {
			continue
		}
		patternSegs := strings.Split(strings.TrimPrefix(rp.Pattern, "/api/admin/"), "/")
		if len(patternSegs) != len(pathSegs) {
			continue
		}
		matched := true
		for i, seg := range patternSegs {
			if strings.HasPrefix(seg, "{") && strings.HasSuffix(seg, "}") {
				continue
			}
			if seg != pathSegs[i] {
				matched = false
				break
			}
		}
		if matched {
			return rp.Code, true
		}
	}
	return "", false
}

// PermissionCodesLoader 按用户加载权限码(service 层实现)。
type PermissionCodesLoader func(ctx context.Context, userID int64) ([]string, error)

// PermissionCheck API 权限中间件:命中注册表的接口校验权限码,无权限返回 403。
// 必须挂在 JWT 中间件之后(依赖 claims)。
func PermissionCheck(loader PermissionCodesLoader, logger *slog.Logger) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			code, ok := MatchRoutePermission(r.Method, r.URL.Path)
			if ok {
				claims, has := ClaimsFromContext(r.Context())
				if !has {
					WriteError(w, http.StatusUnauthorized, "未登录或凭证缺失")
					return
				}
				codes, err := loader(r.Context(), claims.UserID)
				if err != nil {
					logger.Error("load permission codes", "error", err)
					WriteError(w, http.StatusInternalServerError, "internal server error")
					return
				}
				if !slices.Contains(codes, code) {
					WriteError(w, http.StatusForbidden, "无权限执行此操作")
					return
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}
