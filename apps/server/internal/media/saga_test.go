package media

// saga 补偿路径测试:上传管线任一步失败必须不留半截状态(AGENTS.md §4 saga 纪律);
// 删除的部分失败语义固化:介质删除失败时,库记录原样保留,不出现"删了介质留着记录"。

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"github.com/cms-template/server/internal/repo"
	"github.com/cms-template/server/internal/storage"
)

var errStorageBoom = errors.New("storage boom")

// failingStorage 可在 Save/Delete 两个环节注入失败的装饰器。
type failingStorage struct {
	inner      storage.Storage
	failSave   bool
	failDelete bool
}

func (f *failingStorage) Save(ctx context.Context, r io.Reader, ext string) (string, int64, error) {
	if f.failSave {
		return "", 0, errStorageBoom
	}
	return f.inner.Save(ctx, r, ext)
}

func (f *failingStorage) Delete(ctx context.Context, key string) error {
	if f.failDelete {
		return errStorageBoom
	}
	return f.inner.Delete(ctx, key)
}

func (f *failingStorage) Open(ctx context.Context, key string) (io.ReadCloser, error) {
	return f.inner.Open(ctx, key)
}

func (f *failingStorage) URL(key string) string { return f.inner.URL(key) }
func (f *failingStorage) Driver() string        { return f.inner.Driver() }

func newSagaService(t *testing.T) (*Service, *failingStorage, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := repo.AutoMigrate(context.Background(), db); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}
	store, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatalf("new local storage: %v", err)
	}
	wrapped := &failingStorage{inner: store}
	return NewService(db, wrapped), wrapped, db
}

func rowCount(t *testing.T, db *gorm.DB, model any) int64 {
	t.Helper()
	var count int64
	if err := db.Model(model).Count(&count).Error; err != nil {
		t.Fatalf("count rows: %v", err)
	}
	return count
}

func pngPayload(size int) *strings.Reader {
	return strings.NewReader(strings.Repeat("png", size/3+1)[:size])
}

// TestUploadSaveFailureNoRows 介质写入失败 → 全链路无任何落库。
func TestUploadSaveFailureNoRows(t *testing.T) {
	s, wrapped, db := newSagaService(t)
	wrapped.failSave = true

	_, err := s.Upload(context.Background(), KindImage, "a.png", "image/png", pngPayload(64), 1, 0)
	if !errors.Is(err, errStorageBoom) {
		t.Fatalf("expected storage boom, got %v", err)
	}
	if n := rowCount(t, db, &repo.File{}); n != 0 {
		t.Fatalf("expected 0 files, got %d", n)
	}
	if n := rowCount(t, db, &repo.MediaAsset{}); n != 0 {
		t.Fatalf("expected 0 assets, got %d", n)
	}
}

// TestUploadAssetInsertFailureCompensates 资产落库失败 → 补偿删文件记录与介质,不留半截。
func TestUploadAssetInsertFailureCompensates(t *testing.T) {
	s, _, db := newSagaService(t)

	// 让 media_assets 写入必然失败:直接移除该表(模拟任何导致插入失败的故障)。
	if err := db.Migrator().DropTable(&repo.MediaAsset{}); err != nil {
		t.Fatalf("drop media_assets: %v", err)
	}

	_, err := s.Upload(context.Background(), KindImage, "a.png", "image/png", pngPayload(64), 1, 0)
	if err == nil {
		t.Fatal("expected upload to fail when asset insert fails")
	}
	if n := rowCount(t, db, &repo.File{}); n != 0 {
		t.Fatalf("expected file row compensated away, got %d", n)
	}
}

// TestUploadSizeLimitNoRows 超限上传在校验即拒绝,无落库。
func TestUploadSizeLimitNoRows(t *testing.T) {
	s, _, db := newSagaService(t)
	orig := maxBytes[KindImage]
	maxBytes[KindImage] = 8
	defer func() { maxBytes[KindImage] = orig }()

	_, err := s.Upload(context.Background(), KindImage, "a.png", "image/png", pngPayload(64), 1, 0)
	if !errors.Is(err, ErrTooLarge) {
		t.Fatalf("expected ErrTooLarge, got %v", err)
	}
	if n := rowCount(t, db, &repo.File{}); n != 0 {
		t.Fatalf("expected 0 files, got %d", n)
	}
}

// TestDeletePartialFailureSemantics 介质删除失败 → 库记录原样保留(固化语义:不出现
// "介质没了记录还在"的中间态,记录恢复路径=介质可用后重删)。
func TestDeletePartialFailureSemantics(t *testing.T) {
	s, wrapped, db := newSagaService(t)
	ctx := context.Background()

	asset, err := s.Upload(ctx, KindImage, "a.png", "image/png", pngPayload(64), 1, 0)
	if err != nil {
		t.Fatalf("upload: %v", err)
	}

	wrapped.failDelete = true
	if err := s.Delete(ctx, asset.ID); !errors.Is(err, errStorageBoom) {
		t.Fatalf("expected storage boom, got %v", err)
	}
	if n := rowCount(t, db, &repo.MediaAsset{}); n != 1 {
		t.Fatalf("expected asset retained, got %d", n)
	}
	if n := rowCount(t, db, &repo.File{}); n != 1 {
		t.Fatalf("expected file retained, got %d", n)
	}

	// 恢复介质可用后删除成功:库与介质记录双双清干净。
	wrapped.failDelete = false
	if err := s.Delete(ctx, asset.ID); err != nil {
		t.Fatalf("delete after recovery: %v", err)
	}
	if n := rowCount(t, db, &repo.MediaAsset{}); n != 0 {
		t.Fatalf("expected asset deleted, got %d", n)
	}
	if n := rowCount(t, db, &repo.File{}); n != 0 {
		t.Fatalf("expected file deleted, got %d", n)
	}
}
