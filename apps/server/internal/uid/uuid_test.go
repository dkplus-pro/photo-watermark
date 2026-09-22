package uid

import (
	"strings"
	"testing"
)

func TestNewUUIDFormat(t *testing.T) {
	id, err := NewUUID()
	if err != nil {
		t.Fatalf("NewUUID() error = %v", err)
	}
	segs := strings.Split(id, "-")
	wantLens := []int{8, 4, 4, 4, 12}
	if len(segs) != len(wantLens) {
		t.Fatalf("uuid %q 段数 = %d, want 5", id, len(segs))
	}
	for i, seg := range segs {
		if len(seg) != wantLens[i] {
			t.Fatalf("uuid %q 第 %d 段长度 = %d, want %d", id, i+1, len(seg), wantLens[i])
		}
		for _, c := range seg {
			if !strings.ContainsRune("0123456789abcdef", c) {
				t.Fatalf("uuid %q 含非小写十六进制字符 %q", id, c)
			}
		}
	}
	if segs[2][0] != '4' {
		t.Fatalf("uuid %q 版本位不是 4", id)
	}
}

func TestNewUUIDUnique(t *testing.T) {
	a, _ := NewUUID()
	b, _ := NewUUID()
	if a == b {
		t.Fatalf("两次生成结果相同: %s", a)
	}
}
