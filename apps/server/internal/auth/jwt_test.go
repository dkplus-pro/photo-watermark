package auth

import (
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const testSecret = "auth-unit-test-secret"

func mustSignToken(t *testing.T, secret string, userID int64, username string, ttl time.Duration) string {
	t.Helper()
	token, _, err := SignToken(secret, userID, username, ttl)
	if err != nil {
		t.Fatalf("SignToken(secret=%q, uid=%d, username=%q, ttl=%v): %v", secret, userID, username, ttl, err)
	}
	return token
}

func mustVerifyToken(t *testing.T, secret, tokenString string) Claims {
	t.Helper()
	claims, err := VerifyToken(secret, tokenString)
	if err != nil {
		t.Fatalf("VerifyToken: %v", err)
	}
	return claims
}

// checkZeroClaims 校验失败路径返回零值 Claims(Claims 内嵌 Audience 切片,不可整体 == 比较)。
func checkZeroClaims(t *testing.T, claims Claims) {
	t.Helper()
	if claims.UserID != 0 || claims.Username != "" || claims.Subject != "" ||
		claims.ExpiresAt != nil || claims.IssuedAt != nil {
		t.Fatalf("失败时应返回零值 claims, got %+v", claims)
	}
}

// TestSignVerifyRoundTrip 签发→校验往返,UserID/Username 透传,Subject 同步写入。
func TestSignVerifyRoundTrip(t *testing.T) {
	cases := []struct {
		name     string
		userID   int64
		username string
	}{
		{"常规用户", 42, "admin"},
		{"零值 userID 与空 username", 0, ""},
		{"unicode username", 7, "管理员"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			token, expiresAt, err := SignToken(testSecret, tc.userID, tc.username, time.Hour)
			if err != nil {
				t.Fatalf("SignToken: %v", err)
			}
			if token == "" {
				t.Fatal("token 不应为空")
			}
			if !expiresAt.After(time.Now()) {
				t.Fatalf("expiresAt 应在未来, got %v", expiresAt)
			}
			claims := mustVerifyToken(t, testSecret, token)
			if claims.UserID != tc.userID {
				t.Fatalf("UserID = %d, want %d", claims.UserID, tc.userID)
			}
			if claims.Username != tc.username {
				t.Fatalf("Username = %q, want %q", claims.Username, tc.username)
			}
			if claims.Subject != tc.username {
				t.Fatalf("Subject = %q, want 同 username %q", claims.Subject, tc.username)
			}
		})
	}
}

// TestSignVerifyEmptySecret 零值边界:HMAC 允许空 key,当前实现不拦截空 secret
// (secret 配置正确性由上层 config 把关),记录往返行为。
func TestSignVerifyEmptySecret(t *testing.T) {
	token, _, err := SignToken("", 1, "alice", time.Hour)
	if err != nil {
		t.Fatalf("SignToken(空 secret): %v", err)
	}
	claims := mustVerifyToken(t, "", token)
	if claims.UserID != 1 || claims.Username != "alice" {
		t.Fatalf("claims 透传不符: %+v", claims)
	}
}

// TestSignTokenExpirySemantics exp/iat 语义:ExpiresAt 与 SignToken 返回值一致,
// IssuedAt 落在签发时间窗口内,exp 晚于 iat。
func TestSignTokenExpirySemantics(t *testing.T) {
	before := time.Now()
	token, expiresAt, err := SignToken(testSecret, 1, "alice", time.Hour)
	if err != nil {
		t.Fatalf("SignToken: %v", err)
	}
	after := time.Now()

	if expiresAt.Before(before.Add(time.Hour)) || expiresAt.After(after.Add(time.Hour)) {
		t.Fatalf("expiresAt = %v, want ≈ %v", expiresAt, before.Add(time.Hour))
	}

	claims := mustVerifyToken(t, testSecret, token)
	if claims.ExpiresAt == nil {
		t.Fatal("claims 缺少 exp")
	}
	if d := claims.ExpiresAt.Time.Sub(expiresAt); d > 2*time.Second || d < -2*time.Second {
		t.Fatalf("claims.ExpiresAt = %v, want ≈ SignToken 返回的 %v", claims.ExpiresAt.Time, expiresAt)
	}
	if claims.IssuedAt == nil {
		t.Fatal("claims 缺少 iat")
	}
	// NumericDate 序列化按秒截断,窗口下界放宽 1 秒。
	if claims.IssuedAt.Time.Before(before.Add(-time.Second)) || claims.IssuedAt.Time.After(after) {
		t.Fatalf("IssuedAt = %v, want 在签发窗口 [%v, %v] 内(按秒截断)", claims.IssuedAt.Time, before, after)
	}
	if !claims.ExpiresAt.Time.After(claims.IssuedAt.Time) {
		t.Fatalf("exp(%v) 应晚于 iat(%v)", claims.ExpiresAt.Time, claims.IssuedAt.Time)
	}
}

