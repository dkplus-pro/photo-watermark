// 跨资源通用小工具:身份提取、分页与可选参数解引用(一资源一文件,通用件归本文件)。
package handler

import (
	"net/http"

	gen "github.com/cms-template/server/gen/admin"
	"github.com/cms-template/server/internal/httpapi"
)

// claimsUserID 当前登录用户 ID(自我操作守卫用)。
func claimsUserID(r *http.Request) (int64, bool) {
	claims, ok := httpapi.ClaimsFromContext(r.Context())
	return claims.UserID, ok
}

// 通用小工具:分页与可选参数解引用。
func pageParams(page, pageSize *gen.Page) (int, int) {
	p, ps := 1, 20
	if page != nil {
		p = int(*page)
	}
	if pageSize != nil {
		ps = int(*pageSize)
	}
	return p, ps
}

func derefString(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}

func derefBool(v *bool) *bool {
	return v
}

func derefBoolDefault(v *bool, fallback bool) bool {
	if v == nil {
		return fallback
	}
	return *v
}

func derefStatus(v *gen.ListOperationLogsParamsStatus) *string {
	if v == nil {
		return nil
	}
	status := string(*v)
	return &status
}

func genOptsString(v string) *string {
	if v == "" {
		return nil
	}
	return &v
}

func derefInt(v *int) int {
	if v == nil {
		return 0
	}
	return *v
}

func derefInts(v *[]int64) []int64 {
	if v == nil {
		return []int64{}
	}
	return *v
}
