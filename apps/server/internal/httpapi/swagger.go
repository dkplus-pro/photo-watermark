package httpapi

import (
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strings"
)

// swaggerIndexHTML Swagger UI 页面,静态资源走 CDN;spec 端点列表由 __SPEC_URLS__ 注入。
const swaggerIndexHTML = `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>CMS API - Swagger UI</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.min.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.addEventListener("load", function () {
        window.ui = SwaggerUIBundle({
          __SPEC_URLS__,
          dom_id: "#swagger-ui",
          persistAuthorization: true,
        });
      });
    </script>
  </body>
</html>`

// SwaggerSpec 单个契约挂载项:同时作为 UI 下拉项与 /swagger/<name>.yaml 的服务路径。
type SwaggerSpec struct {
	Name string
	Path string // 为空直接跳过
	// Required 读不到拒绝启动(部署不完整);非必需读不到仅跳过该 spec。
	Required bool
}

// SwaggerOptions Swagger 托管选项(值参数,与 config 包解耦,依赖矩阵见 apps/server/AGENTS.md §1)。
type SwaggerOptions struct {
	Enabled bool
	Specs   []SwaggerSpec
}

// RegisterSwagger 在 mux 上挂载 Swagger UI 与契约文件:
//   - /swagger           → 重定向到 /swagger/
//   - /swagger/          → UI 页面(按已加载契约注入多 spec 下拉)
//   - /swagger/<name>.yaml → 各受众契约(Required 的读不到拒绝启动,其余跳过)
func RegisterSwagger(mux *http.ServeMux, logger *slog.Logger, opts SwaggerOptions) {
	if !opts.Enabled {
		logger.Info("swagger ui disabled")
		return
	}

	specs := map[string][]byte{}
	entries := make([]string, 0, len(opts.Specs))
	for _, spec := range opts.Specs {
		if spec.Path == "" {
			continue
		}
		data, err := os.ReadFile(spec.Path)
		if err != nil {
			if spec.Required {
				logger.Error("swagger enabled but spec file unreadable, refusing to start",
					"name", spec.Name, "path", spec.Path, "error", err)
				panic(fmt.Sprintf("swagger spec not found at %s", spec.Path))
			}
			logger.Warn("swagger spec unreadable, skipping",
				"name", spec.Name, "path", spec.Path, "error", err)
			continue
		}
		specs["/swagger/"+spec.Name+".yaml"] = data
		entries = append(entries, fmt.Sprintf(`{ name: %q, url: "./%s.yaml" }`, spec.Name, spec.Name))
	}
	page := strings.Replace(swaggerIndexHTML, "__SPEC_URLS__",
		"urls: [\n        "+strings.Join(entries, ",\n        ")+",\n      ]", 1)

	mux.HandleFunc("GET /swagger", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/swagger/", http.StatusMovedPermanently)
	})
	mux.HandleFunc("GET /swagger/", func(w http.ResponseWriter, r *http.Request) {
		if spec, ok := specs[r.URL.Path]; ok {
			w.Header().Set("Content-Type", "application/yaml; charset=utf-8")
			_, _ = w.Write(spec)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(page))
	})
	logger.Info("swagger ui enabled", "path", "/swagger", "specs", len(entries))
}
