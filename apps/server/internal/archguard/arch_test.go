package archguard

// 架构守护测试:只读检查,不依赖任何被检包的实现。
// 矩阵与豁免口径见 apps/server/AGENTS.md §1/§7;存量越层豁免在阶段 2 收口(S2.3)清零,此后不得新增。

import (
	"bytes"
	"encoding/json"
	"io"
	"os/exec"
	"strings"
	"testing"
)

const modulePrefix = "github.com/cms-template/server/internal/"

// allowedDeps 依赖方向矩阵(与 apps/server/AGENTS.md §1 表一一对应):
// 键为 internal/ 下包短名,值为允许依赖的 internal 包短名;handler 含各受众子包。
// 未登记的包一律按叶子包处理(零 internal 依赖)——新增包必须先在此登记,再写代码。
var allowedDeps = map[string][]string{
	"handler":   {"httpapi", "service", "media", "uploads", "types"}, // gen 在 internal 外,不受本守护约束
	"service":   {"repo", "types", "auth", "oplog", "reqctx"},
	"media":     {"repo", "storage", "oplog", "reqctx"},
	"uploads":   {"media", "storage", "uid"},
	"repo":      {},
	"httpapi":   {"auth", "reqctx"},
	"oplog":     {"repo", "reqctx"},
	"reqctx":    {},
	"uid":       {},
	"types":     {},
	"auth":      {},
	"config":    {},
	"storage":   {"uid"}, // 对象存储访问层,仅依赖 uid(对象命名);AGENTS.md §1 表待 S6.3 补该行
	"archguard": {},      // 架构守护测试包,仅测试文件,零 internal 依赖
}

// exemptedDeps 越层豁免清单:S2.3 已全部清零(AGENTS.md §7:清零后不再新增,
// 守护测试不得加豁免;保留空清单作为防腐化检查的挂载点)。
var exemptedDeps = map[string]string{}

// TestInternalImportDirection 以 go list 实测 import 方向,断言矩阵与豁免双向一致。
// 只检查非测试 import:测试文件按纪律可用 sqlite :memory: 真库直连 repo,不纳入矩阵。
func TestInternalImportDirection(t *testing.T) {
	out, err := exec.Command("go", "list", "-json", "github.com/cms-template/server/internal/...").Output()
	if err != nil {
		t.Fatalf("go list 执行失败: %v", err)
	}
	observed := map[string]bool{} // "from->to" 实测越层边
	dec := json.NewDecoder(bytes.NewReader(out))
	for {
		var pkg struct {
			ImportPath string
			Imports    []string
		}
		if err := dec.Decode(&pkg); err == io.EOF {
			break
		} else if err != nil {
			t.Fatalf("解析 go list 输出失败: %v", err)
		}
		from := strings.TrimPrefix(pkg.ImportPath, modulePrefix)
		if from == pkg.ImportPath {
			continue
		}
		isHandler := from == "handler" || strings.HasPrefix(from, "handler/")
		allowed, known := allowedDeps[from]
		if isHandler {
			// 受众子包(handler/app 等)沿用 handler 规则,无需逐个登记
			allowed, known = allowedDeps["handler"], true
		}
		if !known {
			t.Errorf("internal 包 %q 未登记依赖矩阵(apps/server/AGENTS.md §1),按叶子包处理;若需依赖请先改矩阵再写代码", from)
		}
		for _, imp := range pkg.Imports {
			to, ok := strings.CutPrefix(imp, modulePrefix)
			if !ok {
				continue
			}
			switch {
			case isHandler && (to == "handler" || strings.HasPrefix(to, "handler/")):
				observed[from+"->"+to] = true
				t.Errorf("受众 handler 子包禁止互引: %s -> %s", from, to)
			case !isHandler && !known:
				// 叶子包禁止任何 internal 依赖
				observed[from+"->"+to] = true
				t.Errorf("叶子包 %s 依赖了 internal 包 %s", from, to)
			case !contains(allowed, to):
				observed[from+"->"+to] = true
				if reason, exempt := exemptedDeps[from+"->"+to]; exempt {
					t.Logf("豁免越层 %s -> %s(%s)", from, to, reason)
					continue
				}
				t.Errorf("依赖越层: %s -> %s 不在允许矩阵内;需要新依赖先改 apps/server/AGENTS.md §1 矩阵", from, to)
			}
		}
	}
	for key, reason := range exemptedDeps {
		if !observed[key] {
			t.Errorf("豁免条目 %q(%s)已无对应真实越层,请从 exemptedDeps 删除", key, reason)
		}
	}
}

func contains(list []string, v string) bool {
	for _, s := range list {
		if s == v {
			return true
		}
	}
	return false
}