// TestVerifyTokenExpired 过期 token 必须拒绝。
func TestVerifyTokenExpired(t *testing.T) {
	token := mustSignToken(t, testSecret, 1, "alice", -time.Minute)
	claims, err := VerifyToken(testSecret, token)
	if !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("过期 token 应返回 ErrInvalidToken, got %v", err)
	}
	checkZeroClaims(t, claims)
}

// TestVerifyTokenWrongSecret secret A 签发、secret B 校验必须拒绝。
func TestVerifyTokenWrongSecret(t *testing.T) {
	token := mustSignToken(t, "secret-a", 1, "alice", time.Hour)
	claims, err := VerifyToken("secret-b", token)
	if !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("secret 不符应返回 ErrInvalidToken, got %v", err)
	}
	checkZeroClaims(t, claims)
}

// TestVerifyTokenAlgConfusion alg 混淆:none 算法与跨家族(RS256)token 必须拒绝。
func TestVerifyTokenAlgConfusion(t *testing.T) {
	t.Run("none 算法拒绝", func(t *testing.T) {
		token, err := jwt.NewWithClaims(jwt.SigningMethodNone, Claims{
			UserID:   1,
			Username: "alice",
			RegisteredClaims: jwt.RegisteredClaims{
				ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
			},
		}).SignedString(jwt.UnsafeAllowNoneSignatureType)
		if err != nil {
			t.Fatalf("构造 none token: %v", err)
		}
		if _, err := VerifyToken(testSecret, token); !errors.Is(err, ErrInvalidToken) {
			t.Fatalf("none 算法必须拒绝, got %v", err)
		}
	})

	t.Run("RS256 混淆拒绝", func(t *testing.T) {
		key, err := rsa.GenerateKey(rand.Reader, 2048)
		if err != nil {
			t.Fatalf("生成 RSA 密钥: %v", err)
		}
		token, err := jwt.NewWithClaims(jwt.SigningMethodRS256, Claims{
			UserID:   1,
			Username: "alice",
			RegisteredClaims: jwt.RegisteredClaims{
				ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
			},
		}).SignedString(key)
		if err != nil {
			t.Fatalf("构造 RS256 token: %v", err)
		}
		if _, err := VerifyToken(testSecret, token); !errors.Is(err, ErrInvalidToken) {
			t.Fatalf("HS/RS 混淆必须拒绝, got %v", err)
		}
	})
}

// TestVerifyTokenHMACFamilyNotPinned 记录当前实现的已知宽松点:keyFunc 只断言
// *jwt.SigningMethodHMAC 家族,未收窄到 HS256,因此同 secret 的 HS384/HS512 token
// 也能通过校验。这不构成直接漏洞(攻击者仍需持有 secret 才能签出 HMAC token),
// 属于纵深防御缺口;实现文件本次禁改,由总指挥决策是否收窄。若后续实现改为
// 仅接受 HS256,请把本测试的断言翻转为必须拒绝。
func TestVerifyTokenHMACFamilyNotPinned(t *testing.T) {
	for _, method := range []*jwt.SigningMethodHMAC{jwt.SigningMethodHS384, jwt.SigningMethodHS512} {
		t.Run(method.Alg(), func(t *testing.T) {
			token, err := jwt.NewWithClaims(method, Claims{
				UserID:   1,
				Username: "alice",
				RegisteredClaims: jwt.RegisteredClaims{
					ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
				},
			}).SignedString([]byte(testSecret))
			if err != nil {
				t.Fatalf("构造 %s token: %v", method.Alg(), err)
			}
			claims, err := VerifyToken(testSecret, token)
			// 记录当前行为:同 secret 的同家族(HMAC)其他算法可通过校验。
			if err != nil {
				t.Fatalf("当前实现预期接受同 secret 的 %s token, got %v", method.Alg(), err)
			}
			if claims.UserID != 1 || claims.Username != "alice" {
				t.Fatalf("claims 透传不符: %+v", claims)
			}
		})
	}
}

