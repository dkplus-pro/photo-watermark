package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"github.com/cms-template/server/internal/repo"
)

func newTestService(t *testing.T) *AuthService {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := repo.AutoMigrate(context.Background(), db); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}
	if err := repo.SeedAdmin(context.Background(), db); err != nil {
		t.Fatalf("seed admin: %v", err)
	}
	return NewAuthService(db, "test-secret", 2*time.Hour)
}

func TestLogin(t *testing.T) {
	svc := newTestService(t)
	ctx := context.Background()

	token, expiresAt, info, err := svc.Login(ctx, repo.SeedAdminUsername, repo.SeedAdminPassword)
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	if token == "" {
		t.Fatal("expected non-empty token")
	}
	if !expiresAt.After(time.Now()) {
		t.Fatal("expected future expiry")
	}
	if info.Username != repo.SeedAdminUsername || !info.Status {
		t.Fatalf("unexpected user info: %+v", info)
	}

	if _, _, _, err := svc.Login(ctx, repo.SeedAdminUsername, "wrong-password"); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("expected ErrInvalidCredentials, got %v", err)
	}
	if _, _, _, err := svc.Login(ctx, "no-such-user", repo.SeedAdminPassword); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("expected ErrInvalidCredentials, got %v", err)
	}
}

func TestLoginDisabledUser(t *testing.T) {
	svc := newTestService(t)
	ctx := context.Background()

	if _, _, _, err := svc.Login(ctx, repo.SeedAdminUsername, repo.SeedAdminPassword); err != nil {
		t.Fatalf("login: %v", err)
	}
	if err := svc.db.Model(&repo.User{}).Where("username = ?", repo.SeedAdminUsername).
		Update("status", false).Error; err != nil {
		t.Fatalf("disable user: %v", err)
	}

	if _, _, _, err := svc.Login(ctx, repo.SeedAdminUsername, repo.SeedAdminPassword); !errors.Is(err, ErrUserDisabled) {
		t.Fatalf("expected ErrUserDisabled, got %v", err)
	}
}

func TestChangePassword(t *testing.T) {
	svc := newTestService(t)
	ctx := context.Background()

	token, _, info, err := svc.Login(ctx, repo.SeedAdminUsername, repo.SeedAdminPassword)
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	if token == "" {
		t.Fatal("expected non-empty token")
	}

	if err := svc.ChangePassword(ctx, info.ID, "wrong-old", "new-password-1"); !errors.Is(err, ErrWrongOldPassword) {
		t.Fatalf("expected ErrWrongOldPassword, got %v", err)
	}
	if err := svc.ChangePassword(ctx, info.ID, repo.SeedAdminPassword, "new-password-1"); err != nil {
		t.Fatalf("change password: %v", err)
	}

	if _, _, _, err := svc.Login(ctx, info.Username, repo.SeedAdminPassword); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("old password should no longer work, got %v", err)
	}
	if _, _, me, err := svc.Login(ctx, info.Username, "new-password-1"); err != nil {
		t.Fatalf("login with new password: %v", err)
	} else if me.ID != info.ID {
		t.Fatalf("unexpected user id: %d", me.ID)
	}
	_ = token
}

func TestMe(t *testing.T) {
	svc := newTestService(t)
	ctx := context.Background()

	_, _, info, err := svc.Login(ctx, repo.SeedAdminUsername, repo.SeedAdminPassword)
	if err != nil {
		t.Fatalf("login: %v", err)
	}

	me, err := svc.Me(ctx, info.ID)
	if err != nil {
		t.Fatalf("me: %v", err)
	}
	if me.Username != info.Username {
		t.Fatalf("unexpected username: %s", me.Username)
	}
	if me.Roles == nil || me.Permissions == nil {
		t.Fatal("roles/permissions should be non-nil (possibly empty)")
	}
}