// TestVerifyTokenInvalidInput 非法输入边界:空 token、垃圾字符串、残缺分段、
// 非法编码、非 JSON 载荷,均返回 ErrInvalidToken 与零值 claims。
func TestVerifyTokenInvalidInput(t *testing.T) {
	garbagePayload := base64.RawURLEncoding.EncodeToString([]byte("not-json"))
	cases := []struct {
		name string
		in   string
	}{
		{"空 token", ""},
		{"纯垃圾字符串", "garbage-not-a-token"},
		{"三段全垃圾", "aaa.bbb.ccc"},
		{"缺签名段", "eyJhbGciOiJIUzI1NiJ9.eyJ1aWQiOjF9"},
		{"payload 非法 base64", "eyJhbGciOiJIUzI1NiJ9.!!!.c2ln"},
		{"payload 非 JSON", "eyJhbGciOiJIUzI1NiJ9." + garbagePayload + ".c2ln"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			claims, err := VerifyToken(testSecret, tc.in)
			if !errors.Is(err, ErrInvalidToken) {
				t.Fatalf("非法输入 %q 应返回 ErrInvalidToken, got %v", tc.in, err)
			}
			checkZeroClaims(t, claims)
		})
	}
}

// flipLastChar 把 base64url 字符串最后一个字符替换为不同字符,保证签名输入变化。
func flipLastChar(s string) string {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
	if s == "" {
		return "B"
	}
	repl := byte('A')
	for i := 0; i < len(alphabet); i++ {
		if alphabet[i] != s[len(s)-1] {
			repl = alphabet[i]
			break
		}
	}
	return s[:len(s)-1] + string(repl)
}

// TestVerifyTokenForgedToken 伪造 token:篡改 payload 或签名任一段,签名校验必须失败。
func TestVerifyTokenForgedToken(t *testing.T) {
	token := mustSignToken(t, testSecret, 42, "admin", time.Hour)
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		t.Fatalf("token 应为三段, got %d", len(parts))
	}

	t.Run("篡改 payload", func(t *testing.T) {
		forged := parts[0] + "." + flipLastChar(parts[1]) + "." + parts[2]
		if _, err := VerifyToken(testSecret, forged); !errors.Is(err, ErrInvalidToken) {
			t.Fatalf("篡改 payload 必须拒绝, got %v", err)
		}
	})

	t.Run("篡改签名", func(t *testing.T) {
		forged := parts[0] + "." + parts[1] + "." + flipLastChar(parts[2])
		if _, err := VerifyToken(testSecret, forged); !errors.Is(err, ErrInvalidToken) {
			t.Fatalf("篡改签名必须拒绝, got %v", err)
		}
	})
}

// TestVerifyTokenPayloadMissingFields 缺字段载荷边界:签名合法即通过,
// VerifyToken 不校验业务字段存在性,缺失的 uid/username 解析为零值
// (字段存在性与非零校验由上层 service/middleware 把关),记录当前行为。
func TestVerifyTokenPayloadMissingFields(t *testing.T) {
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"exp": time.Now().Add(time.Hour).Unix(),
		"iat": time.Now().Unix(),
		"sub": "ghost",
	}).SignedString([]byte(testSecret))
	if err != nil {
		t.Fatalf("构造缺字段 token: %v", err)
	}
	claims := mustVerifyToken(t, testSecret, token)
	if claims.UserID != 0 || claims.Username != "" {
		t.Fatalf("缺 uid/username 载荷应解析为零值, got %+v", claims)
	}
	if claims.Subject != "ghost" {
		t.Fatalf("Subject = %q, want %q", claims.Subject, "ghost")
	}
}
